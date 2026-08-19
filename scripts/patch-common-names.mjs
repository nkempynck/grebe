// Apply COMMON_NAME_OVERRIDES to the SHIPPED taxonomy snapshot, without a rebuild.
//
// build-names.mjs already applies the same map, but only as part of the full build:taxonomy
// chain. That is the right place for it when the tree is being regenerated anyway, and the
// wrong amount of risk for correcting three names: a rebuild re-derives the entire species set
// from OTL and GBIF, and every rebuild has to be diffed before it is accepted.
//
// One source of truth, two entry points. The overrides file's header has claimed this script
// existed for a while; it did not, which meant a bad name could only be fixed by rebuilding.
//
//   node scripts/patch-common-names.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMON_NAME_OVERRIDES } from "./common-name-overrides.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = resolve(ROOT, "src/data/taxonomy.json");
const DRY = process.argv.includes("--dry");

const tax = JSON.parse(readFileSync(FILE, "utf8"));
const changed = [];
const missing = [];
const seen = new Set();

for (const n of tax.nodes) {
  const want = COMMON_NAME_OVERRIDES[n.sciName];
  if (want === undefined) continue;
  seen.add(n.sciName);
  if (n.common === want) continue;
  changed.push({ sci: n.sciName, from: n.common ?? "(none)", to: want });
  n.common = want;
}
// An override whose species is not in the snapshot is dead weight at best and a silent typo at
// worst, so it is reported rather than ignored.
for (const sci of Object.keys(COMMON_NAME_OVERRIDES)) if (!seen.has(sci)) missing.push(sci);

// A vernacular with a quote mark in it came straight from the feed unparsed, and it renders as
// literal quotes on screen. Worth surfacing even where no override covers it yet.
const quoted = tax.nodes.filter((n) => n.common && /["“”]/.test(n.common));

for (const c of changed) console.log(`  ${c.sci}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`);
console.log(`\n${changed.length} name${changed.length === 1 ? "" : "s"} changed`
  + `, ${Object.keys(COMMON_NAME_OVERRIDES).length - missing.length} overrides matched`);
if (missing.length) console.log(`  NOT IN SNAPSHOT (${missing.length}): ${missing.join(", ")}`);
if (quoted.length) {
  console.log(`\n  names still carrying quote marks (${quoted.length}):`);
  for (const n of quoted.slice(0, 20)) console.log(`    ${n.sciName}: ${JSON.stringify(n.common)}`);
}

if (DRY) { console.log("\n--dry: nothing written"); process.exit(0); }
if (!changed.length) { console.log("nothing to write"); process.exit(0); }
writeFileSync(FILE, JSON.stringify(tax));
console.log(`\nwrote src/data/taxonomy.json`);
