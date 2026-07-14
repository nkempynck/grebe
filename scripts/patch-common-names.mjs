// Apply COMMON_NAME_OVERRIDES to the shipped snapshot (src/data/taxonomy.json)
// WITHOUT a full GBIF/OTL rebuild — so a known bad/colliding common name can be
// fixed in place. Idempotent. Run: node scripts/patch-common-names.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COMMON_NAME_OVERRIDES } from "./common-name-overrides.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "data", "taxonomy.json");

const data = JSON.parse(readFileSync(OUT, "utf8"));
const nodes = data.nodes ?? [];
const bySci = new Map(nodes.filter((n) => n.sciName).map((n) => [n.sciName, n]));

let changed = 0;
const missing = [];
for (const [sci, better] of Object.entries(COMMON_NAME_OVERRIDES)) {
  const n = bySci.get(sci);
  if (!n) { missing.push(sci); continue; }
  if (n.common !== better) { n.common = better; changed++; }
}

// Re-scan for any remaining case-insensitive common-name collisions.
const byName = {};
for (const n of nodes) {
  if (n.rank === "species" && n.common) (byName[n.common.trim().toLowerCase()] ??= []).push(n);
}
const collisions = Object.entries(byName).filter(([, a]) => a.length > 1);

if (missing.length) console.warn(`! ${missing.length} override sciName(s) not found: ${missing.join(", ")}`);
console.log(`${changed} common name(s) updated.`);
if (collisions.length) {
  console.warn(`! ${collisions.length} collision(s) remain:`);
  for (const [, a] of collisions) console.warn(`   "${a[0].common}" -> ${a.map((n) => n.sciName).join(" | ")}`);
} else {
  console.log("No remaining common-name collisions.");
}

if (changed) { writeFileSync(OUT, JSON.stringify(data)); console.log(`wrote ${OUT}`); }
