// Build src/data/taxonomyAugment.json — the OUT-OF-SET depth layer for Kinship &
// Branches (never touches Lineage, which stays on the curated in-set tree).
//
// The in-set tree is small and curated-famous: each genus caps at 3 species and only
// ~2,300 genera (858 families) ship at all. That starves the board generator of clade
// variety. This grafts extra NAMED pool species onto the tree so those two games get
// real breadth, while Lineage's shipped answer pool stays small. Three grafts:
//
//   1. DEPTH  — top up genera we already ship, up to AUG_PER_GENUS species each (the
//      in-set cap of 3 is too shallow to field "four Panthera" style genus boards).
//   2. BREADTH (genus) — add NEW genera (not in-set) under families we already ship, as
//      fresh genus nodes, when the pool has ≥ NEW_GENUS_MIN named species for them.
//   3. BREADTH (family) — add NEW families (not in-set at all) that field at least one
//      eligible group, placing each under its nearest in-set ancestor via the OTL newick
//      topology (so the class boundary Mammalia/Aves/… is inherited and no board crosses
//      a class). Yields obscurer clades the curated set skipped (extra reptiles, plants…).
//
// Named-only (a Wikipedia article title differing from the Latin name) — a bare-Latin
// tile is an un-guessable dud. Pageviews (`views`) ride along for difficulty scaling.
//
// New-family placement (phase 3) is resolved offline by scripts/pull-family-anchors.mjs
// into sel-family-anchors.json (family -> nearest in-set ancestor ott); run that first
// when the pool/classification changes.
//
//   node scripts/build-augment.mjs
//   reads: src/data/taxonomy.json, node_modules/.cache/{sel-pool,sel-classify-otl,sel-family-anchors}.json
//   writes: src/data/taxonomyAugment.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");

// Max species per genus node (in-set + augment). A board shows only 4 from a genus, so
// this is headroom for daily variety / anti-repeat, not board size — kept modest so the
// file stays small and no single genus dominates.
const AUG_PER_GENUS = 10;
// A NEW genus/family is only worth adding if it can be its own group — four named species.
const NEW_GENUS_MIN = 4;
// A theme needs a coherent number of leaves; a family with more than this can't itself be
// a group (matches MAX_THEME_LEAVES in grid.ts) but can still host genus groups.
const MAX_THEME_LEAVES = 25;

// Junk taxa (by scientific name) to keep OUT of the augment. The Wikidata/GBIF pool
// carries a few cryptids and disputed "species" that have Wikipedia articles but aren't
// valid — as tiles they read as real organisms and pad a genus to a fake group. Add a
// line here whenever one surfaces.
const EXCLUDE_SCI = new Set([
  "Trichechus hydropithecus", // "Steller's sea ape" — a cryptid, never a valid species
  "Trichechus pygmaeus",      // "Dwarf manatee" — disputed; widely held to be juvenile Amazonian manatees
]);

const tax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));
const classify = JSON.parse(readFileSync(resolve(C, "sel-classify-otl.json"), "utf8")).byName;
const familyAnchor = JSON.parse(readFileSync(resolve(C, "sel-family-anchors.json"), "utf8")).byFamily;

// ---- existing tree structure we graft onto ----
const genusNodeBySci = new Map(); // genus sci -> genus node id
const famNodeBySci = new Map();   // family sci -> family node id
const insetOtt = new Set();       // every in-set clade node id of the form ott<n>
const allNodeIds = new Set();
for (const n of tax.nodes) {
  allNodeIds.add(n.id);
  if (/^ott\d+$/.test(n.id)) insetOtt.add(n.id);
  if (n.rank === "genus" && n.sciName) genusNodeBySci.set(n.sciName, n.id);
  if (n.rank === "family" && n.sciName) famNodeBySci.set(n.sciName, n.id);
}
const inSetSci = new Set();
for (const n of tax.nodes) if (n.rank === "species") inSetSci.add(n.sciName);
const genusIdToSci = new Map([...genusNodeBySci].map(([sci, id]) => [id, sci]));
const inSetCountByGenus = new Map(); // genus sci -> # in-set species already shipped
for (const n of tax.nodes) {
  if (n.rank !== "species") continue;
  const gSci = genusIdToSci.get(n.parentId);
  if (gSci) inSetCountByGenus.set(gSci, (inSetCountByGenus.get(gSci) ?? 0) + 1);
}

// ---- bucket candidate species by graft kind ----
const named = (s) => s.article && s.article.toLowerCase() !== s.sci.toLowerCase() && s.sci.split(/\s+/).length === 2;
const augId = (s) => `aug${s.gbif ?? s.qid ?? s.sci.replace(/\s+/g, "_")}`;
const genusNodeId = (genus) => `auggen_${genus.replace(/[^A-Za-z0-9]+/g, "_")}`;

