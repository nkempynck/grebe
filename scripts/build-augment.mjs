// Build the KINSHIP/BRANCHES augment: a quality-filtered, trimmed slice of the
// out-of-set guess index, baked into src/data/taxonomyAugment.json.
//
// WHY a separate file (not taxonomy.json): Lineage's answerable pool MUST stay the
// curated in-set (taxonomy.json) or the game becomes borderline impossible — it
// would pick obscure daily answers. Kinship/Branches don't name a hidden species;
// they sort recognisable tiles into clades, so they can safely draw from a LARGER
// pool. This augment is grafted onto the tree ONLY for those two games (see
// loadRichTree in loadTaxonomy.ts). It is lazy-loaded — a separate chunk fetched
// only when a player opens Kinship/Branches — so the initial page never grows.
//
// Source: src/data/guessIndex.generated.json — already occurrence-capped per group
// at harvest, so the obscure deep tail is gone. We keep SPECIES with a clean English
// common name, then TRIM to the "useful" ones: a species is kept only if it lands
// under a clade that can actually field a Kinship group — a named internal clade
// with MIN..MAX leaves. Species stranded in clades too small (can't form a group of
// four) or too big (never a coherent theme) are dropped: they only add weight.
//
// Output: compact flat nodes { id, sciName, common, rank, parentId } — the same
// shape as taxonomy.json, deduplicated (each new ancestor clade once), so the file
// stays small. loadRichTree merges these onto the base node list and buildTree()s.
//
// Run: node scripts/build-augment.mjs   (no network; pure transform)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, "..", "src", "data");

const base = JSON.parse(readFileSync(join(DATA, "taxonomy.json"), "utf8"));
const index = JSON.parse(readFileSync(join(DATA, "guessIndex.generated.json"), "utf8"));

const MIN_THEME_LEAVES = 4;   // must match src/core/grid.ts
const MAX_THEME_LEAVES = 25;

// ---- 1. quality filter: species with a clean English common name ----
const FOREIGN = /\b(de|du|des|la|le|les|van|von|der|del|di|da|dos|das)\b/i;
function cleanCommon(common, sci) {
  if (!common) return false;
  const c = common.trim();
  if (c.length < 3) return false;
  // A single short word unrelated to the species ("Abbey" for a poplar) — junk.
  if (!/[\s-]/.test(c) && c.length < 6 && !sci.toLowerCase().includes(c.toLowerCase())) return false;
  if (FOREIGN.test(c)) return false; // leaked non-English vernaculars
  return true;
}

const seen = new Set();
const candidates = []; // { id, sciName, common, rank, lineage }
let dropRank = 0, dropName = 0, dropDup = 0;
for (const e of index.entries) {
  const g = e.graft;
  if (!g || g.rank !== "species") { dropRank++; continue; }
  if (!cleanCommon(g.common, g.sciName)) { dropName++; continue; }
  if (seen.has(g.id) || !Array.isArray(g.lineage) || g.lineage.length === 0) { dropDup++; continue; }
  seen.add(g.id);
  candidates.push(g);
}

// ---- 2. build the combined graph (base + candidate augment nodes) ----
const baseIds = new Set(base.nodes.map((n) => n.id));
const node = new Map();       // id -> { id, sciName, common, rank, parentId }
const children = new Map();   // id -> id[]
for (const n of base.nodes) {
  node.set(n.id, n);
  if (n.parentId) (children.get(n.parentId) ?? children.set(n.parentId, []).get(n.parentId)).push(n.id);
}
const augIds = new Set();      // candidate species ids
for (const g of candidates) {
  augIds.add(g.id);
  const chain = [{ id: g.id, sciName: g.sciName, common: g.common, rank: g.rank }, ...g.lineage];
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i], parent = chain[i + 1];
    if (baseIds.has(n.id)) break;             // reached the shipped connection point
    if (!node.has(n.id)) {
      const rec = { id: n.id, sciName: n.sciName, common: n.common ?? undefined, rank: n.rank, parentId: parent ? parent.id : null };
      node.set(n.id, rec);
      if (rec.parentId) (children.get(rec.parentId) ?? children.set(rec.parentId, []).get(rec.parentId)).push(n.id);
    }
  }
}

