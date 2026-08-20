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
// when the pool/classification changes. New-GENUS placement (phase 2) works the same way
// via scripts/pull-genus-anchors.mjs -> sel-genus-anchors.json, one rank down.
//
//   node scripts/build-augment.mjs
//   reads: src/data/taxonomy.json,
//          node_modules/.cache/{sel-pool,sel-classify-otl,sel-family-anchors,sel-genus-anchors}.json
//   writes: src/data/taxonomyAugment.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { latinBinomialTest } from "./latin-name.mjs";
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
// Where a NEW genus really belongs (phase 2). The pool's finest rank is family, so without
// this a minted genus hangs off the family node as a SIBLING of the subfamily that contains
// it — `Ovis` beside `Caprinae`, which lets a board show sheep next to "Sheep & goats" and
// makes a sheep no closer to a goat than to a gazelle. Optional: an empty map just restores
// the old family-level graft rather than failing the build.
const genusAnchor = existsSync(resolve(C, "sel-genus-anchors.json"))
  ? JSON.parse(readFileSync(resolve(C, "sel-genus-anchors.json"), "utf8")).byGenus
  : (console.warn("! sel-genus-anchors.json missing — new genera will graft at family level"), {});

// ---- existing tree structure we graft onto ----
// A GENUS NAME IS NOT A KEY. Prunella is both a bird genus (the accentors) and a mint
// (selfheal), and both have a node in the base tree. Holding them in a plain
// name -> id Map kept only one, so the augment grafted Prunella collaris and P.
// montanella into Lamiaceae and Wednesday plant boards dealt "Catnip · Selfheal ·
// Nepeta × faassenii · Alpine accentor" thirteen times over two years. Keep every
// candidate and disambiguate with the species' own family; drop it if that can't
// separate them, because a wrong graft is worse than a missing species.
const genusNodesBySci = new Map(); // genus sci -> [genus node id]
const famNodeBySci = new Map();    // family sci -> family node id
const insetOtt = new Set();        // every in-set clade node id of the form ott<n>
const allNodeIds = new Set();
const nodeById = new Map();
for (const n of tax.nodes) {
  allNodeIds.add(n.id);
  nodeById.set(n.id, n);
  if (/^ott\d+$/.test(n.id)) insetOtt.add(n.id);
  if (n.rank === "genus" && n.sciName) {
    const list = genusNodesBySci.get(n.sciName) ?? genusNodesBySci.set(n.sciName, []).get(n.sciName);
    list.push(n.id);
  }
  if (n.rank === "family" && n.sciName) famNodeBySci.set(n.sciName, n.id);
}

/** The family a base node sits in, or null when its ancestry carries no family rank. */
function familyOf(id) {
  for (let c = id; c; c = nodeById.get(c)?.parentId) {
    const n = nodeById.get(c);
    if (n?.rank === "family" && n.sciName) return n.sciName;
  }
  return null;
}
/** Which node a genus NAME means for a species of this family. One candidate: that one,
 *  unchanged. Several: the one sitting in the species' own family. No match: null, and the
 *  species is skipped rather than guessed at. */
function genusNodeFor(genusSci, family) {
  const ids = genusNodesBySci.get(genusSci);
  if (!ids?.length) return null;
  if (ids.length === 1) return ids[0];
  if (!family) return null;
  return ids.find((id) => familyOf(id) === family) ?? null;
}
const inSetSci = new Set();
for (const n of tax.nodes) if (n.rank === "species") inSetSci.add(n.sciName);
// Genera the base tree holds SPECIES of but has no genus NODE for, mapped to where those
// species actually hang. Genus injection rejects a genus whose species aren't monophyletic
// in our topology — Bison nests inside Bos, so there is no `Bos` node even though Bos taurus
// and Bos primigenius are in the tree, sitting under Bovinae. Minting `auggen_Bos` for the
// remaining Bos species then produces the board that asks you to sort one Bos into "Bovinae"
// and another into "Bos". Grafting them where their relatives already live avoids inventing
// a second home for one genus.
// Keyed genus -> family -> parent, for the same homonym reason as above: this join is on a
// genus name too, and taking the first species' parent would graft into whichever homonym
// happened to come first. With one family under a name this behaves exactly as before.
const baseParentByGenus = new Map(); // genus sci -> Map(family|"" -> parent id)
const inSetCountByGenusName = new Map();
for (const n of tax.nodes) {
  if (n.rank !== "species") continue;
  const g = n.sciName.split(/\s+/)[0];
  inSetCountByGenusName.set(g, (inSetCountByGenusName.get(g) ?? 0) + 1);
  if (genusNodesBySci.has(g)) continue;
  const byFam = baseParentByGenus.get(g) ?? baseParentByGenus.set(g, new Map()).get(g);
  const fam = familyOf(n.parentId) ?? "";
  if (!byFam.has(fam)) byFam.set(fam, n.parentId);
}
/** Where a genus with no node of its own hangs, for a species of this family. Unambiguous
 *  (one family under the name): that one, as before. Ambiguous: only an exact family match. */