const genusBuckets = new Map(); // genus sci -> { isNew, parentId, species: [] }  (DEPTH + BREADTH-genus)
const famBuckets = new Map();   // family sci -> { ott, genera: Map(genus->[]) }   (BREADTH-family)
for (const s of pool) {
  if (inSetSci.has(s.sci)) continue;
  if (EXCLUDE_SCI.has(s.sci)) continue; // cryptid / disputed non-species
  if (!named(s)) continue;
  if (genusNodeBySci.has(s.genus)) {
    let b = genusBuckets.get(s.genus);
    if (!b) genusBuckets.set(s.genus, (b = { isNew: false, parentId: genusNodeBySci.get(s.genus), species: [] }));
    b.species.push({ ...s, common: s.article });
  } else if (s.family && famNodeBySci.has(s.family)) {
    let b = genusBuckets.get(s.genus);
    if (!b) genusBuckets.set(s.genus, (b = { isNew: true, parentId: famNodeBySci.get(s.family), species: [] }));
    b.species.push({ ...s, common: s.article });
  } else if (s.family && classify[s.family]?.ott) {
    let f = famBuckets.get(s.family);
    if (!f) famBuckets.set(s.family, (f = { ott: classify[s.family].ott, genera: new Map() }));
    (f.genera.get(s.genus) ?? f.genera.set(s.genus, []).get(s.genus)).push({ ...s, common: s.article });
  }
}

// ---- emit ----
const nodes = [];
const usedId = new Set();
const usedSci = new Set();
let depthGenera = 0, breadthGenera = 0, newFamilies = 0, newFamGenera = 0;

/** Take up to `room` unused, named species (fame-first) as species nodes under parentId. */
function takeSpecies(list, room, parentId) {
  const out = [];
  for (const s of [...list].sort((a, b) => (b.v ?? 0) - (a.v ?? 0))) {
    if (out.length >= room) break;
    const id = augId(s);
    if (usedId.has(id) || usedSci.has(s.sci)) continue;
    usedId.add(id); usedSci.add(s.sci);
    out.push({ id, sciName: s.sci, common: s.common, rank: "species", parentId, views: s.v });
  }
  return out;
}

// 1+2) DEPTH and BREADTH-genus
for (const [genus, b] of genusBuckets) {
  if (b.isNew) {
    const gid = genusNodeId(genus);
    if (allNodeIds.has(gid) || usedId.has(gid)) continue;
    const sp = takeSpecies(b.species, AUG_PER_GENUS, gid);
    if (sp.length < NEW_GENUS_MIN) continue; // can't field a group — skip the whole genus
    usedId.add(gid);
    nodes.push({ id: gid, sciName: genus, rank: "genus", parentId: b.parentId }, ...sp);
    breadthGenera++;
  } else {
    const room = AUG_PER_GENUS - (inSetCountByGenus.get(genus) ?? 0);
    if (room <= 0) continue;
    const sp = takeSpecies(b.species, room, b.parentId);
    if (sp.length) { nodes.push(...sp); depthGenera++; }
  }
}

// 3) BREADTH-family: new families under their nearest in-set ancestor (resolved offline
//    by pull-family-anchors.mjs — the induced-subtree topology doesn't contain them).
for (const [family, f] of famBuckets) {
  const anchor = familyAnchor[family];
  if (!anchor || !insetOtt.has(anchor)) continue; // unplaceable → skip (no class wiring guessed)
  const famId = `ott${f.ott}`;
  if (allNodeIds.has(famId) || usedId.has(famId)) continue;
  // Build this family's genus nodes + species first, so we know if it's eligible.
  const famNodes = [];
  let leaves = 0, hasGenusTheme = false;
  for (const [genus, list] of f.genera) {
    const gid = genusNodeId(genus);
    if (allNodeIds.has(gid) || usedId.has(gid)) continue;
    const sp = takeSpecies(list, AUG_PER_GENUS, gid);
    if (!sp.length) continue;
    usedId.add(gid);
    famNodes.push({ id: gid, sciName: genus, rank: "genus", parentId: famId }, ...sp);
    leaves += sp.length;
    if (sp.length >= NEW_GENUS_MIN) hasGenusTheme = true;
  }
  // Eligible only if it can be a group: a usable family-theme (4–25 leaves) or a genus-theme.
  const eligible = hasGenusTheme || (leaves >= NEW_GENUS_MIN && leaves <= MAX_THEME_LEAVES);
  if (!eligible) { for (const n of famNodes) if (n.rank === "genus") usedId.delete(n.id); continue; }
  usedId.add(famId);
  nodes.push({ id: famId, sciName: family, rank: "family", parentId: anchor }, ...famNodes);
  newFamilies++;
  newFamGenera += famNodes.filter((n) => n.rank === "genus").length;
}

nodes.sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || (a.sciName < b.sciName ? -1 : 1));
const OUT = resolve(ROOT, "src/data/taxonomyAugment.json");
writeFileSync(OUT, JSON.stringify({ nodes }));
const species = nodes.filter((n) => n.rank === "species").length;
console.log(`✓ augment: ${species} species, ${breadthGenera + newFamGenera} new genera, ${newFamilies} new families`);
console.log(`  1. depth  (top-up in-set genera):            ${depthGenera} genera`);
console.log(`  2. breadth (new genera / in-set families):   ${breadthGenera} genera`);
console.log(`  3. breadth (new families via OTL topology):  ${newFamilies} families, ${newFamGenera} genera`);
console.log(`  wrote ${OUT} (${(Buffer.byteLength(JSON.stringify({ nodes })) / 1024).toFixed(0)} KB)`);
