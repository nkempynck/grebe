// Stamp `sepRank: "order"` onto the clades that ARE taxonomic orders, in place.
//
// WHY A PATCH AND NOT A REBUILD. This logic also lives in assemble-taxonomy step 6, which is
// where it belongs for a from-scratch build. But re-running `npm run build:taxonomy` today
// costs 1119 common names and 140 clade labels — build-names refetches Wikidata, and it
// currently returns less than it did when taxonomy.json was last built (3332 named species
// before, 2223 after; Chilean Lantern Tree, Palo santo and Gumbo limbo simply vanish). Those
// names are what Branches builds its groups from, so a rebuild silently degrades a shipped
// game. Until that fetch is made resilient, changes of this shape are applied to the file we
// have rather than regenerated. Nothing here reads the network.
//
// WHAT IT FIXES. Kinship and Branches read difficulty off the RANK of the MRCA between two
// groups, walking up to the first ranked ancestor. Whole order-level nodes are missing that
// rank: measured over two generated years the walk landed on `infraclass` for 88% of fish
// boards and 82% of bird ones, against 1% of mammal boards, so both classes scored a
// near-constant 4 whatever their groups were. That is what let four different bird ORDERS —
// a toucan, a hawk, an owl and a kingfisher — clear every difficulty gate onto a Sunday.
//
// Open Tree knows the orders; the build just never asked it. sel-family-order.json holds the
// answer per family (see resolve-family-orders.mjs), and grouping our species by it gives
// clean clades for every bird order.
//
// Sets `sepRank`, NEVER `rank`: Lineage's nearestAncestorOfRank stops at the first ancestor
// ranked above the one it wants, so a real "order" here would silently move win targets on
// already-pinned days. separationTierOf reads `sepRank ?? rank`; nothing else looks at it.
// It also adds no NAMES — Branches groups on the shallowest NAMED clade, and naming these
// nodes changed its grouping underneath it (tier 7 stopped being able to field some boards).
//
//   node scripts/patch-order-sepranks.mjs [--dry]

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const TAX = resolve(ROOT, "src/data/taxonomy.json");
const dry = process.argv.includes("--dry");

const doc = JSON.parse(readFileSync(TAX, "utf8"));
const nodes = doc.nodes;
const byId = new Map(nodes.map((n) => [n.id, n]));
const childrenOf = new Map();
for (const n of nodes) if (n.parentId) (childrenOf.get(n.parentId) ?? childrenOf.set(n.parentId, []).get(n.parentId)).push(n.id);

const chain = (id) => { const out = []; for (let c = id; c; c = byId.get(c)?.parentId) out.push(c); return out; };
const mrcaOf = (ids) => {
  let acc = chain(ids[0]);
  for (const id of ids.slice(1)) {
    const s = new Set(chain(id));
    acc = acc.filter((x) => s.has(x));
    if (!acc.length) return null;
  }
  return acc[0];
};
const leavesUnder = (root) => {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const id = stack.pop();
    const kids = childrenOf.get(id) ?? [];
    if (!kids.length) out.push(id);
    else for (const k of kids) stack.push(k);
  }
  return out;
};

const orderOfFamily = JSON.parse(readFileSync(resolve(C, "sel-family-order.json"), "utf8"));
const inset = JSON.parse(readFileSync(resolve(C, "sel-inset.json"), "utf8"));

const orderOfSpecies = new Map();
for (const s of inset) {
  const id = String(s.gbif ?? "");
  const order = s.family && orderOfFamily[s.family];
  if (id && order && byId.has(id)) orderOfSpecies.set(id, order);
}
console.log(`${orderOfSpecies.size} of ${inset.length} in-set species matched a tree node and an order`);

const byOrder = new Map();
for (const [id, order] of orderOfSpecies) (byOrder.get(order) ?? byOrder.set(order, []).get(order)).push(id);

let stamped = 0, impure = 0, tooSmall = 0, alreadyRanked = 0;
const touched = [];
for (const [order, ids] of byOrder) {
  if (ids.length < 2) { tooSmall++; continue; }
  const m = mrcaOf(ids);
  const node = m && byId.get(m);
  if (!node || node.rank === "species") continue;
  // Purity: the node must hold this order and nothing else, or we would be calling some
  // broader clade an order.
  const leaves = leavesUnder(m);
  if (leaves.some((id) => orderOfSpecies.get(id) !== order)) { impure++; continue; }
  // Never overwrite information the tree already carries.
  if (node.rank && node.rank !== "clade" && node.rank !== "no rank") { alreadyRanked++; continue; }
  if (node.sepRank) { alreadyRanked++; continue; }
  if (!dry) node.sepRank = "order";
  stamped++;
  touched.push(`${order} (${leaves.length} spp)`);
}

console.log(`stamped ${stamped} order clades; ${alreadyRanked} already ranked, ${impure} impure, ${tooSmall} single-species`);
console.log("  " + touched.slice(0, 14).join(", ") + (touched.length > 14 ? ", …" : ""));

if (dry) { console.log("\n--dry: nothing written"); process.exit(0); }

// Names must be untouched — this patch exists precisely because a rebuild loses them.
const named = nodes.filter((n) => n.common).length;
writeFileSync(TAX, JSON.stringify(doc));
console.log(`\n✓ wrote ${TAX}\n  ${nodes.length} nodes, ${named} with a common name, ${nodes.filter((n) => n.sepRank).length} with a sepRank`);
