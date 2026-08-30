// Prefill the frozen-puzzle log (public.daily_puzzles) for a horizon of dates.
//
// Puzzles are recomputed from (date, code, taxonomy, seeding), so changing any of
// those retroactively rewrites past days and breaks old leaderboards. Pinning the
// resolved puzzle ahead of time freezes it: once a day is in this table it's read
// back verbatim, and later content/seeding changes only move dates not yet pinned.
//
// This uses the SAME resolver registry the app reads (src/data/pinnedPuzzles.ts),
// so a pinned puzzle can never diverge from what the generator produces today.
//
// RUN IT ONCE BEFORE LAUNCH (so day #1 onward is frozen), then re-run whenever you
// want to extend the horizon — it INSERTS-IF-ABSENT, so it never rewrites an
// existing row (past or already-pinned future). To deliberately overwrite a FUTURE
// day (thematic week, hand-swap), pass --force, or use the in-app admin editor.
//
//   npm run pin                       # from launch epoch, ~2 years, insert-if-absent
//   npm run pin -- --days 400         # shorter horizon
//   npm run pin -- --from 2027-01-01 --days 60 --force   # overwrite a future window
//
// Requires env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY
// (the service key bypasses RLS — keep it out of the client and out of git).

import { createClient } from "@supabase/supabase-js";
import taxonomy from "../src/data/taxonomy.json";
import augment from "../src/data/taxonomyAugment.json";
import { buildTree, DAILY_EPOCH, type TaxonNode, type Tree } from "../src/core";
import { CLADE_COMMON } from "../src/data/cladeNames";
import { SPECIES_COMMON } from "../src/data/speciesCommon";
import { computePuzzle, decodePuzzle, encodePuzzle, puzzleVersion, type Game } from "../src/data/pinnedPuzzles";
import { setServedGridHistory, type ServedGridDay } from "../src/core/grid";
import { setServedBranchesHistory } from "../src/core/branches";

const GAMES: Game[] = ["lineage", "kinship", "branches"];
const DEFAULT_CHUNK = 200; // rows per request; --chunk lowers it for a weak connection
const UPSERT_ATTEMPTS = 5; // per chunk, backing off 0.5s, 1s, 2s, 4s

/** A network failure's real reason. Node wraps everything as "TypeError: fetch failed" and
 *  puts the cause underneath — often several levels down — so walk the chain. Without this
 *  a dropped connection and a rejected payload look exactly alike in the log. */
