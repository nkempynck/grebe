// Big Kinship simulation + analysis. Replays the REAL boards over a long horizon
// (same rich tree + generator the app runs) and audits them for:
//   • repeats     — consecutive-day group overlap, per-group gap, set gap, species gap
//   • variety     — distinct sets/groups/species, broad-group mix, tier/band fit
//   • bugs        — within-board duplicate species (the "Alpaca ×2" class), duplicate
//                   groups, cross-class boards, Latin-only tiles, malformed boards
// Bundle with esbuild like preview-kinship, then:  node <bundle> [start] [days]
import { loadRichTree } from "../src/data/loadTaxonomy";
import { gridBoardFor } from "../src/data/gridDaily";
import { mrca, separationTierOf } from "../src/core/tree";
import type { Tree } from "../src/core";

function shift(dateKey: string, d: number): string {
  const t = new Date(`${dateKey}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}
const weekdayTier = (d: string) => (((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7)) + 1; // Mon=1..Sun=7

const CLASS_MARKERS = new Map<string, string>();
for (const [g, ms] of Object.entries({
  Mammals: ["Mammalia"], Birds: ["Aves"], Fish: ["Actinopterygii", "Elasmobranchii", "Chondrichthyes"],
  Reptiles: ["Squamata", "Testudines", "Crocodylia"], Amphibians: ["Amphibia"], Insects: ["Insecta"],
  Plants: ["Magnoliopsida", "Liliopsida", "Pinopsida", "Polypodiopsida"],
  Molluscs: ["Gastropoda", "Bivalvia", "Cephalopoda"], Spiders: ["Arachnida"],
})) for (const m of ms) CLASS_MARKERS.set(m, g);

const start = process.argv[2] ?? "2026-06-22"; // ANTIREPEAT_ANCHOR — covers pre-launch too
const days = Number(process.argv[3] ?? 800);
const tree: Tree = await loadRichTree();
const node = (id: string) => tree.byId.get(id);
const groupOf = (id: string): string => {
  let grp = "other";
  for (let c: string | null | undefined = id; c; c = node(c)?.parentId) {
    const s = node(c)?.sciName;
    if (s && CLASS_MARKERS.has(s)) grp = CLASS_MARKERS.get(s)!;
  }
  return grp;
};

// The band each weekday tier should land in (mirrors grid.ts WEEKDAY_BAND/BAND_TIER_WINDOW).
const WEEKDAY_BAND = [0, 0, 0, 0, 1, 1, 2, 2];
const BAND_WINDOW: [number, number][] = [[1, 4], [3, 6], [4, 7]];

interface Row {
  d: string; tier: number; groups: string[]; grpBroad: string[];
  members: string[]; boardDiff: number;
}
const rows: Row[] = [];
let empties = 0;

// ---- structural-bug collectors (found while walking) ----
const dupSpeciesInBoard: string[] = [];   // same member id twice on one board
const dupCommonInBoard: string[] = [];    // two tiles, different id, SAME common name (Alpaca ×2)
const dupSciInBoard: string[] = [];       // two tiles, different id, same sciName
const dupGroupInBoard: string[] = [];     // same cladeId as two groups
const crossClass: string[] = [];          // groups span >1 broad group
const latinOnly: string[] = [];           // a tile with no common name
const malformed: string[] = [];           // not 4 groups × 4 members / 16 tiles

const nameOf = (id: string) => node(id)?.common ?? node(id)?.sciName ?? id;

for (let i = 0; i < days; i++) {
  const dk = shift(start, i);
  const b = gridBoardFor(tree, dk);
  if (!b) { empties++; continue; }
  const ids = b.groups.map((g) => g.cladeId);
  const grpBroad = ids.map(groupOf);
  const members = b.groups.flatMap((g) => g.memberIds);

  // structural checks
  if (b.groups.length !== 4 || b.groups.some((g) => g.memberIds.length !== 4) || b.tiles.length !== 16)
    malformed.push(`${dk}: ${b.groups.length} groups, sizes [${b.groups.map((g) => g.memberIds.length)}], ${b.tiles.length} tiles`);
  if (new Set(ids).size !== ids.length) dupGroupInBoard.push(`${dk}: ${ids.join(", ")}`);
  if (new Set(grpBroad).size > 1) crossClass.push(`${dk}: ${grpBroad.join(", ")}`);
  if (new Set(members).size !== members.length) {
    const dup = members.filter((m, k) => members.indexOf(m) !== k);
    dupSpeciesInBoard.push(`${dk}: ${[...new Set(dup)].map(nameOf).join(", ")}`);
  }
  const commons = members.map((m) => node(m)?.common).filter(Boolean) as string[];
  const commonDup = commons.filter((c, k) => commons.indexOf(c) !== k);
  if (commonDup.length) {
    // show which distinct ids collide on the name
    const byName = new Map<string, string[]>();
    for (const m of members) { const c = node(m)?.common; if (c) (byName.get(c) ?? byName.set(c, []).get(c)!).push(m); }
    const detail = [...new Set(commonDup)].map((c) => `${c} [${(byName.get(c) ?? []).join(" / ")}]`).join("; ");
    dupCommonInBoard.push(`${dk}: ${detail}`);
  }
  const scis = members.map((m) => node(m)?.sciName).filter(Boolean) as string[];
  if (new Set(scis).size !== scis.length) {
    const dup = scis.filter((c, k) => scis.indexOf(c) !== k);
    dupSciInBoard.push(`${dk}: ${[...new Set(dup)].join(", ")}`);
  }
  for (const m of members) if (!node(m)?.common) latinOnly.push(`${dk}: ${m} (${node(m)?.sciName ?? "?"})`);

  // board difficulty (median pairwise MRCA separation tier) for band-fit
  const pairs: number[] = [];
  for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++)
    pairs.push(separationTierOf(tree, mrca(tree, ids[x], ids[y])));
  pairs.sort((a, c) => a - c);
  const boardDiff = Math.round((pairs[2] + pairs[3]) / 2);

  rows.push({ d: dk, tier: b.tier, groups: ids, grpBroad, members, boardDiff });
  if ((i + 1) % 200 === 0) process.stderr.write(`  simulated ${i + 1}/${days}\r`);
}
process.stderr.write("\n");

// ---- repeat analysis ----
const N = rows.length;
const setSig = (r: Row) => [...r.groups].sort().join(",");

// consecutive-day group overlap
let consecOverlapDays = 0; const consecExamples: string[] = [];
for (let i = 1; i < N; i++) {
  const shared = rows[i].groups.filter((g) => rows[i - 1].groups.includes(g));
  if (shared.length) { consecOverlapDays++; if (consecExamples.length < 8) consecExamples.push(`${rows[i - 1].d}→${rows[i].d}: ${shared.map(nameOf).join(", ")}`); }
}

// min gap between reuses of an INDIVIDUAL group / SET / SPECIES
function gapStats(keysPerDay: string[][]) {
  const last = new Map<string, number>();
  let min = Infinity; const under: string[] = []; const gaps: number[] = [];
  const counts = new Map<string, number>();
  keysPerDay.forEach((keys, i) => {
    for (const k of keys) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      const prev = last.get(k);
      if (prev !== undefined) { const g = i - prev; gaps.push(g); if (g < min) min = g; }
      last.set(k, i);
    }
  });
  return { min: min === Infinity ? null : min, gaps, counts };
}
const groupGap = gapStats(rows.map((r) => r.groups));
const setGap = gapStats(rows.map((r) => [setSig(r)]));
const speciesGap = gapStats(rows.map((r) => r.members));
const broadGap = gapStats(rows.map((r) => [...new Set(r.grpBroad)]));

const underN = (gaps: number[], n: number) => gaps.filter((g) => g < n).length;
const topUsed = (counts: Map<string, number>, n: number, lab: (k: string) => string) =>
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${lab(k)}×${v}`).join(", ");

// broad-group consecutive repeats + per-weekday-tier mix
let consecBroad = 0;
for (let i = 1; i < N; i++) if (rows[i].grpBroad[0] && rows[i - 1].grpBroad.join() === rows[i].grpBroad.join()) consecBroad++;
// how often the day's dominant broad group equals yesterday's
let sameDominantBroad = 0;
const dominant = (r: Row) => { const c = new Map<string, number>(); for (const g of r.grpBroad) c.set(g, (c.get(g) ?? 0) + 1); return [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]; };
for (let i = 1; i < N; i++) if (dominant(rows[i]) === dominant(rows[i - 1])) sameDominantBroad++;

const broadHist = new Map<string, number>();
for (const r of rows) broadHist.set(dominant(r), (broadHist.get(dominant(r)) ?? 0) + 1);

// tier/band fit
let offBand = 0; const offBandEx: string[] = [];
const tierHist = new Map<number, number>();
for (const r of rows) {
  tierHist.set(r.tier, (tierHist.get(r.tier) ?? 0) + 1);
  const [lo, hi] = BAND_WINDOW[WEEKDAY_BAND[weekdayTier(r.d)] ?? 0];
  if (r.boardDiff < lo || r.boardDiff > hi) { offBand++; if (offBandEx.length < 6) offBandEx.push(`${r.d} (wd-tier ${weekdayTier(r.d)}, boardDiff ${r.boardDiff}, want ${lo}-${hi})`); }
}

// ---- report ----
const distinctSets = new Set(rows.map(setSig)).size;
const distinctGroups = new Set(rows.flatMap((r) => r.groups)).size;
const distinctSpecies = new Set(rows.flatMap((r) => r.members)).size;
const line = (s = "") => process.stdout.write(s + "\n");

line(`\n=== KINSHIP SIMULATION: ${rows.length} boards, ${start} … ${shift(start, days - 1)} (${empties} empty days) ===\n`);

line(`── REPEATS ──`);
line(`consecutive-day group overlap:   ${consecOverlapDays} days` + (consecOverlapDays ? "  ⚠️" : "  ✓"));
consecExamples.forEach((e) => line(`    ${e}`));
line(`individual-group min gap:        ${groupGap.min}  (want ≥ 8)` + (groupGap.min !== null && groupGap.min < 8 ? "  ⚠️" : "  ✓") + `   [<8: ${underN(groupGap.gaps, 8)}, <14: ${underN(groupGap.gaps, 14)}, <30: ${underN(groupGap.gaps, 30)}]`);
line(`group-SET min gap:               ${setGap.min}  (want ≥ 90)` + (setGap.min !== null && setGap.min < 90 ? "  ⚠️" : "  ✓") + `   [<90: ${underN(setGap.gaps, 90)}]`);
line(`species min gap:                 ${speciesGap.min}` + `   [<7: ${underN(speciesGap.gaps, 7)}, <14: ${underN(speciesGap.gaps, 14)}, <30: ${underN(speciesGap.gaps, 30)}]`);
line(`broad-group (class) consecutive same-mix: ${consecBroad}   ·  same dominant class as prev day: ${sameDominantBroad}/${N - 1}`);

line(`\n── VARIETY ──`);
line(`distinct group-SETS:  ${distinctSets} / ${rows.length}`);
line(`distinct GROUPS used: ${distinctGroups}`);
line(`distinct SPECIES used:${distinctSpecies}`);
line(`broad-group mix (dominant/day): ${[...broadHist.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
line(`most-reused groups:   ${topUsed(groupGap.counts, 10, nameOf)}`);
line(`most-reused species:  ${topUsed(speciesGap.counts, 12, nameOf)}`);
line(`board-tier histogram: ${[...tierHist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `t${k}:${v}`).join("  ")}`);
line(`off-band boards:      ${offBand} / ${rows.length}  (${(100 * offBand / rows.length).toFixed(1)}%)`);
offBandEx.forEach((e) => line(`    ${e}`));

line(`\n── STRUCTURAL BUGS ──`);
const bug = (label: string, arr: string[]) => {
  line(`${label}: ${arr.length}` + (arr.length ? "  ⚠️" : "  ✓"));
  arr.slice(0, 12).forEach((e) => line(`    ${e}`));
  if (arr.length > 12) line(`    … +${arr.length - 12} more`);
};
bug("duplicate SPECIES id on one board", dupSpeciesInBoard);
bug("duplicate COMMON NAME on one board (Alpaca ×2 class)", dupCommonInBoard);
bug("duplicate SCI NAME on one board", dupSciInBoard);
bug("duplicate GROUP on one board", dupGroupInBoard);
bug("cross-class boards", crossClass);
bug("Latin-only tiles", latinOnly);
bug("malformed boards", malformed);
line("");
