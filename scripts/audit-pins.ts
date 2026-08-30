// Read the pinned rows back out of daily_puzzles and audit what players will actually get.
//
// Not a regeneration. A repin is a function of (date, tree, what was really served), so the
// only honest check is the table itself — this decodes the stored payloads and asks the
// questions the generator claims to have answered.
//
// Runs over the SERVED past as well as the future, deliberately: the seam is where a repin
// goes wrong. A board pinned for next week that reuses a group from the week players just
// played is the exact failure the served-history seeding exists to prevent, and it is
// invisible if you only look at the new rows.
//
// Bounded at the top by the repin horizon: rows past it were pinned by an earlier run
// against an older tree, so auditing them measures that run, not this one. Pass an explicit
// `untilDate` to widen it.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node <bundle> [fromDate] [untilDate]
//   (bundle with esbuild like pin-puzzles; the service key is needed to read future rows)
import { createClient } from "@supabase/supabase-js";
import taxonomy from "../src/data/taxonomy.json";
import augment from "../src/data/taxonomyAugment.json";
import { buildTree, DAILY_EPOCH, type TaxonNode, type Tree } from "../src/core";
import { mrca, separationTierOf } from "../src/core/tree";
import { CLADE_COMMON } from "../src/data/cladeNames";
import { SPECIES_COMMON } from "../src/data/speciesCommon";
import { decodePuzzle } from "../src/data/pinnedPuzzles";

// Windows the generators promise (grid.ts / branches.ts). A violation here is a real defect,
// not a preference: these are the gates the board selection is supposed to enforce.
const GROUP_WINDOW = 14;   // both games: a group must not come back inside this
const SET_WINDOW = 90;     // kinship: the exact four-group set
const SPECIES_WINDOW = 45; // kinship: soft — reported, never failed
const BRANCH_BOARD_WINDOW = 60;

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
const from = process.argv[2] ?? DAILY_EPOCH;
const until = process.argv[3] ?? (() => { const d = new Date(); d.setUTCDate(d.getUTCDate() + 365); return d.toISOString().slice(0, 10); })();

const withCommon = (nodes: TaxonNode[]): Tree =>
  buildTree(nodes.map((n) => {
    const fixed = n.rank === "species" ? SPECIES_COMMON[n.sciName] : CLADE_COMMON[n.sciName];
    return fixed ? { ...n, common: fixed } : n;
  }));
const tree = withCommon([
  ...(taxonomy as { nodes: TaxonNode[] }).nodes,
  ...(augment as { nodes: TaxonNode[] }).nodes,
]);
const label = (id: string) => tree.byId.get(id)?.common || tree.byId.get(id)?.sciName || id;
const isAncestor = (a: string, b: string): boolean => {
  for (let c: string | null | undefined = tree.byId.get(b)?.parentId; c; c = tree.byId.get(c)?.parentId)
    if (c === a) return true;
  return false;
};

// Difficulty is group CLOSENESS, never obscurity: a board is easy when its four groups sit
// far apart, so the median pairwise separation is the measure and the weekday decides the
// band it should land in. Mirrors WEEKDAY_BAND / BAND_TIER_WINDOW in grid.ts and the
// off-band test in analyze-kinship.ts. Below the band is a walkover; above it is a slog.
const WEEKDAY_BAND = [0, 0, 0, 0, 1, 1, 2, 2];
const BAND_WINDOW: [number, number][] = [[1, 4], [3, 6], [4, 7]];
const weekdayTier = (d: string) => ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
const CLASS_MARKERS = new Map<string, string>();
for (const [g, ms] of Object.entries({
  Mammals: ["Mammalia"], Birds: ["Aves"], Fish: ["Actinopterygii", "Elasmobranchii", "Chondrichthyes"],
  Reptiles: ["Squamata", "Testudines", "Crocodylia"], Amphibians: ["Amphibia"], Insects: ["Insecta"],
  Plants: ["Magnoliopsida", "Liliopsida", "Pinopsida", "Polypodiopsida"],
  Molluscs: ["Gastropoda", "Bivalvia", "Cephalopoda"], Spiders: ["Arachnida"],
})) for (const m of ms) CLASS_MARKERS.set(m, g);
const broadOf = (id: string) => {
  let grp = "other";
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    const s = tree.byId.get(c)?.sciName;
    if (s && CLASS_MARKERS.has(s)) grp = CLASS_MARKERS.get(s)!;
  }
  return grp;
};

