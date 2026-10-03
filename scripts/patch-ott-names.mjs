// Name unnamed clades from the Open Tree Taxonomy, only where the name is provably right for the
// species we show. Offline: reads the committed scripts/ott-lineages.json (pull-ott-lineages.mjs).
//
// THE RULE (exact membership, on the RICH tree = base + augment). A junction J may take the name
// of OTT taxon T only if the species under J are exactly our species classified in T: no member
// of T outside J, no outsider inside it. Checked on the rich tree because a name exact there is
// exact in the base tree too (both sets shrink by the same species), but not the other way round.
//
// Also required: every species under J has an OTT classification; T's name is a single Latin
// word (no "rosids", "IRL clade", "Culex pipiens complex"); and the name is not already on another
// node, which catches homonyms (Morus the mulberry vs Morus the gannet) and taxa nested in
// themselves. When several taxa fit, main ranks beat sub/super ranks beat unranked, then the most
// specific wins. When several junctions share one species set, the deepest takes the name.
//
// WHAT IT WRITES. `sciName`, the taxon's rank in `sepRank` (never `rank`: Lineage's win targets
// read `rank`, and they are derived at read time, so changing it reaches already-pinned days),
// and `ottTaxon` as provenance. A made-up Kinship label it replaces stops being `synthetic`.
//
// Run after patch-drop-excluded (it needs the final topology). Idempotent.
//   node scripts/patch-ott-names.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = resolve(ROOT, "src/data/taxonomy.json");
const AUG = resolve(ROOT, "src/data/taxonomyAugment.json");
const LIN = resolve(ROOT, "scripts/ott-lineages.json");
const dry = process.argv.includes("--dry");

const base = JSON.parse(readFileSync(BASE, "utf8"));
const aug = JSON.parse(readFileSync(AUG, "utf8"));
const ott = JSON.parse(readFileSync(LIN, "utf8"));
const all = [...base.nodes, ...aug.nodes];
const byId = new Map(all.map((n) => [n.id, n]));
const kids = new Map();
for (const n of all) if (n.parentId != null) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)).push(n.id);

// Species -> set of OTT taxon ids it belongs to.
const lineageOf = (sci) => {
  const out = [];
  for (let t = ott.species[sci]; t != null; t = ott.taxa[t]?.[2]) out.push(String(t));
  return out.length ? out : null;
};
const species = all.filter((n) => n.rank === "species");
const memberCount = new Map(); // taxon -> number of our species in it
const linBySci = new Map();
// A species OTT cannot classify (a hybrid, a recent split) still counts as a member of its
// genus's lineage, so it can block a name it might falsify but never earn one: a junction that
// holds it stays unnamed (below), and one that excludes it cannot claim the genus's taxa.
const genusTaxon = new Map();
for (const [id, [name, rank]] of Object.entries(ott.taxa)) if (rank === "genus") genusTaxon.set(name, id);
const genusLineage = (sci) => {
  const g = genusTaxon.get(sci.split(" ")[0]);
  const out = [];
  for (let t = g; t != null; t = ott.taxa[t]?.[2]) out.push(String(t));
  return out;
};
for (const s of species) {
  const lin = lineageOf(s.sciName);
  if (lin) linBySci.set(s.sciName, lin);
  for (const t of lin ?? genusLineage(s.sciName)) memberCount.set(t, (memberCount.get(t) ?? 0) + 1);
}

const speciesUnder = new Map();
const under = (id) => {
  const hit = speciesUnder.get(id);
  if (hit) return hit;
  const n = byId.get(id);
  const out = n?.rank === "species" ? [id] : (kids.get(id) ?? []).flatMap(under);
  speciesUnder.set(id, out);
  return out;
};
const depth = (id) => { let d = 0; for (let x = id; x; x = byId.get(x)?.parentId) d++; return d; };

const MAIN = new Set(["kingdom", "phylum", "class", "order", "family", "genus"]);
const tier = (rank) => (MAIN.has(rank) ? 0 : rank && rank !== "no rank" ? 1 : 2);
const LATIN_WORD = /^[A-Z][a-z]+$/;
const usedNames = new Set(all.filter((n) => n.sciName && !n.synthetic && !n.ottTaxon).map((n) => n.sciName));

// Clear what an earlier run wrote, so a rerun recomputes from scratch.
let cleared = 0;
for (const n of all) if (n.ottTaxon) { n.sciName = ""; delete n.sepRank; delete n.ottTaxon; cleared++; }