function describe(e: unknown): string {
  const parts: string[] = [];
  for (let cur: any = e, depth = 0; cur && depth < 5; cur = cur.cause, depth++) {
    const msg = cur.message ?? String(cur);
    const code = cur.code ? ` (${cur.code})` : "";
    if (msg && !parts.includes(msg + code)) parts.push(msg + code);
  }
  return parts.join(" ← ") || String(e);
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function shiftDate(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in the environment.");
    process.exit(1);
  }

  const from = arg("from", DAILY_EPOCH)!;
  const days = Number(arg("days", "730"));
  const force = hasFlag("force"); // overwrite existing FUTURE rows instead of skipping
  const CHUNK = Math.max(1, Number(arg("chunk", String(DEFAULT_CHUNK))));
  if (!Number.isFinite(days) || days <= 0) {
    console.error(`--days must be a positive number (got ${arg("days")}).`);
    process.exit(1);
  }

  // Mirror loadTaxonomy: apply the CLADE_COMMON correction layer so the trees here
  // match the app exactly (a clade's common name flips containers()' "named" theme
  // preference, so skipping it would generate DIFFERENT Kinship/Branches boards than
  // players see). Synonyms are irrelevant to generation, so we skip them.
  // Must stay identical to build() in src/data/loadTaxonomy.ts, SPECIES_COMMON included:
  // a species' common name decides whether it is a usable tile or Latin-pool filler, so
  // dropping that layer here pins boards the app would never generate.
  const withCommon = (nodes: TaxonNode[]): Tree =>
    buildTree(
      nodes.map((n) => {
        const fixed = n.rank === "species" ? SPECIES_COMMON[n.sciName] : CLADE_COMMON[n.sciName];
        return fixed ? { ...n, common: fixed } : n;
      })
    );
  const baseNodes = (taxonomy as { nodes: TaxonNode[] }).nodes;
  const tree = withCommon(baseNodes);                                   // Lineage: curated in-set
  const richTree = withCommon([...baseNodes, ...(augment as { nodes: TaxonNode[] }).nodes]); // Kinship/Branches
  const treeFor = (game: Game): Tree => (game === "lineage" ? tree : richTree);
  const client = createClient(url, key, { auth: { persistSession: false } });

  // Optional per-game filter, e.g. `--game branches`, so a single generator can be
  // re-pinned after a version bump without recomputing (and, under --force,
  // overwriting) the other games' pins. Defaults to all games.
  const only = arg("game");
  if (only && !GAMES.includes(only as Game)) {
    console.error(`--game must be one of ${GAMES.join(", ")} (got ${only}).`);
    process.exit(1);
  }
  const games = only ? GAMES.filter((g) => g === only) : GAMES;

  // SEED THE ANTI-REPEAT HISTORY WITH WHAT WAS REALLY SERVED.
  //
  // Kinship and Branches both decide "don't repeat this" from a memory of recent boards that
  // they rebuild by REGENERATING every past day with the current generator. That memory is
  // correct only while the generator never changes, and this script exists to run after it
  // has: on the v8→v9 move every one of the most recent already-served days regenerated as a
  // different board, so the windows were protecting boards nobody saw while the ones players
  // had just played counted as unseen and were free to come round again within the week.
  //
  // The rows already in the table ARE the record of what was served, so read the ones before
  // the first date this run will WRITE and hand them to the generators. Days with no row
  // (pre-launch, or a gap) still regenerate, which is right: nobody saw them either.
  //
  // Not `from`. Under --force the past guard below already refuses every date up to today, so
  // the first date actually written is tomorrow, and every row up to today is real served
  // history that the windows must see. Seeding on `from` instead threw all of it away on the
  // most natural invocation there is: `--force` with the default `from` of the launch epoch
  // read rows before the epoch, found none, announced "as on a first run", and rebuilt the
  // last month by REGENERATING it with the new tree — the precise failure this block exists
  // to prevent, on the run most likely to hit it.
  //
  // Deliberately unfiltered by version. An old row is still what was on the screen, and that
  // is the only question the anti-repeat window asks.
  const today = new Date().toISOString().slice(0, 10);
  const seedBefore = force && from <= today ? shiftDate(today, 1) : from;
  const seeded: Record<string, number> = {};
  if (games.includes("kinship") || games.includes("branches")) {
    const { data, error } = await client
      .from("daily_puzzles")
      .select("game, puzzle_date, payload")
      .in("game", ["kinship", "branches"])
      .lt("puzzle_date", seedBefore)
      .order("puzzle_date");
    if (error) {
      console.error(`Could not read served history (${error.message}). Refusing to pin blind: ` +
        `a repin without it will happily repeat boards that were served days ago.`);
      process.exit(1);
    }
    const grid = new Map<string, ServedGridDay>();
    const branch = new Map<string, { slotIds: string[]; anchorIds: string[]; groupIds: string[] }>();
    for (const r of data ?? []) {
      if (r.game === "kinship") {
        const p = decodePuzzle("kinship", r.payload);
        if (p) grid.set(r.puzzle_date as string, { groups: p.groups });
      } else if (r.game === "branches") {
        const p = decodePuzzle("branches", r.payload);
        if (p) branch.set(r.puzzle_date as string, { slotIds: p.slotIds, anchorIds: p.anchorIds, groupIds: p.groupIds });
      }
    }
    setServedGridHistory(grid);
    setServedBranchesHistory(branch);
    seeded.kinship = grid.size;
    seeded.branches = branch.size;
    console.log(
      `Seeded anti-repeat history from rows before ${seedBefore}: ` +
      `kinship ${grid.size}, branches ${branch.size} real boards.`
    );
    if (!grid.size && !branch.size) {
      console.log("  (none found — every day will be generated, as on a first run)");
    }
  }

  // Build every (game, date) row from the shared registry.
  //
  // Under --force the upsert REWRITES whatever it is given, and `from` defaults to the
  // launch epoch, so an unguarded `npm run pin -- --force` would recompute every day since
  // launch and silently rewrite the boards people already played — which is exactly what
  // pinning exists to prevent. repinFuture() in pinnedPuzzles.ts has always refused to
  // touch the past; this is the same rule for the CLI. Insert-if-absent runs are harmless
  // (an existing row is never overwritten), so the guard applies only to --force.
  const rows: { game: string; puzzle_date: string; payload: unknown; version: number }[] = [];
  let skipped = 0;
  let pastBlocked = 0;
  for (let i = 0; i < days; i++) {
    const date = shiftDate(from, i);
    if (force && date <= today) { pastBlocked++; continue; }
    for (const game of games) {
      const puzzle = computePuzzle(game, treeFor(game), date);
      if (!puzzle) { skipped++; continue; } // tree can't field this puzzle — rare
      rows.push({ game, puzzle_date: date, payload: encodePuzzle(game, puzzle), version: puzzleVersion(game) });
    }
  }

  console.log(
    `Pinning ${rows.length} rows (${games.join(", ")}) from ${from} for ${days} days` +
      `${skipped ? `, ${skipped} skipped (no puzzle)` : ""}` +
      `${pastBlocked ? `, ${pastBlocked} dates up to and including ${today} left frozen` : ""}` +
      `, mode=${force ? "OVERWRITE future" : "insert-if-absent"}.`
  );

  // One request per chunk, RETRIED. A year of pins is a single fat POST at the default
  // chunk size, and on a phone hotspot or a VPN that link drops often enough to lose the
  // whole run — Node reports it as a bare `TypeError: fetch failed` with the real reason
  // hidden in `cause`, so the old one-shot write both failed and said nothing useful.
  // Upserts are idempotent per (game, puzzle_date), so a retry can only rewrite the row it
  // was already writing, and a resumed run re-sends chunks that already landed.
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    for (let attempt = 1; ; attempt++) {
      // A network failure can arrive either as a returned error or as a throw, depending on
      // where it happens in the client, so catch both and read the cause chain off both.
      let failure: string | null = null;
      try {
        const { error } = await client
          .from("daily_puzzles")
          .upsert(chunk, { onConflict: "game,puzzle_date", ignoreDuplicates: !force });
        if (error) failure = describe(error);
      } catch (e) {
        failure = describe(e);
      }
      if (!failure) break;
      // Retry only what a retry can fix. A rejected payload or a bad key fails identically
      // every time, and retrying it just delays the error by half a minute.
      const transient = /fetch failed|network|timeout|timed out|socket|ECONN|EPIPE|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR/i.test(failure);
      if (!transient || attempt >= UPSERT_ATTEMPTS) {
        console.error(`Upsert failed at chunk ${i / CHUNK} (attempt ${attempt}): ${failure}`);
        if (transient) {
          console.error(`  The link dropped ${attempt} times. Re-run to resume — rows already written are re-sent`);
          console.error(`  harmlessly, and a smaller batch survives a weak connection: npm run pin -- --chunk 50 …`);
        }
        process.exit(1);
      }
      const wait = 500 * 2 ** (attempt - 1);
      console.warn(`  chunk ${i / CHUNK} failed (${failure}) — retrying in ${wait}ms [${attempt}/${UPSERT_ATTEMPTS - 1}]`);
      await new Promise((r) => setTimeout(r, wait));
    }
    written += chunk.length;
    console.log(`  …${written}/${rows.length}`);
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
