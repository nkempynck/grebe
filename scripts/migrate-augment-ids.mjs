// ONE-TIME migration: re-point taxonomyAugment.json at the corrected clade ids.
//
// WHY. assemble-taxonomy.mjs used to parse OTL's anonymous internal-node labels
// (`mrcaottAottB` — "the common ancestor of A and B") with a regex anchored at the end,
// which captured the TRAILING ott number and handed the node an id belonging to an
// unrelated taxon. parseLabel now keeps the whole label as the id. That is a strictly
// better id, but it renames ~2.6k clade nodes, and the augment grafts its nodes onto base
// clade ids — so 681 augment nodes were left pointing at parents that no longer exist and
// buildTree threw "unknown parent".
//
// The remap is exact, not a guess: the old id was literally the trailing component of the
// label the new id now keeps in full, so `ott321680` maps to the unique base node whose id
// matches /^mrca.*ott321680$/. The script refuses to write if any lookup is ambiguous or
// missing, and it is idempotent — a second run finds nothing to do.
//
// This is a migration, not pipeline furniture. The augment is still the OLD GBIF-era build
// (see PIPELINE.md TODO); once it is regenerated from the current pool against the current
// ids, delete this script.
//
// Run: node scripts/migrate-augment-ids.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = resolve(ROOT, "src/data/taxonomy.json");
const AUG = resolve(ROOT, "src/data/taxonomyAugment.json");
const dry = process.argv.includes("--dry");

const base = JSON.parse(readFileSync(BASE, "utf8"));
const aug = JSON.parse(readFileSync(AUG, "utf8"));

const baseIds = new Set(base.nodes.map((n) => n.id));
const augIds = new Set(aug.nodes.map((n) => n.id));

// trailing ott component of a corrected mrca id -> the node(s) carrying it
const byTail = new Map();
for (const n of base.nodes) {
  const m = /^mrca.*?(ott\d+)$/.exec(n.id);
  if (m) (byTail.get(m[1]) ?? byTail.set(m[1], []).get(m[1])).push(n.id);
}

const orphans = aug.nodes.filter((n) => n.parentId && !baseIds.has(n.parentId) && !augIds.has(n.parentId));
if (orphans.length === 0) {
  console.log("nothing to migrate — every augment parent resolves against the base tree");
  process.exit(0);
}

const remap = new Map();
const unresolved = [];
for (const id of new Set(orphans.map((n) => n.parentId))) {
  const hits = byTail.get(id) ?? [];
  if (hits.length === 1) remap.set(id, hits[0]);
  else unresolved.push(`${id} (${hits.length} candidates)`);
}

console.log(`augment nodes: ${aug.nodes.length}; orphaned: ${orphans.length}; distinct parents: ${remap.size + unresolved.length}`);
if (unresolved.length) {
  console.error(`✗ refusing to write — ${unresolved.length} parent id(s) could not be resolved:`);
  for (const u of unresolved.slice(0, 10)) console.error(`   ${u}`);
  process.exit(1);
}

let rewritten = 0;
for (const n of aug.nodes) {
  const to = n.parentId && remap.get(n.parentId);
  if (to) { n.parentId = to; rewritten++; }
}
console.log(`remapped ${remap.size} parent ids across ${rewritten} augment nodes`);
for (const [from, to] of [...remap].slice(0, 5)) console.log(`   ${from} -> ${to}`);

// Post-check: every parent must now resolve, or we would just move the crash downstream.
const still = aug.nodes.filter((n) => n.parentId && !baseIds.has(n.parentId) && !augIds.has(n.parentId));
if (still.length) { console.error(`✗ ${still.length} still unresolved after remap — not writing`); process.exit(1); }

if (dry) { console.log("--dry: not written"); process.exit(0); }
aug.migratedIdsAt = new Date().toISOString();
writeFileSync(AUG, JSON.stringify(aug));
console.log(`✓ wrote ${AUG}`);