const isUnnamed = (n) => n.rank !== "species" && (!n.sciName || n.synthetic) && !(n.common && !n.synthetic);
const candidates = [];
let noLineage = 0;
for (const n of all) {
  if (!isUnnamed(n)) continue;
  const L = under(n.id);
  if (L.length < 2) continue;
  const lins = L.map((id) => linBySci.get(byId.get(id).sciName));
  if (lins.some((l) => !l)) { noLineage++; continue; }
  // Taxa containing every species under J, nearest first (order of the first lineage).
  const shared = lins[0].filter((t) => lins.every((l) => l.includes(t)));
  const exact = shared.filter((t) => memberCount.get(t) === L.length);
  const ok = exact.filter((t) => LATIN_WORD.test(ott.taxa[t][0]) && !usedNames.has(ott.taxa[t][0]));
  if (!ok.length) continue;
  const pick = [...ok].sort((a, b) => tier(ott.taxa[a][1]) - tier(ott.taxa[b][1]))[0]; // stable: nearest first within a tier
  candidates.push({ id: n.id, taxon: pick, depth: depth(n.id) });
}

// One node per taxon: the deepest junction holding that species set.
const byTaxon = new Map();
for (const c of candidates) {
  const cur = byTaxon.get(c.taxon);
  if (!cur || c.depth > cur.depth || (c.depth === cur.depth && c.id < cur.id)) byTaxon.set(c.taxon, c);
}

const ranks = {};
let replacedSynthetic = 0;
for (const c of byTaxon.values()) {
  const n = byId.get(c.id);
  const [name, rank] = ott.taxa[c.taxon];
  if (n.synthetic) {
    replacedSynthetic++;
    delete n.synthetic;
    delete n.common;     // a junction split's "A & B" lives in common
    delete n.wikiTitle;  // and its wikiTitle pointed at one genus; the taxon's own article is right now
  }
  n.sciName = name;
  n.ottTaxon = `ott${c.taxon}`;
  if (rank && rank !== "no rank") n.sepRank = rank;
  ranks[rank] = (ranks[rank] ?? 0) + 1;
}

// A rank is only written where it agrees with the tree: strictly narrower than every ranked
// ancestor, strictly broader than every ranked descendant. OTT and the ranks already here come
// from different classifications (Galeomorphii is a superorder in OTT, above two clades this
// tree also calls superorders), and a contradiction would misread how close two groups are.
// Same order as check-taxonomy-ranks.mjs, which verifies the result.
const ORDER = [
  "domain", "kingdom", "subkingdom", "superphylum", "phylum", "subphylum", "infraphylum",
  "superclass", "class", "subclass", "infraclass", "subterclass", "cohort", "subcohort",
  "magnorder", "superorder", "order", "suborder", "infraorder", "parvorder",
  "superfamily", "family", "subfamily", "tribe", "subtribe",
  "genus", "subgenus", "species group", "species subgroup", "species", "subspecies",
];
const pos = (n) => { const i = ORDER.indexOf(n?.sepRank ?? n?.rank); return i < 0 ? null : i; };
const contradicts = (id) => {
  const mine = pos(byId.get(id));
  if (mine == null) return false;
  for (let p = byId.get(id).parentId; p; p = byId.get(p)?.parentId) {
    const r = pos(byId.get(p));
    if (r != null && r >= mine) return true;
  }
  const stack = [...(kids.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop();
    const r = pos(byId.get(c));
    if (r != null && r <= mine) return true;
    stack.push(...(kids.get(c) ?? []));
  }
  return false;
};
let unranked = 0;
for (let changed = true; changed; ) {
  changed = false;
  for (const c of byTaxon.values()) {
    const n = byId.get(c.id);
    if (n.sepRank && contradicts(c.id)) { delete n.sepRank; unranked++; changed = true; }
  }
}
if (unranked) console.log(`  ${unranked} named without a rank: OTT's rank contradicts the tree's`);

console.log(`OTT ${ott.source}: ${byTaxon.size} clades named (${replacedSynthetic} replaced a made-up Kinship label), ` +
  `${noLineage} skipped for an unclassified species${cleared ? `, ${cleared} earlier names recomputed` : ""}`);
console.log(`  by rank: ${Object.entries(ranks).sort((a, b) => b[1] - a[1]).map(([r, k]) => `${r} ${k}`).join(", ")}`);
if (!dry) {
  base.ottNamesPatchedAt = new Date().toISOString();
  base.ottNamesSource = ott.source;
  writeFileSync(BASE, JSON.stringify(base));
  writeFileSync(AUG, JSON.stringify(aug));
}