function baseParentFor(genusSci, family) {
  const byFam = baseParentByGenus.get(genusSci);
  if (!byFam?.size) return null;
  if (byFam.size === 1) return [...byFam.values()][0];
  return byFam.get(family ?? "") ?? null;
}
/** Where to graft a genus the base tree has no node for: its resolved anchor (the deepest
 *  in-set ancestor OTL knows about) when there is one, else the family node as before. The
 *  anchor is re-checked here rather than trusted — it must exist and sit inside the family
 *  we meant, so a stale cache or a homonym can only cost us the old behaviour. */
function newGenusParent(genusSci, family) {
  const famId = famNodeBySci.get(family);
  const anchor = genusAnchor[`${genusSci}|${family}`];
  if (!anchor || !nodeById.has(anchor)) return famId;
  for (let c = anchor; c; c = nodeById.get(c)?.parentId) if (c === famId) return anchor;
  return famId;
}
// Names already spoken for anywhere in the base tree — never mint a second node for one.
const inSetCladeNames = new Set();
for (const n of tax.nodes) if (n.rank !== "species" && n.sciName) inSetCladeNames.add(n.sciName);
const genusIdToSci = new Map();
for (const [sci, ids] of genusNodesBySci) for (const id of ids) genusIdToSci.set(id, sci);
const inSetCountByGenus = new Map(); // genus sci -> # in-set species already shipped
for (const n of tax.nodes) {
  if (n.rank !== "species") continue;
  const gSci = genusIdToSci.get(n.parentId);
  if (gSci) inSetCountByGenus.set(gSci, (inSetCountByGenus.get(gSci) ?? 0) + 1);
}

// ---- bucket candidate species by graft kind ----
// A species counts as NAMED only if its Wikipedia title is genuinely a vernacular. Equality
// with our own binomial was never enough: Wikipedia files plenty of species under a
// SYNONYM, and that title is a different binomial that used to pass straight through.
const isLatinName = latinBinomialTest(pool);
const named = (s) =>
  s.article &&
  s.article.toLowerCase() !== s.sci.toLowerCase() &&
  !isLatinName(s.article) &&
  s.sci.split(/\s+/).length === 2;
const augId = (s) => `aug${s.gbif ?? s.qid ?? s.sci.replace(/\s+/g, "_")}`;
const genusNodeId = (genus) => `auggen_${genus.replace(/[^A-Za-z0-9]+/g, "_")}`;

// Buckets are keyed genus + PARENT, not genus alone: under a homonym the two nodes are
// different grafts and must not merge into one bucket.
const genusBuckets = new Map(); // `${genus}|${parentId}` -> { genus, isNew, parentId, species: [] }
const famBuckets = new Map();   // family sci -> { ott, genera: Map(genus->[]) }   (BREADTH-family)
const bucket = (genus, parentId, isNew) => {
  const k = `${genus}|${parentId}`;
  let b = genusBuckets.get(k);
  if (!b) genusBuckets.set(k, (b = { genus, isNew, parentId, species: [] }));
  return b;
};
let homonymSkipped = 0;
for (const s of pool) {
  if (inSetSci.has(s.sci)) continue;
  if (EXCLUDE_SCI.has(s.sci)) continue; // cryptid / disputed non-species
  if (!named(s)) continue;
  const gNode = genusNodeFor(s.genus, s.family);
  const baseParent = gNode ? null : baseParentFor(s.genus, s.family);
  if (gNode) {
    bucket(s.genus, gNode, false).species.push({ ...s, common: s.article });
  } else if (genusNodesBySci.has(s.genus) || baseParentByGenus.has(s.genus)) {
    // The name exists in the base tree but resolves to more than one place and the family
    // did not separate them. Skipping is the whole point of the check.
    if (baseParent) bucket(s.genus, baseParent, false).species.push({ ...s, common: s.article });
    else homonymSkipped++;
  } else if (s.family && famNodeBySci.has(s.family)) {
    bucket(s.genus, newGenusParent(s.genus, s.family), true).species.push({ ...s, common: s.article });
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
for (const b of genusBuckets.values()) {
  const genus = b.genus;
  if (b.isNew) {
    const gid = genusNodeId(genus);
    if (allNodeIds.has(gid) || usedId.has(gid)) continue;
    if (inSetCladeNames.has(genus)) continue; // the name is already someone else's node
    const sp = takeSpecies(b.species, AUG_PER_GENUS, gid);
    if (sp.length < NEW_GENUS_MIN) continue; // can't field a group — skip the whole genus
    usedId.add(gid);
    nodes.push({ id: gid, sciName: genus, rank: "genus", parentId: b.parentId }, ...sp);
    breadthGenera++;
  } else {
    const room = AUG_PER_GENUS - (inSetCountByGenus.get(genus) ?? inSetCountByGenusName.get(genus) ?? 0);
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
  if (inSetCladeNames.has(family)) continue; // the name is already someone else's node
  // Build this family's genus nodes + species first, so we know if it's eligible.
  const famNodes = [];
  let leaves = 0, hasGenusTheme = false;
  for (const [genus, list] of f.genera) {
    const gid = genusNodeId(genus);
    if (allNodeIds.has(gid) || usedId.has(gid) || inSetCladeNames.has(genus)) continue;
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
console.log(`  skipped, genus name ambiguous in the base tree: ${homonymSkipped} species`);
console.log(`  wrote ${OUT} (${(Buffer.byteLength(JSON.stringify({ nodes })) / 1024).toFixed(0)} KB)`);
