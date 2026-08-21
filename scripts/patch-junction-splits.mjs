// Split unnamed junctions into named sub-clades, using the OTL facts cached by
// pull-junction-splits.mjs. See that script for why the splits are sound; this one decides
// which are SAFE TO NAME, and it re-decides that on every build.
//
// WHY THIS RUNS EVERY TIME. The separation fact (does the genus form a clade?) is about
// OTL and never changes between builds. The naming test is about OUR SPECIES SET and does:
// "Aquila & Hieraaetus" is honest only while no other Hieraaetus is on screen, and the day
// someone adds one, a label that was true silently becomes false. That is precisely how
// "Sheep & goats" came to sit beside a group of sheep. So the gates below are recomputed
// from the shipped trees on every run, never trusted from cache, and a candidate that stops
// qualifying is dropped loudly.
//
// THE GATES, in order:
//   3. SIZE        — at most 3 genera in the clade, or the label stops being readable.
//   4. EXCLUSIVITY — every species we display of every genus named in the label must be
//                    INSIDE the clade. This is the whole ballgame: it is what stops a label
//                    from claiming animals that sit somewhere else in the tree.
//   5. LABEL       — the genera the clade actually holds, biggest first, joined with "&".
//                    Never the genus we searched for, and never a vernacular: "Goats" would
//                    exclude the tahrs inside and claim the mountain goat outside.
//
// Only `common` is set, never `sciName`. The node is not the taxon Capra, it is a clade that
// happens to hold our Capra and some Hemitragus, and saying so in Latin claims nothing more.
//
// Re-run after finalize-taxonomy.mjs, like patch-clade-views.mjs — finalize rebuilds
// taxonomy.json from sel-nodes-named.json and knows nothing about this.
//   node scripts/patch-junction-splits.mjs [--dry]
//   reads:  src/data/{taxonomy,taxonomyAugment}.json, node_modules/.cache/sel-junction-splits.json
//   writes: src/data/{taxonomy,taxonomyAugment}.json, src/data/junctionSplits.json (manifest)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = resolve(ROOT, "node_modules/.cache/sel-junction-splits.json");
const TAX = resolve(ROOT, "src/data/taxonomy.json");
const AUG = resolve(ROOT, "src/data/taxonomyAugment.json");
const MANIFEST = resolve(ROOT, "src/data/junctionSplits.json");
const dry = process.argv.includes("--dry");

const MAX_GENERA = 3;

if (!existsSync(CACHE)) {
  console.error(`✗ ${CACHE} missing — run scripts/pull-junction-splits.mjs first`);
  process.exit(1);
}
const cached = JSON.parse(readFileSync(CACHE, "utf8")).byGenus;
const tax = JSON.parse(readFileSync(TAX, "utf8"));
const aug = JSON.parse(readFileSync(AUG, "utf8"));

const all = [...tax.nodes, ...aug.nodes];
const byId = new Map();
for (const n of all) if (!byId.has(n.id)) byId.set(n.id, n);
const genusOf = (sci) => sci.split(/\s+/)[0];
const displayedByGenus = new Map();
for (const n of all) {
  if (n.rank !== "species" || !n.sciName) continue;
  const g = genusOf(n.sciName);
  (displayedByGenus.get(g) ?? displayedByGenus.set(g, []).get(g)).push(n.sciName);
}

