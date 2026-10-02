// Stamp `extinct: true` onto the species in scripts/extinct-taxa.json, in
// src/data/taxonomy.json. Offline: the list is committed, and pull-extinct.mjs refreshes it.
//
// Only Mosaic reads the flag, to keep extinct animals out of its answer pool (see
// pull-extinct.mjs for why). Base tree only, because Mosaic deals from the base tree.
//
// Idempotent: clears every flag first, so a species removed from the list loses it too.
// Run: node scripts/patch-extinct.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = resolve(ROOT, "src/data/taxonomy.json");
const LIST = resolve(ROOT, "scripts/extinct-taxa.json");
const dry = process.argv.includes("--dry");

const base = JSON.parse(readFileSync(BASE, "utf8"));
const wanted = new Set(Object.keys(JSON.parse(readFileSync(LIST, "utf8")).species));

let flagged = 0;
const hit = new Set();
for (const n of base.nodes) {
  delete n.extinct;
  if (n.rank === "species" && wanted.has(n.sciName)) {
    n.extinct = true;
    flagged++;
    hit.add(n.sciName);
  }
}
const missing = [...wanted].filter((s) => !hit.has(s));

console.log(`✓ extinct: ${flagged} species flagged`);
if (missing.length) console.log(`  not in the tree (ignored): ${missing.join(", ")}`);
if (!dry) {
  base.extinctPatchedAt = new Date().toISOString();
  writeFileSync(BASE, JSON.stringify(base));
}
