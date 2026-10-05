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
import { EXCLUDE_SCI } from "./exclude-taxa.mjs";
import { cleanCommon } from "./clean-common.mjs";
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

// Junk taxa to keep out — now shared with build-pool.mjs, which builds the BASE set and
// used not to consult this list at all (see exclude-taxa.mjs for why that mattered).

// --add-only keeps every node of the current augment exactly as it is and only ADDS species.
// Pinned Kinship/Branches boards reference augment ids, so a full rebuild that moved or dropped
// one would break a frozen board; adding is always safe. New species must clear
// ADD_MIN_VIEWS so the additions are not obscure; the per-genus cap counts what is there.
// --fix-only is add-only that adds nothing: it only applies the moves below to the current augment.
const FIX_ONLY = process.argv.includes("--fix-only");
const ADD_ONLY = FIX_ONLY || process.argv.includes("--add-only");
const ADD_MIN_VIEWS = 1000;
const AUG_PATH = resolve(ROOT, "src/data/taxonomyAugment.json");
const existing = ADD_ONLY ? JSON.parse(readFileSync(AUG_PATH, "utf8")).nodes : [];
const baseTax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
// Everything already in the tree, base plus (in add-only mode) the current augment, is the
// structure new species are placed against.
const tax = { nodes: [...baseTax.nodes, ...existing] };
// English names from Wikidata (P1843), for species whose article sits under a Latin title.
// Optional: without the cache (scripts/pull-pool-names.mjs) only article titles name a species.
const splitGenera = new Set(JSON.parse(readFileSync(resolve(ROOT, "src/data/junctionSplits.json"), "utf8")).splits.flatMap((x) => x.genera));
const P1843_PATH = resolve(C, "sel-pool-p1843.json");
const p1843 = existsSync(P1843_PATH) ? JSON.parse(readFileSync(P1843_PATH, "utf8")) : {};
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
// A genus name can also cross kingdoms, and then there may be only ONE node to match: Linaria
// is the linnets and the toadflaxes, but the base tree has a genus node only for the birds, so
// the one-candidate path above grafted three toadflaxes under "Linnets". Families can't catch
// this (they differ between classifications too, Centropidae vs Cuculidae for the coucals);
// the kingdom can. A species whose graft lands in the other kingdom goes to its own family.
const KINGDOM_CLADE = { Metazoa: "Animalia", Chloroplastida: "Plantae" };
function kingdomOf(id) {
  for (let c = id; c; c = nodeById.get(c)?.parentId) {
    const k = KINGDOM_CLADE[nodeById.get(c)?.sciName];
    if (k) return k;
  }
  return null;
}
const sameKingdom = (id, kingdom) => !kingdom || !kingdomOf(id) || kingdomOf(id) === kingdom;
/** Where a species goes when its genus name resolved into the other kingdom: its family (or
 *  the genus anchor inside it), never a new genus node, since the name is taken. Null: skip. */
const familyHome = (s) => {
  const home = s.family && famNodeBySci.has(s.family) ? newGenusParent(s.genus, s.family) : null;
  return home && sameKingdom(home, s.kingdom) ? home : null;
};
// Add-only keeps existing nodes, but one grafted into the wrong kingdom is moved (same id, so
// a board that dealt it still resolves).
const poolBySci = new Map(pool.map((s) => [s.sci, s]));
let moved = 0;
for (const n of existing) {
  const s = n.rank === "species" && poolBySci.get(n.sciName);
  if (!s || sameKingdom(n.parentId, s.kingdom)) continue;
  const home = familyHome(s);
  if (!home) { console.warn(`! ${n.sciName} sits in the wrong kingdom and its family is not in the tree`); continue; }
  n.parentId = home;
  moved++;
}
// The pool's family can also be plain wrong: it filed the whole of Nolinoideae (Dracaena,
// Sansevieria, Maianthemum…) under Solanaceae, so a minted genus landed among the nightshades.
// Lumping and splitting disagree about families all the time (lories in or out of Psittacidae),
// so the test is the ORDER: an augment genus whose family sits in another order than Open Tree's
// lineage of its species moves (same id) to where Open Tree puts it, the tree MRCA of the other
// species sharing their nearest Open Tree ancestor. Offline: reads the committed ott-lineages.json.
const OTT_PATH = resolve(ROOT, "scripts/ott-lineages.json");
const ott = existsSync(OTT_PATH) ? JSON.parse(readFileSync(OTT_PATH, "utf8")) : { species: {}, taxa: {} };
const ottLine = (sci) => {
  const out = [];
  for (let t = ott.species[sci]; t != null && out.length < 200; t = ott.taxa[t]?.[2]) out.push(t);
  return out;
};
const ottOrderUp = (t) => {
  for (; t != null; t = ott.taxa[t]?.[2]) if (ott.taxa[t]?.[1] === "order") return ott.taxa[t][0];
  return null;
};
const ottFamilyOrders = new Map(); // family name -> the orders Open Tree puts a family of that name in
for (const [t, [name, rank]] of Object.entries(ott.taxa))
  if (rank === "family") (ottFamilyOrders.get(name) ?? ottFamilyOrders.set(name, new Set()).get(name)).add(ottOrderUp(Number(t)));
