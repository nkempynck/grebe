// Diagnostic: replicate grid.ts theme/container discovery and report how 7,600 species
// funnel down to the container pool, stage by stage. Bundle like preview-kinship.
import { loadRichTree } from "../src/data/loadTaxonomy";
import { leavesUnder } from "../src/core/tree";

const MIN_THEME_LEAVES = 4, MAX_THEME_LEAVES = 25;
const MIN_BOARD_FAME = 3500;
const GRID_GROUPS = 4;
const MARKER_TO_GROUP = new Map<string, string>();
for (const [g, ms] of Object.entries({
  Mammals: ["Mammalia"], Birds: ["Aves"], Fish: ["Actinopterygii", "Elasmobranchii", "Chondrichthyes"],
  Reptiles: ["Squamata", "Testudines", "Crocodylia"], Amphibians: ["Amphibia"], Insects: ["Insecta"],
  Plants: ["Magnoliopsida", "Liliopsida", "Pinopsida", "Polypodiopsida"],
  Molluscs: ["Gastropoda", "Bivalvia", "Cephalopoda"], Spiders: ["Arachnida"],
})) for (const m of ms) MARKER_TO_GROUP.set(m, g);

const tree = await loadRichTree();
const isLeaf = (id: string) => (tree.childrenOf.get(id) ?? []).length === 0;
const views = (id: string) => tree.byId.get(id)?.views ?? 0;
const median = (xs: number[]) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const fameOf = (leaves: string[]) => median([...leaves].sort((a, b) => views(b) - views(a)).slice(0, 4).map(views));
const groupOf = (id: string) => { let g = "other"; for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) { const s = tree.byId.get(c)?.sciName; if (s && MARKER_TO_GROUP.has(s)) g = MARKER_TO_GROUP.get(s)!; } return g; };

// ---- themes ----
let internal = 0, namedLabel = 0;
const themes = new Map<string, { leaves: string[]; named: boolean; fame: number }>();
for (const node of tree.byId.values()) {
  if (isLeaf(node.id)) continue;
  internal++;
  if (!node.sciName && !node.common) continue;
  namedLabel++;
  const named = leavesUnder(tree, node.id).filter((id) => tree.byId.get(id)?.common);
  if (named.length < MIN_THEME_LEAVES || named.length > MAX_THEME_LEAVES) continue;
  themes.set(node.id, { leaves: named, named: Boolean(node.common), fame: fameOf(named) });
}
const themesAboveFloor = [...themes.values()].filter((t) => t.fame >= MIN_BOARD_FAME).length;

// ---- containers (shallowest named theme per branch, bottom-up) ----
const top = new Map<string, any[]>();
const compute = (id: string): any[] => {
  const c = top.get(id); if (c) return c;
  const below: any[] = [];
  for (const ch of tree.childrenOf.get(id) ?? []) below.push(...compute(ch));
  const self = themes.get(id); let res: any[];
  if (self && self.named) res = [{ id, ...self }];
  else if (self) res = below.some((t) => t.named) ? below : [{ id, ...self }];
  else res = below;
  top.set(id, res); return res;
};
compute(tree.rootId);

let cAll = 0, cInClass = 0, cAfterFloor = 0;
const byGroup = new Map<string, number>();
const rankOf = (id: string) => tree.byId.get(id)?.rank ?? "?";
const contFameTiers: number[] = [];
for (const [id, list] of top) {
  if (list.length < GRID_GROUPS) continue;
  cAll++;
  if (groupOf(id) === "other") continue;
  cInClass++;
  const survivors = list.filter((t: any) => t.fame >= MIN_BOARD_FAME);
  if (survivors.length < GRID_GROUPS) continue;
  cAfterFloor++;
  byGroup.set(groupOf(id), (byGroup.get(groupOf(id)) ?? 0) + 1);
}

const species = [...tree.byId.values()].filter((n) => isLeaf(n.id)).length;
const namedSpecies = [...tree.byId.values()].filter((n) => isLeaf(n.id) && n.common).length;
console.log(`rich tree: ${species} leaves (${namedSpecies} named), ${internal} internal nodes`);
console.log(`\nTHEMES (clade with 4–25 named species):`);
console.log(`  internal nodes with a label:        ${namedLabel}`);
console.log(`  → qualify as a theme (4–25 named):  ${themes.size}`);
console.log(`  → theme fame ≥ ${MIN_BOARD_FAME} (showable):     ${themesAboveFloor}`);
console.log(`\nCONTAINERS (node with ≥4 disjoint themes):`);
console.log(`  ≥4 disjoint themes:                 ${cAll}`);
console.log(`  → within one Lineage class:         ${cInClass}`);
console.log(`  → still ≥4 themes above fame floor:  ${cAfterFloor}  (THIS is the pool)`);
console.log(`\ncontainers by class:`);
for (const [g, n] of [...byGroup].sort((a, b) => b[1] - a[1])) console.log(`  ${g.padEnd(11)} ${n}`);

// ---- fame-floor sweep: containers in pool at various floors ----
console.log(`\nCONTAINER POOL vs fame floor:`);
for (const floor of [3500, 3000, 2500, 2000, 1500, 1000, 0]) {
  let n = 0; const g = new Map<string, number>();
  for (const [id, list] of top) {
    if (list.length < GRID_GROUPS || groupOf(id) === "other") continue;
    if (list.filter((t: any) => t.fame >= floor).length < GRID_GROUPS) continue;
    n++; g.set(groupOf(id), (g.get(groupOf(id)) ?? 0) + 1);
  }
  const rept = g.get("Reptiles") ?? 0, amph = g.get("Amphibians") ?? 0, plant = g.get("Plants") ?? 0;
  console.log(`  floor ${String(floor).padStart(4)}:  ${n} containers   (reptiles ${rept}, amphibians ${amph}, plants ${plant})`);
}
