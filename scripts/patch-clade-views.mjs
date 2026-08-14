// Clade pageviews. Sets `cladeViews` on every non-species node whose scientific name has a
// pageview entry, in BOTH src/data/taxonomy.json and src/data/taxonomyAugment.json.
//
// WHY. Kinship rates a group by the median pageviews of the four SPECIES it would show, and
// that badly underrates groups whose fame lives in the group rather than its members.
// Clownfish (Amphiprion) score 1030 because nobody reads `Amphiprion perideraion`, while the
// article the genus redirects to pulls 34410. Octopus scores 1319 against 141386. The
// MIN_BOARD_FAME floor was therefore throwing out 85 genuinely recognisable groups —
// octopus, bumblebees, barracudas, orchids, thrushes, seahorses, nightjars, tarsiers.
//
// The pull already fetched these (pull-pageviews covers species + genera + families), so
// this is a join, not a network step. Keys are scientific names and the pull followed
// redirects, which is exactly why "Amphiprion" carries the Clownfish article's traffic.
//
// SCOPE. Consumed only as a floor test (see MIN_BOARD_FAME in core/grid.ts): it can lift a
// group INTO consideration, never push one out, and it does not feed the difficulty tier —
// clade articles run 30k-140k against species medians of 2k-20k, so mixing them into
// Theme.fame would re-tier half the board pool. Keeping it admission-only also bounds the
// homonym risk this name-keyed join carries (OTL's "Linaria" is a finch, Wikipedia's is a
// toadflax): a wrong match can wrongly admit a group, never wrongly exclude one.
//
// Re-run after finalize-taxonomy.mjs, like patch-wiki-titles.mjs — finalize rebuilds
// taxonomy.json from sel-nodes-named.json and knows nothing about this field.
// Run: node scripts/patch-clade-views.mjs [--dry]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = resolve(ROOT, "node_modules/.cache/sel-pool-pageviews.json");
const TARGETS = [resolve(ROOT, "src/data/taxonomy.json"), resolve(ROOT, "src/data/taxonomyAugment.json")];
const dry = process.argv.includes("--dry");

if (!existsSync(CACHE)) {
  console.error(`✗ ${CACHE} missing — run scripts/pull-pageviews.mjs first`);
  process.exit(1);
}
const views = JSON.parse(readFileSync(CACHE, "utf8"));

for (const file of TARGETS) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const clades = data.nodes.filter((n) => n.rank !== "species" && n.sciName);
  let set = 0, cleared = 0, missing = 0;
  for (const n of clades) {
    const v = views[n.sciName];
    if (typeof v === "number" && v > 0) {
      if (n.cladeViews !== v) set++;
      n.cladeViews = v;
    } else {
      // A previous run may have written a value the cache no longer backs.
      if (n.cladeViews !== undefined) { delete n.cladeViews; cleared++; }
      missing++;
    }
  }
  const name = file.split("/").pop();
  console.log(`${name}: ${clades.length} named clades — set/updated ${set}, no entry ${missing}${cleared ? `, cleared ${cleared}` : ""}`);
  if (!dry) {
    data.cladeViewsPatchedAt = new Date().toISOString();
    writeFileSync(file, JSON.stringify(data));
  }
}
console.log(dry ? "--dry: nothing written" : "✓ written");
