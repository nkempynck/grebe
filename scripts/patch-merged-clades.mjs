// Name the small clades that fall through every other net, by joining what is inside them:
// "Vicugna & Lama", "Curcuma & Ginger", "Onagreae & Epilobieae".
//
// A clade needs 4-25 common-named species to be a group. Plenty of real branches sit just
// under that and are invisible, and so is their parent, because OTL only labels a node when
// it happens to be a taxon in its own taxonomy. The parent of two 2-species genera holds
// four species and would make a perfectly good group; it just has no name to print on solve.
//
// This is NOT the general "name the anonymous clades" idea, which was measured repeatedly
// and failed: of 1,065 anonymous clades at usable size, 613 already have a usable group
// BELOW them, and naming those trades finer groups for coarser ones. This script takes only
// the ~140 where nothing below is usable, so the name adds a group and costs none.
//
// The labels are honest rather than invented — the clade really is "Vicugna and Lama" — and
// a label is revealed only once its group is SOLVED, so naming a member species in it
// ("Curcuma & Ginger") tells the player nothing while they are still sorting.
//
// Measured over two 365-day windows, on top of mixed-granularity containers and the 90-day
// set gate. It measured NEGATIVE before those two existed, which is why it lands only now:
//   distinct groups used              235 -> 259   (243 -> 255)
//   distinct four-group combinations  296 -> 308   (302 -> 304)
//   distinct species shown           1551 -> 1612  (1571 -> 1581)
//   boards with nothing confusable       5 -> 2       (3 -> 3)
//   board has a freebie group           68 -> 60     (67 -> 60)
// Near-repeat boards are the one wash: 55 -> 45 in one window, 51 -> 61 in the other.
//
// THE LABEL GOES IN sciName, NOT common. `common` marks a group as nicely-named and sorts it
// ahead of every Latin theme in orderedThemes, and that ranking advantage makes these small
// groups DISPLACE better ones instead of supplementing them: side by side, `common` gave up
// a third of the added groups and pushed distinct species BELOW doing nothing at all. Display is
// unaffected either way — GridGame prints the scientific subtitle only when it differs from
// the label, already the case for the ~50% of groups that are Latin-only.
//
// Labels are built from names BAKED into the tree, not from the CLADE_COMMON override layer
// that loadRichTree applies at runtime — that is TypeScript and this is a build script. So a
// clade whose English name lives only in that override contributes its Latin name instead
// ("Cranchiidae & Ommastrephidae" rather than "Cranchiidae & Flying squid"). One label of
// 140 today. Harmless, and the fix is to move that override into the baked data.
//
// Run AFTER finalize, like patch-wiki-titles and patch-clade-views. Idempotent.
import fs from "node:fs";

const TAXONOMY = "src/data/taxonomy.json";
const AUGMENT = "src/data/taxonomyAugment.json";
// Mirrors MIN/MAX_THEME_LEAVES and MIN_BOARD_FAME in core/grid.ts.
const MIN_LEAVES = 4, MAX_LEAVES = 25, MIN_FAME = 2000;
// Two or three parts reads as a category; more is a list.
const MIN_PARTS = 2, MAX_PARTS = 3;

const doc = JSON.parse(fs.readFileSync(TAXONOMY, "utf8"));
const augDoc = fs.existsSync(AUGMENT) ? JSON.parse(fs.readFileSync(AUGMENT, "utf8")) : { nodes: [] };
const all = [...doc.nodes, ...augDoc.nodes];
const byId = new Map(all.map((n) => [n.id, n]));
const kids = new Map();
for (const n of all) {
  if (n.parentId == null) continue;
  (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)).push(n.id);
}
const isLeaf = (id) => !(kids.get(id)?.length);
const leafCache = new Map();
const leavesUnder = (id) => {
  const hit = leafCache.get(id);
  if (hit) return hit;
  const ch = kids.get(id);
  let out;
  if (!ch || !ch.length) out = [id];
  else { out = []; for (const c of ch) out.push(...leavesUnder(c)); }
  leafCache.set(id, out);
  return out;
};
const namedLeaves = (id) => leavesUnder(id).filter((l) => byId.get(l)?.common);
const views = (id) => byId.get(id)?.views ?? 0;
const median = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const recog = (id) => median([...leavesUnder(id)].sort((a, b) => views(b) - views(a)).slice(0, 4).map(views));
const labelOf = (id) => { const n = byId.get(id); return n?.common ?? n?.sciName ?? null; };

