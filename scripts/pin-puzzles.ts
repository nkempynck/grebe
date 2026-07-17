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
import { computePuzzle, encodePuzzle, puzzleVersion, type Game } from "../src/data/pinnedPuzzles";

const GAMES: Game[] = ["lineage", "kinship", "branches"];
const CHUNK = 500;

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
  if (!Number.isFinite(days) || days <= 0) {
    console.error(`--days must be a positive number (got ${arg("days")}).`);
    process.exit(1);
  }

  // Mirror loadTaxonomy: apply the CLADE_COMMON correction layer so the trees here
  // match the app exactly (a clade's common name flips containers()' "named" theme
  // preference, so skipping it would generate DIFFERENT Kinship/Branches boards than
  // players see). Synonyms are irrelevant to generation, so we skip them.
  const withCommon = (nodes: TaxonNode[]): Tree =>
    buildTree(nodes.map((n) => (n.rank !== "species" && CLADE_COMMON[n.sciName] ? { ...n, common: CLADE_COMMON[n.sciName] } : n)));
  const baseNodes = (taxonomy as { nodes: TaxonNode[] }).nodes;
  const tree = withCommon(baseNodes);                                   // Lineage: curated in-set
  const richTree = withCommon([...baseNodes, ...(augment as { nodes: TaxonNode[] }).nodes]); // Kinship/Branches
  const treeFor = (game: Game): Tree => (game === "lineage" ? tree : richTree);
  const client = createClient(url, key, { auth: { persistSession: false } });

  // Build every (game, date) row from the shared registry.
  const rows: { game: string; puzzle_date: string; payload: unknown; version: number }[] = [];
  let skipped = 0;
  for (let i = 0; i < days; i++) {
    const date = shiftDate(from, i);
    for (const game of GAMES) {
      const puzzle = computePuzzle(game, treeFor(game), date);
      if (!puzzle) { skipped++; continue; } // tree can't field this puzzle — rare
      rows.push({ game, puzzle_date: date, payload: encodePuzzle(game, puzzle), version: puzzleVersion(game) });
    }
  }

  console.log(
    `Pinning ${rows.length} rows (${GAMES.join(", ")}) from ${from} for ${days} days` +
      `${skipped ? `, ${skipped} skipped (no puzzle)` : ""}, mode=${force ? "OVERWRITE future" : "insert-if-absent"}.`
  );

  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await client
      .from("daily_puzzles")
      .upsert(chunk, { onConflict: "game,puzzle_date", ignoreDuplicates: !force });
    if (error) {
      console.error(`Upsert failed at chunk ${i / CHUNK}:`, error.message);
      process.exit(1);
    }
    written += chunk.length;
    console.log(`  …${written}/${rows.length}`);
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
