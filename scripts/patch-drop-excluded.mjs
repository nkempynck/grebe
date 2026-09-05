// Remove EXCLUDE_SCI taxa (cryptids / disputed non-species) from the built trees, in BOTH
// src/data/taxonomy.json and src/data/taxonomyAugment.json.
//
// WHY THIS EXISTS AS A CHAIN STAGE. The exclusion is enforced at the source, in
// build-pool.mjs and build-augment.mjs. But `npm run build:taxonomy` starts at *assemble*,
// which is downstream of build-pool: it reads the cached sel-*.json from the last pull. So
// on the chain alone an excluded species stays in the tree until someone re-runs the
// network-heavy selection stages. This closes that gap, and on a clean full rebuild it is a
// no-op that reports "0 removed".
//
// COLLAPSING. Dropping a tip can leave an UNNAMED clade with a single remaining child — a
// redundant link that still adds a level to tree depth, which Kinship's separation tiers
// measure. Those get spliced out and their child reparented. Named clades are never
// collapsed: a name makes a node a candidate group and a potential board label, so removing
// one would change what the games can field. Child counts are taken over the UNION of both
// files, since augment nodes graft onto base nodes.
//
// Idempotent. Run after finalize-taxonomy.mjs like the other patches.
// Run: node scripts/patch-drop-excluded.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { EXCLUDE_SCI } from "./exclude-taxa.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = resolve(ROOT, "src/data/taxonomy.json");
const AUG = resolve(ROOT, "src/data/taxonomyAugment.json");
const dry = process.argv.includes("--dry");

const base = JSON.parse(readFileSync(BASE, "utf8"));
const aug = JSON.parse(readFileSync(AUG, "utf8"));

// --- 1) drop the excluded taxa themselves ---
const isExcluded = (n) => EXCLUDE_SCI.has(n.sciName);
const removed = [...base.nodes, ...aug.nodes].filter(isExcluded);
base.nodes = base.nodes.filter((n) => !isExcluded(n));
aug.nodes = aug.nodes.filter((n) => !isExcluded(n));
for (const n of removed) console.log(`  - ${n.common ?? "(unnamed)"} (${n.sciName}) [${n.id}]`);

// --- 2) splice out unnamed internal nodes left with 0 or 1 child ---
// Repeat to a fixed point: collapsing one link can strand its parent too.
const named = (n) => Boolean(n.common) || Boolean(n.sciName);
const collapsed = [];
for (let pass = 0; pass < 20; pass++) {
  const all = [...base.nodes, ...aug.nodes];
  const byId = new Map(all.map((n) => [n.id, n]));
  const childCount = new Map();
  for (const n of all) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1);

  // Candidates: internal (has children recorded, or is a non-species), unnamed, <2 children.
  const doomed = new Set();
  for (const n of all) {
    if (n.rank === "species") continue;
    if (named(n)) continue;
    const kids = childCount.get(n.id) ?? 0;
    if (kids < 2) doomed.add(n.id);
  }
  if (doomed.size === 0) break;

  // Reparent each doomed node's children onto its nearest surviving ancestor.
  const survivingParent = (id) => {
    let p = byId.get(id)?.parentId;
    while (p && doomed.has(p)) p = byId.get(p)?.parentId;
    return p ?? null;
  };
  for (const n of all) {
    if (doomed.has(n.parentId)) n.parentId = survivingParent(n.parentId);
  }
  for (const id of doomed) collapsed.push(id);
  base.nodes = base.nodes.filter((n) => !doomed.has(n.id));
  aug.nodes = aug.nodes.filter((n) => !doomed.has(n.id));
}

// --- 3) refresh counts + stamp ---
base.counts = { nodes: base.nodes.length, species: base.nodes.filter((n) => n.rank === "species").length };
const stamp = new Date().toISOString();
base.excludedDroppedAt = stamp;
aug.excludedDroppedAt = stamp;

console.log(`\n${dry ? "[dry] " : ""}excluded taxa removed: ${removed.length}; redundant unnamed clades collapsed: ${collapsed.length}`);
console.log(`  taxonomy.json now ${base.counts.nodes} nodes / ${base.counts.species} species; augment ${aug.nodes.length} nodes`);
if (!dry && (removed.length || collapsed.length)) {
  writeFileSync(BASE, JSON.stringify(base));
  writeFileSync(AUG, JSON.stringify(aug));
  console.log("  written.");
} else if (!dry) {
  console.log("  nothing to do, files untouched.");
}