// Exactly grid.ts's admission test: a node that could already serve as a group.
const isTheme = (id) => {
  const n = byId.get(id);
  if (!n || isLeaf(id) || (!n.sciName && !n.common)) return false;
  const k = namedLeaves(id).length;
  return k >= MIN_LEAVES && k <= MAX_LEAVES;
};
const hasThemeBelow = (id) => (kids.get(id) ?? []).some((c) => isTheme(c) || hasThemeBelow(c));

let anon = 0, tooDim = 0, unsafe = 0, unlabelable = 0, nested = 0;
const candidates = [];
for (const n of all) {
  if (isLeaf(n.id) || n.sciName || n.common) continue;
  const k = namedLeaves(n.id).length;
  if (k < MIN_LEAVES || k > MAX_LEAVES) continue;
  anon++;
  if (recog(n.id) < MIN_FAME) { tooDim++; continue; }
  // The whole point: only where naming this node cannot cost a finer group.
  if (hasThemeBelow(n.id)) { unsafe++; continue; }
  const parts = [];
  const walk = (id) => {
    for (const c of kids.get(id) ?? []) {
      const l = labelOf(c);
      if (l) parts.push(l);
      else walk(c);
    }
  };
  walk(n.id);
  const clean = [...new Set(parts)];
  if (clean.length < MIN_PARTS || clean.length > MAX_PARTS) { unlabelable++; continue; }
  candidates.push({ id: n.id, label: clean.join(" & "), k });
}

// Only ONE node per nested chain may be named, or the outer swallows the inner. Prefer the
// DEEPEST: finer groups measured better for variety than broader ones, repeatedly.
const depth = (id) => { let d = 0; for (let x = id; x; x = byId.get(x)?.parentId) d++; return d; };
const claimed = new Set();
const applied = [];
for (const c of [...candidates].sort((a, b) => depth(b.id) - depth(a.id))) {
  const ls = leavesUnder(c.id);
  if (ls.some((l) => claimed.has(l))) { nested++; continue; }
  for (const l of ls) claimed.add(l);
  byId.get(c.id).sciName = c.label;
  applied.push(c);
}

console.log(`anonymous clades at ${MIN_LEAVES}-${MAX_LEAVES} named species: ${anon}`);
console.log(`  below the fame floor:               ${tooDim}`);
console.log(`  something below is already a group: ${unsafe}`);
console.log(`  no clean ${MIN_PARTS}-${MAX_PARTS} part label:          ${unlabelable}`);
console.log(`  nested inside another candidate:    ${nested}`);
console.log(`  NAMED:                              ${applied.length}`);
console.log(`\n${applied.slice(0, 20).map((c) => `  ${c.label} (${c.k} spp)`).join("\n")}`);

const inBase = new Set(doc.nodes.map((n) => n.id));
const touchedAug = applied.filter((c) => !inBase.has(c.id)).length;
fs.writeFileSync(TAXONOMY, JSON.stringify(doc));
console.log(`\npatched ${TAXONOMY}`);
if (touchedAug) {
  fs.writeFileSync(AUGMENT, JSON.stringify(augDoc));
  console.log(`patched ${AUGMENT} (${touchedAug} nodes)`);
}
fs.writeFileSync("node_modules/.cache/merged-clade-labels.json", JSON.stringify(Object.fromEntries(applied.map((c) => [c.id, c.label]))));