// leaf counts (memoised DFS) over the combined graph
const leafCount = new Map();
function leaves(id) {
  const memo = leafCount.get(id);
  if (memo !== undefined) return memo;
  const kids = children.get(id);
  let c = 0;
  if (!kids || kids.length === 0) c = 1;
  else for (const k of kids) c += leaves(k);
  leafCount.set(id, c);
  return c;
}

// ---- 3a. prominence: keep species people actually look up ----
// Recognisability ≈ fame, which we measure with WIKIPEDIA PAGEVIEWS (enrich-wiki.mjs)
// rather than GBIF occurrence counts — occurrence tracks survey effort and is
// geographically biased (it kept heavily-logged obscure moths and dropped common
// butterflies). We use views of the article at the SCIENTIFIC name: unambiguous (no
// "Herald"→newspaper false hits) and it resolves redirects to the real article even
// when it's titled by the common name (Panthera leo → "Lion"). No article, or fewer
// than MIN_VIEWS over the ~60-day window, ⇒ obscure, dropped — the same bar across
// every group, since fame is comparable in a way record-counts are not.
const VIEWS_FILE = join(DATA, "wikiViews.json");
if (!existsSync(VIEWS_FILE)) {
  console.error("Missing src/data/wikiViews.json — run: node scripts/enrich-wiki.mjs");
  process.exit(1);
}
const views = JSON.parse(readFileSync(VIEWS_FILE, "utf8"));
const MIN_VIEWS = Number(process.env.MIN_VIEWS ?? 200); // ~60-day pageview floor
const prominentEnough = (id) => (views[id]?.s ?? 0) >= MIN_VIEWS;

// ---- 3b. trim: keep an augment species only if it's prominent AND sits under a theme-eligible clade ----
const isThemeClade = (id) => {
  const n = node.get(id);
  if (!n || !(n.sciName || n.common)) return false;
  const kids = children.get(id);
  if (!kids || kids.length === 0) return false; // internal only
  const l = leaves(id);
  return l >= MIN_THEME_LEAVES && l <= MAX_THEME_LEAVES;
};
const usefulSpecies = new Set();
let dropSparse = 0;
for (const id of augIds) {
  if (!prominentEnough(id)) { dropSparse++; continue; }
  for (let cur = id; cur; cur = node.get(cur)?.parentId) {
    if (cur !== id && isThemeClade(cur)) { usefulSpecies.add(id); break; }
  }
}

// ---- 4. emit the kept augment nodes (species + the new clades on their chains) ----
const keep = new Map();
for (const g of candidates) {
  if (!usefulSpecies.has(g.id)) continue;
  const chain = [{ id: g.id, sciName: g.sciName, common: g.common, rank: g.rank }, ...g.lineage];
  for (let i = 0; i < chain.length; i++) {
    const n = chain[i], parent = chain[i + 1];
    if (baseIds.has(n.id)) break;
    if (!keep.has(n.id)) keep.set(n.id, { id: n.id, sciName: n.sciName, common: n.common ?? undefined, rank: n.rank, parentId: parent ? parent.id : null });
  }
}
// Stable order (by id) → reproducible builds and deterministic daily boards.
const nodes = [...keep.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

const payload = { generatedAt: new Date().toISOString(), count: nodes.length, nodes };
const json = JSON.stringify(payload);
writeFileSync(join(DATA, "taxonomyAugment.json"), json);

const speciesKept = nodes.filter((n) => n.rank === "species").length;
console.log(`kept ${usefulSpecies.size} useful species (of ${candidates.length} clean; dropped rank=${dropRank} name=${dropName} dup=${dropDup} obscure=${dropSparse} @${MIN_VIEWS}views)`);
console.log(`augment nodes: ${nodes.length} (${speciesKept} species + ${nodes.length - speciesKept} new clades)`);
console.log(`file: ${(json.length / 1024).toFixed(0)} KB raw | ${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped`);
console.log(`wrote src/data/taxonomyAugment.json`);