const wrongOrder = (sci, family) => {
  const mine = ottOrderUp(ott.species[sci]);
  const theirs = ottFamilyOrders.get(family);
  return !!(mine && theirs?.size && !theirs.has(mine));
};
const ancestorsOf = (id) => {
  const out = [];
  for (let c = id; c; c = nodeById.get(c)?.parentId) out.push(c);
  return out;
};
const misplaced = [];
for (const g of existing) {
  if (g.rank !== "genus" || !g.id.startsWith("auggen_")) continue;
  const family = familyOf(g.parentId);
  const kids = existing.filter((n) => n.parentId === g.id && n.rank === "species");
  if (family && kids.length && kids.every((n) => wrongOrder(n.sciName, family))) misplaced.push({ g, family, kids });
}
// None of the misplaced species may count as kin when finding a home, or one wrong graft drags
// the other's MRCA up to wherever it sits.
const mine = new Set(misplaced.flatMap((m) => m.kids.map((n) => n.sciName)));
let reordered = 0;
for (const { g, family, kids } of misplaced) {
  let home = null;
  for (const t of ottLine(kids[0].sciName).slice(1)) {
    const kin = tax.nodes.filter((n) => n.rank === "species" && !mine.has(n.sciName) && ottLine(n.sciName).includes(t));
    if (kin.length < 2) continue;
    const common = new Set(ancestorsOf(kin[0].parentId));
    for (const k of kin.slice(1)) { const a = new Set(ancestorsOf(k.parentId)); for (const c of common) if (!a.has(c)) common.delete(c); }
    home = [...common][0];
    break;
  }
  if (!home) { console.warn(`! ${g.sciName} sits in the wrong order (${family}) and Open Tree gives no home`); continue; }
  g.parentId = home;
  reordered++;
}
// FAMILY BAGS. Phase 3 below adds a family the base tree has no NAMED node for under its nearest
// named ancestor. Where the base tree already held that family's other members in an unnamed
// clade, the family appeared twice: a flat bag of new genera beside the real clade (parrots
// in a "Psittacidae" bag beside Psittacoidea, so a lovebird and an amazon read as one family and
// an amazon and a macaw as merely one order). scripts/pull-augment-anchors.mjs resolves, from
// Open Tree's synthetic tree, where each bagged genus belongs and where a genuinely new family
// fits more precisely; applied here by id. The emptied bags stay as empty nodes, so boards that
// were served with one as a group keep their label; with no species under them no game uses them.
const ANCHORS_PATH = resolve(ROOT, "scripts/augment-anchors.json");
const anchors = existsSync(ANCHORS_PATH) ? JSON.parse(readFileSync(ANCHORS_PATH, "utf8")) : { byGenus: {}, byFamily: {} };
let unbagged = 0, refamilied = 0;
for (const n of existing) {
  // byGenus also holds the odd species sitting directly in a bag, keyed by its own id.
  const to = n.rank === "family" ? anchors.byFamily?.[n.id] : anchors.byGenus[n.id];
  if (!to || to === n.parentId || !nodeById.has(to)) continue;
  n.parentId = to;
  if (n.rank === "family") refamilied++; else unbagged++;
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
const titleNamed = (s) =>
  s.article &&
  s.article.toLowerCase() !== s.sci.toLowerCase() &&
  !isLatinName(s.article) &&
  s.sci.split(/\s+/).length === 2;
// A species' English name: its article title when that is a vernacular, else the first Wikidata
// English common name that passes the same filter as base-tree names (build-names.mjs) and is
// neither its own binomial, nor Latin, nor just its genus, nor a name another species already has.
const takenNames = new Set(tax.nodes.filter((n) => n.rank === "species" && n.common).map((n) => n.common.toLowerCase()));
const englishName = (s) => {
  if (titleNamed(s)) return s.article;
  if (s.sci.split(/\s+/).length !== 2) return null;
  for (const raw of p1843[s.qid] ?? []) {
    const c = cleanCommon(raw);
    if (!c || isLatinName(c)) continue;
    const lc = c.toLowerCase();
    if (lc === s.sci.toLowerCase() || lc === s.genus?.toLowerCase() || takenNames.has(lc)) continue;
    return c;
  }
  return null;
};
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
let homonymSkipped = 0, crossKingdom = 0;
for (const s of pool) {
  if (inSetSci.has(s.sci)) continue;
  if (EXCLUDE_SCI.has(s.sci)) continue; // cryptid / disputed non-species
  if (ADD_ONLY && (s.v ?? 0) < ADD_MIN_VIEWS) continue;
  // A junction split's label is only honest while every displayed species of its genera sits
  // where Open Tree puts them, so a new species of one of those genera can falsify a shipped
  // split (patch-junction-splits refuses the build). Leave those genera as they are.
  if (ADD_ONLY && splitGenera.has(s.genus)) continue;
  const common = englishName(s);
  if (!common) continue;
  const gNode = genusNodeFor(s.genus, s.family);
  const baseParent = gNode ? null : baseParentFor(s.genus, s.family);
  const target = gNode ?? baseParent;
  if (target && !sameKingdom(target, s.kingdom)) {
    const home = familyHome(s);
    if (home) { bucket(s.genus, home, false).species.push({ ...s, common }); crossKingdom++; }
    else homonymSkipped++;
    continue;
  }
  // The branches below graft by the pool's FAMILY alone, so a family in the wrong order would
  // place the species wrongly (see wrongOrder above). The genus-node branch does not need it.
  if (!gNode && !baseParent && wrongOrder(s.sci, s.family)) { homonymSkipped++; continue; }
  if (gNode) {
    bucket(s.genus, gNode, false).species.push({ ...s, common });
  } else if (genusNodesBySci.has(s.genus) || baseParentByGenus.has(s.genus)) {
    // The name exists in the base tree but resolves to more than one place and the family
    // did not separate them. Skipping is the whole point of the check.
    if (baseParent) bucket(s.genus, baseParent, false).species.push({ ...s, common });
    else homonymSkipped++;
  } else if (s.family && famNodeBySci.has(s.family)) {
    bucket(s.genus, newGenusParent(s.genus, s.family), true).species.push({ ...s, common });
  } else if (s.family && classify[s.family]?.ott) {
    let f = famBuckets.get(s.family);
    if (!f) famBuckets.set(s.family, (f = { ott: classify[s.family].ott, genera: new Map() }));
    (f.genera.get(s.genus) ?? f.genera.set(s.genus, []).get(s.genus)).push({ ...s, common });
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
    if (usedId.has(id) || usedSci.has(s.sci) || takenNames.has(s.common.toLowerCase())) continue;
    usedId.add(id); usedSci.add(s.sci); takenNames.add(s.common.toLowerCase());
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
// A family whose Open Tree taxon already holds base species is in the tree, merely unnamed: adding
// it here would make a bag beside it (see FAMILY BAGS above). Skip it; a wrong graft is worse
// than a missing species.
const baseOttTaxa = new Set();
for (const n of baseTax.nodes) if (n.rank === "species") for (const t of ottLine(n.sciName)) baseOttTaxa.add(String(t));
let bagSkipped = 0;
for (const [family, f] of famBuckets) {
  if (baseOttTaxa.has(String(f.ott))) { bagSkipped++; continue; }
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

if (FIX_ONLY) nodes.length = 0;
nodes.sort((a, b) => (b.views ?? 0) - (a.views ?? 0) || (a.sciName < b.sciName ? -1 : 1));
const added = nodes.length;
// Add-only: the existing nodes first and untouched, the new ones after.
if (ADD_ONLY) nodes.unshift(...existing);
const OUT = AUG_PATH;
if (process.argv.includes("--dry")) { console.log(`(dry run: ${added} nodes would be added)`); process.exit(0); }
writeFileSync(OUT, JSON.stringify({ nodes }));
const species = nodes.filter((n) => n.rank === "species").length;
console.log(`✓ augment: ${species} species, ${breadthGenera + newFamGenera} new genera, ${newFamilies} new families`);
console.log(`  1. depth  (top-up in-set genera):            ${depthGenera} genera`);
console.log(`  2. breadth (new genera / in-set families):   ${breadthGenera} genera`);
console.log(`  3. breadth (new families via OTL topology):  ${newFamilies} families, ${newFamGenera} genera`);
console.log(`  skipped, genus name ambiguous in the base tree: ${homonymSkipped} species`);
console.log(`  genus name taken by the other kingdom, placed in its family: ${crossKingdom} species`);
if (moved) console.log(`  existing species moved out of the wrong kingdom: ${moved}`);
if (reordered) console.log(`  existing genera moved out of the wrong order: ${reordered}`);
if (bagSkipped) console.log(`  new families skipped, already in the tree unnamed: ${bagSkipped}`);
if (unbagged || refamilied) console.log(`  moved by Open Tree's synthetic tree: ${unbagged} genera (and lone species) out of family bags, ${refamilied} families deeper`);
console.log(`  wrote ${OUT} (${(Buffer.byteLength(JSON.stringify({ nodes })) / 1024).toFixed(0)} KB)`);