const client = createClient(url, key, { auth: { persistSession: false } });
const rows: { game: string; puzzle_date: string; payload: unknown; version: number }[] = [];
for (let offset = 0; ; offset += 1000) {
  const { data, error } = await client
    .from("daily_puzzles").select("game, puzzle_date, payload, version")
    .in("game", ["kinship", "branches"]).gte("puzzle_date", from).lte("puzzle_date", until)
    .order("puzzle_date").range(offset, offset + 999);
  if (error) { console.error(error.message); process.exit(1); }
  rows.push(...(data as typeof rows));
  if (!data || data.length < 1000) break;
}
const today = new Date().toISOString().slice(0, 10);

/** Days since a key was last seen, walking the timeline in date order. */
function gaps(seq: { date: string; keys: string[] }[]) {
  const last = new Map<string, number>();
  const hits: { date: string; key: string; gap: number }[] = [];
  seq.forEach((d, i) => {
    for (const k of d.keys) {
      const prev = last.get(k);
      if (prev !== undefined) hits.push({ date: d.date, key: k, gap: i - prev });
      last.set(k, i);
    }
  });
  return hits;
}

for (const game of ["kinship", "branches"] as const) {
  const mine = rows.filter((r) => r.game === game);
  if (!mine.length) continue;
  const days = mine.map((r) => {
    const p: any = decodePuzzle(game, r.payload as any);
    const groups: string[] = game === "kinship" ? p.groups.map((g: any) => g.cladeId) : p.groupIds;
    const species: string[] = game === "kinship"
      ? p.groups.flatMap((g: any) => g.memberIds)
      : [...p.slotIds, ...p.anchorIds];
    // ANSWER clades — the ones that carry a slot and ARE the puzzle. Branches labels context
    // clades too (non-answer branches that fill the tree out), and stores them in groupIds
    // AFTER the answers, so the split is a slice. Every kinship group is an answer.
    const answers = game === "kinship" ? groups : groups.slice(0, p.slotIds.length);
    const context = groups.slice(answers.length);
    return { date: r.puzzle_date, version: r.version, groups, answers, context, species, future: r.puzzle_date > today };
  });
  const future = days.filter((d) => d.future);

  // STALE-BUNDLE GUARD. This script embeds the tree at BUNDLE time, so an auditor built
  // before a taxonomy change will not contain the clade ids the newer pins reference. Every
  // lookup then silently returns nothing: ancestry walks end immediately, broad-group checks
  // report "other", and separation is computed from an MRCA that does not exist. That reads
  // as a pile of new defects in boards that are perfectly fine. Refuse instead.
  console.log(`\n${"=".repeat(70)}\n${game.toUpperCase()}  ${days.length} rows (${future.length} future), ${from} →\n${"=".repeat(70)}`);
  const vers = new Map<number, number>();
  for (const d of future) vers.set(d.version, (vers.get(d.version) ?? 0) + 1);
  console.log(`versions (future): ${[...vers].map(([v, n]) => `v${v}×${n}`).join(", ")}`);
  // FUTURE rows were written from this tree, so a missing id there means the auditor is older
  // than the pins and every lookup below would silently lie. PAST rows are different: a served
  // board is frozen against whatever tree shipped that day, and the augment has legitimately
  // dropped nodes since (auggen_Bos is gone on purpose — see build-augment.mjs). Those are
  // worth reporting, because the client re-derives labels at read time and a dangling id
  // renders as the raw id, but they are history, not a reason to refuse.
  const missing = (rows: typeof days) => {
    const s = new Set<string>();
    for (const d of rows) for (const g of d.groups) if (!tree.byId.get(g)) s.add(g);
    return s;
  };
  const goneFuture = missing(future);
  if (goneFuture.size) {
    console.error(`\n✗ ${game}: ${goneFuture.size} clade ids in FUTURE pins are absent from this build's tree.`);
    console.error(`  e.g. ${[...goneFuture].slice(0, 3).join(", ")}`);
    console.error(`  This auditor is older than the pins. Rebundle it and re-run:`);
    console.error(`    npx esbuild scripts/audit-pins.ts --bundle --platform=node --format=esm \\`);
    console.error(`      --define:import.meta.env={} --loader:.json=json --external:@supabase/supabase-js \\`);
    console.error(`      --outfile=node_modules/.cache/audit-pins.mjs`);
    process.exit(1);
  }
  const gonePast = missing(days.filter((d) => !d.future));
  if (gonePast.size) {
    const dates = days.filter((d) => !d.future && d.groups.some((g) => gonePast.has(g))).map((d) => d.date);
    console.log(`\n⚠ ${game}: ${gonePast.size} clade ids in SERVED pins no longer exist (${[...gonePast].slice(0, 3).join(", ")}).`);
    console.log(`  Those boards reveal a raw id instead of a label: ${dates.join(", ")}`);
  }


  // 1. the graft bug: one labelled group containing another on the same board
  let nested = 0;
  for (const d of days) {
    for (const a of d.groups) for (const b of d.groups) {
      if (a !== b && isAncestor(a, b)) {
        nested++;
        console.log(`  ✗ ${d.date}: "${label(a)}" contains "${label(b)}"`);
      }
    }
  }
  console.log(`nested groups on one board: ${nested}  ${nested ? "✗" : "✓"}`);

  // 2. same label twice on one board (unsolvable by inspection)
  let dupLabel = 0, dupSpecies = 0;
  for (const d of days) {
    const ls = d.groups.map(label);
    if (new Set(ls).size !== ls.length) { dupLabel++; console.log(`  ✗ ${d.date}: duplicate label ${ls.join(" / ")}`); }
    if (new Set(d.species).size !== d.species.length) { dupSpecies++; console.log(`  ✗ ${d.date}: duplicate species`); }
  }
  console.log(`duplicate group label: ${dupLabel}  ${dupLabel ? "✗" : "✓"}`);
  console.log(`duplicate species on one board: ${dupSpecies}  ${dupSpecies ? "✗" : "✓"}`);

  // 3. near-repeats ACROSS the seam — the served past and the new pins as one timeline.
  //
  // ANSWER clades and CONTEXT clades are counted apart, and only the answers can fail. A
  // repeated answer clade is a repeated puzzle; a repeated context clade is the same piece
  // of scenery beside a different puzzle, which the generator does not ration and which
  // costs the player nothing. Counting them together made this line meaningless the day
  // Branches started drawing fuller trees: the same board scored 52 answer repeats and 155
  // total, so the total moved with how much scenery a board happened to carry.
  const aHits = gaps(days.map((d) => ({ date: d.date, keys: d.answers })));
  const tooSoon = aHits.filter((h) => h.gap < GROUP_WINDOW && h.date > today);
  console.log(`answer-clade repeats inside ${GROUP_WINDOW}d (future dates): ${tooSoon.length}  ${tooSoon.length ? "✗" : "✓"}`);
  for (const h of tooSoon.slice(0, 12)) console.log(`  ✗ ${h.date}: "${label(h.key)}" again after ${h.gap}d`);
  const minGap = Math.min(...aHits.filter((h) => h.date > today).map((h) => h.gap));
  console.log(`closest answer-clade repeat anywhere in the future: ${Number.isFinite(minGap) ? `${minGap}d` : "none"}`);
  if (days.some((d) => d.context.length)) {
    const cHits = gaps(days.map((d) => ({ date: d.date, keys: d.context })));
    const cSoon = cHits.filter((h) => h.gap < GROUP_WINDOW && h.date > today);
    console.log(`context-clade repeats inside ${GROUP_WINDOW}d: ${cSoon.length} (soft — scenery, never rationed)`);
  }

  if (game === "kinship") {
    const setHits = gaps(days.map((d) => ({ date: d.date, keys: [d.groups.slice().sort().join(",")] })));
    const soonSet = setHits.filter((h) => h.gap < SET_WINDOW && h.date > today);
    console.log(`identical group-SET inside ${SET_WINDOW}d: ${soonSet.length}  ${soonSet.length ? "✗" : "✓"}`);
    for (const h of soonSet.slice(0, 5)) console.log(`  ✗ ${h.date}: same four groups after ${h.gap}d`);
    const spHits = gaps(days.map((d) => ({ date: d.date, keys: d.species })));
    const soonSp = spHits.filter((h) => h.gap < SPECIES_WINDOW && h.date > today);
    console.log(`species reused inside ${SPECIES_WINDOW}d: ${soonSp.length} (soft, informational)`);
    const worst = soonSp.sort((a, b) => a.gap - b.gap).slice(0, 5);
    for (const h of worst) console.log(`    ${h.date}: ${label(h.key)} after ${h.gap}d`);
  } else {
    // The board's identity is its ANSWER set. Two boards with the same answers are the same
    // puzzle whatever scenery stands beside them, and including the scenery let a repeat hide
    // behind one differing context clade.
    const bHits = gaps(days.map((d) => ({ date: d.date, keys: [d.answers.slice().sort().join(",")] })));
    const soonB = bHits.filter((h) => h.gap < BRANCH_BOARD_WINDOW && h.date > today);
    console.log(`identical board signature inside ${BRANCH_BOARD_WINDOW}d: ${soonB.length}  ${soonB.length ? "✗" : "✓"}`);
    for (const h of soonB.slice(0, 5)) console.log(`  ✗ ${h.date}: the same answer clades after ${h.gap}d`);
  }

  // 3b. walkovers: boards easier than the day is supposed to be
  if (game === "kinship") {
    const diffs = future.map((d) => {
      const pairs: number[] = [];
      for (let x = 0; x < d.groups.length; x++)
        for (let y = x + 1; y < d.groups.length; y++)
          pairs.push(separationTierOf(tree, mrca(tree, d.groups[x], d.groups[y])));
      pairs.sort((a, b) => a - b);
      const [lo, hi] = BAND_WINDOW[WEEKDAY_BAND[weekdayTier(d.date)] ?? 0];
      const classes = new Set(d.groups.map(broadOf));
      return { date: d.date, diff: Math.round((pairs[2] + pairs[3]) / 2), lo, hi, wd: weekdayTier(d.date), classes };
    });
    const easy = diffs.filter((r) => r.diff < r.lo);
    const hard = diffs.filter((r) => r.diff > r.hi);
    const hist = new Map<number, number>();
    for (const r of diffs) hist.set(r.diff, (hist.get(r.diff) ?? 0) + 1);
    console.log(`board difficulty spread: ${[...hist].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}:${n}`).join("  ")}`);
    console.log(`WALKOVERS (easier than the band): ${easy.length} / ${diffs.length}  ${easy.length ? "⚠" : "✓"}`);
    for (const r of easy.slice(0, 10)) console.log(`    ${r.date} (wd-tier ${r.wd}, diff ${r.diff}, want ${r.lo}-${r.hi})`);
    console.log(`harder than the band: ${hard.length} / ${diffs.length}`);
    const soon = diffs.slice(0, 60);
    const soonEasy = soon.filter((r) => r.diff < r.lo);
    console.log(`  next 60 days: ${soonEasy.length} walkover${soonEasy.length === 1 ? "" : "s"}` +
      `${soonEasy.length ? ` → ${soonEasy.map((r) => r.date).join(", ")}` : ""}`);
    // GIVEAWAY BY NAME. The label is revealed on solve, so it cannot leak — but four tiles
    // sharing a distinctive word can be grouped without knowing any biology, which is what
    // the wordCap in grid.ts exists to bound. Checked here on the rows players will actually
    // get, because the cap is a preference the generator can spend when a pool is thin.
    const STOP = new Set(["common","great","greater","lesser","little","northern","southern",
      "eastern","western","american","african","asian","european","giant","spotted","striped","banded"]);
    const wordsOf = (s: string) => (s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w));
    const shared: { date: string; names: string[] }[] = [];
    for (const d of future) {
      for (const g of (decodePuzzle("kinship", mine.find((r) => r.puzzle_date === d.date)!.payload as any) as any).groups) {
        const names = g.memberIds.map((m: string) => label(m));
        const tally = new Map<string, number>();
        for (const nm of names) for (const w of new Set(wordsOf(nm))) tally.set(w, (tally.get(w) ?? 0) + 1);
        if (Math.max(0, ...tally.values()) >= 4) shared.push({ date: d.date, names });
      }
    }
    console.log(`groups where all four tiles share a word: ${shared.length}`);
    for (const s of shared.slice(0, 6)) console.log(`    ${s.date}: ${s.names.join(" · ")}`);

    // Four groups from four different classes is a giveaway however the ruler scores it.
    const cross = diffs.filter((r) => r.classes.size > 1);
    console.log(`cross-class boards (a bird beside a beetle): ${cross.length}  ${cross.length ? "✗" : "✓"}`);
    for (const r of cross.slice(0, 5)) console.log(`  ✗ ${r.date}: ${[...r.classes].join(" + ")}`);
  }

  // 4. the seam itself, spelled out: the first fortnight against what was really served
  // The bar is the GAP, not the fact of reuse: both generators rank a repeat down rather
  // than forbidding it, and the analyzer's stated want for kinship is a min gap of 8.
  // Answer clades only, for the reason given above: scenery returning is not a repeat.
  const lastServed = new Map<string, string>();
  for (const d of days) if (!d.future) for (const g of d.answers) lastServed.set(g, d.date);
  const dayNo = (s: string) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 86_400_000);
  const seam = future
    .slice(0, GROUP_WINDOW * 2)
    .flatMap((d) => d.answers
      .filter((g) => lastServed.has(g))
      .map((g) => ({ date: d.date, g, gap: dayNo(d.date) - dayNo(lastServed.get(g)!) })))
    .sort((a, b) => a.gap - b.gap);
  const tight = seam.filter((h) => h.gap < 8);
  console.log(`answer clades returning from the served past in the first ${GROUP_WINDOW * 2} pinned days: ` +
    `${seam.length}, closest ${seam.length ? `${seam[0].gap}d` : "n/a"}`);
  console.log(`  inside the 8-day floor: ${tight.length}  ${tight.length ? "✗" : "✓"}`);
  for (const h of seam.slice(0, 8)) console.log(`    ${h.date}: "${label(h.g)}" ${h.gap}d after it was last served`);
}
console.log("\ndone.");