const accepted = [];
const rejected = [];
for (const [genus, info] of Object.entries(cached)) {
  if (!info) { rejected.push([genus, "no clean split in OTL"]); continue; }
  const { nodeId, junction, genera, species } = info;
  if (!byId.has(junction)) { rejected.push([genus, `junction ${junction} is gone from the tree`]); continue; }
  // ALREADY APPLIED is not a rejection. This runs on every build, and finalize-taxonomy does
  // not always rebuild from scratch, so the second run must be a no-op rather than a failure:
  // counting an inserted node as "dropped" made the drift check report all 22 as LOST and
  // exit non-zero, and re-pushing the node would duplicate an id, which buildTree throws on.
  const existing = byId.get(nodeId);
  if (existing && existing.parentId !== junction) {
    rejected.push([genus, `${nodeId} exists but hangs on ${existing.parentId}, not ${junction}`]);
    continue;
  }

  const names = Object.keys(genera).sort((a, b) => genera[b] - genera[a]);
  if (names.length > MAX_GENERA) { rejected.push([genus, `${names.length} genera, label would be unreadable`]); continue; }

  // GATE 4. Anything we display belonging to a genus this label names must be inside.
  const inside = new Set(species);
  const leaks = [];
  for (const g of names) {
    for (const sci of displayedByGenus.get(g) ?? []) if (!inside.has(sci)) leaks.push(sci);
  }
  if (leaks.length) {
    rejected.push([genus, `label would claim ${leaks.length} species sitting elsewhere (${leaks.slice(0, 3).join(", ")}${leaks.length > 3 ? ", …" : ""})`]);
    continue;
  }
  accepted.push({ nodeId, junction, label: names.join(" & "), genera: names, species });
}

accepted.sort((a, b) => (a.label < b.label ? -1 : 1));
for (const a of accepted) console.log(`  keep  ${a.label.padEnd(38)} ${a.species.length} species  ${a.nodeId}`);
for (const [g, why] of rejected.sort()) console.log(`  drop  ${g.padEnd(16)} ${why}`);
console.log(`\n${accepted.length} splits kept, ${rejected.length} dropped.`);

// DRIFT. The manifest is committed, so a rebuild that changes what qualifies shows up in a
// git diff instead of silently moving the game. Losing a split is a hard failure: it means a
// name that shipped is no longer true, and that must not pass unnoticed in CI.
const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : null;
if (prev) {
  const now = new Set(accepted.map((a) => a.nodeId));
  const lost = prev.splits.filter((s) => !now.has(s.nodeId));
  const relabelled = accepted.filter((a) => {
    const was = prev.splits.find((s) => s.nodeId === a.nodeId);
    return was && was.label !== a.label;
  });
  for (const s of lost) console.error(`✗ LOST: "${s.label}" (${s.nodeId}) no longer qualifies`);
  for (const a of relabelled) console.error(`✗ RELABELLED: ${a.nodeId} was "${prev.splits.find((s) => s.nodeId === a.nodeId).label}", now "${a.label}"`);
  if (lost.length || relabelled.length) {
    console.error("\nA shipped split changed. Pinned boards may reference it — resolve before building.");
    if (!dry) process.exit(1);
  }
}

if (dry) process.exit(0);

// Insert: the new node hangs on the junction, and the genus's species move onto it. Only
// `common` is set — see the header.
const wantIds = new Map();
for (const a of accepted) for (const sci of a.species) wantIds.set(sci, a.nodeId);
let moved = 0;
for (const file of [tax, aug]) {
  for (const n of file.nodes) {
    if (n.rank !== "species" || !n.sciName) continue;
    const target = wantIds.get(n.sciName);
    if (target && n.parentId !== target) { n.parentId = target; moved++; }
  }
}
const fresh = accepted.filter((a) => !byId.has(a.nodeId));
tax.nodes.push(...fresh.map((a) => ({ id: a.nodeId, sciName: "", common: a.label, rank: "clade", parentId: a.junction })));
tax.junctionSplitsPatchedAt = new Date().toISOString();
writeFileSync(TAX, JSON.stringify(tax));
writeFileSync(AUG, JSON.stringify(aug));
writeFileSync(MANIFEST, JSON.stringify({ generatedAt: new Date().toISOString(), splits: accepted.map(({ nodeId, junction, label, genera }) => ({ nodeId, junction, label, genera })) }, null, 2) + "\n");
console.log(`✓ ${fresh.length} nodes inserted, ${accepted.length - fresh.length} already present, ${moved} species re-parented`);
console.log(`  wrote ${TAX}, ${AUG}, ${MANIFEST}`);
