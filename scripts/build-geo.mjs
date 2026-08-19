// Where each species is RECORDED, from GBIF occurrence country facets.
//
// WHY THIS EXISTS. Mosaic's character table is authored as clade -> value rules, so every
// character is a function of the tree, and a function of the tree can only re-cut the tree.
// Measured on the 942-species pool, the whole six-column table adds 0.81 bits beyond the class
// you can already see in the photograph. Geography is the one axis that is genuinely
// independent of taxonomy AND available at high coverage: one geography column is worth about
// 3.5 bits on the same measurement, roughly four times the entire existing table, and takes a
// typical day from ~64 candidates to ~6.
//
// WHY COUNTRY AND NOT CONTINENT. GBIF has a `continent` facet and it looks like the obvious
// choice, but it is populated by the publisher and 226 of the 942 pool species come back with
// none at all — pharaoh ant, buff-tailed bumblebee, silverfish, all extremely well recorded.
// `country` is derived from the coordinates instead, and every one of those species has a clean
// country breakdown. So: facet on country, map to regions here.
//
// WHY A THRESHOLD. GBIF's long tail is vagrants, zoo animals, museum specimens and
// misidentifications. Counting "any observation at all" puts 52% of the pool on five or more
// continents and the column collapses into "famous animals are everywhere". At 2% of records
// the mean is 1.79 continents and only 23 species look global.
//
// WHAT THIS IS NOT. Occurrence records are RECORDING EFFORT, not native range. The pharaoh ant
// comes back US 37% / Costa Rica 18% / Finland 11%, which is where people logged it, not where
// it is from. Every player-facing string must say "recorded in", never "native to".
//
//   node scripts/build-geo.mjs [--pool] [--limit N] [--threshold 0.02]
//
// --pool restricts the fetch to Mosaic's answer pool (the prototype default, ~942 species and
// about three minutes). Without it, every guessable animal (~2818) is fetched, which is what
// shipping needs so a guess gets a row too.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTINENT_OF, REALM_OF, CONTINENTS, REALMS, REALM_COMPROMISES, IGNORED_CODES, CONTINENT_LABEL, REALM_LABEL, MERIDIAN_SPLITS } from "./geo-regions.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const POOL_ONLY = process.argv.includes("--pool");
const THRESHOLD = Number(arg("threshold", "0.02"));
/** Below this many country-bearing records a species is not making a claim about its range.
 *  Raised with the basis filter below, which cuts volume hard on rarely-observed animals: the
 *  giant panda drops to 31 field observations, and two of those are a zoo in Germany. Under the
 *  floor the honest output is null. */
const MIN_RECORDS = 50;

/** FIELD OBSERVATIONS ONLY, and this is the difference between a credible column and a wrong one.
 *
 *  Unfiltered, GBIF counts preserved museum specimens and living zoo animals, and both are
 *  concentrated in Europe and North America regardless of where the animal comes from. The lion
 *  came back "Africa, EUROPE" on the strength of German records, and the tiger read
 *  "India 72%, Germany 4.4%". Restricting to observations drops Germany out of both: the tiger
 *  goes to India 91%, the lion to Africa alone.
 *
 *  It does not catch everything. An iNaturalist photograph of a zoo panda is a human
 *  observation, so a handful survive; the 2% threshold and the record floor absorb those. */
const BASIS = "&basisOfRecord=HUMAN_OBSERVATION&basisOfRecord=MACHINE_OBSERVATION";
const UA = "GrebeGames/1.0 (geo build; contact via github.com/nkempynck/grebe)";

// ---- which species to fetch (the pool picker lives in TypeScript, so bundle it) ----
const entry = resolve(C, "geo-species-entry.ts");
const bundle = resolve(C, "geo-species.mjs");
mkdirSync(C, { recursive: true });
writeFileSync(entry, `
import taxonomy from "${resolve(ROOT, "src/data/taxonomy.json")}";
import { buildTree, leavesUnder } from "${resolve(ROOT, "src/core/index.ts")}";
import { mosaicPool, mosaicScopeId } from "${resolve(ROOT, "src/core/mosaic.ts")}";
const tree = buildTree((taxonomy as any).nodes);
const scope = mosaicScopeId(tree);
const ids = ${POOL_ONLY} ? mosaicPool(tree, scope)
  : leavesUnder(tree, scope).filter((id) => tree.byId.get(id)!.rank === "species");
process.stdout.write(JSON.stringify(ids.map((id) => tree.byId.get(id)!.sciName)));
`);
execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm",
  "--define:import.meta.env={}", "--loader:.json=json", "--external:@supabase/supabase-js",
  `--outfile=${bundle}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
let species = JSON.parse(execFileSync("node", [bundle], { encoding: "utf8" }));
const limit = Number(arg("limit", "0"));
if (limit) species = species.slice(0, limit);

const inset = JSON.parse(readFileSync(resolve(C, "sel-inset.json"), "utf8"));
const gbifOf = new Map(inset.map((s) => [s.sci, s.gbif]));

// ---- fetch, cached on disk ----
// Tuning the threshold is an iterative business and the occurrence record does not change
// hour to hour, so a re-run costs zero requests. Same reasoning as the image ladder cache.
// Cache keyed by the QUERY, not just the species: changing the basis filter changes the answer,
// and a stale hit would silently serve the museum-biased numbers forever.
const CACHE = resolve(C, "gbif-country-obs");
mkdirSync(CACHE, { recursive: true });

async function facets(key) {
  const f = resolve(CACHE, `${key}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  const url = `https://api.gbif.org/v1/occurrence/search?taxonKey=${key}&limit=0&facet=country&facetLimit=100${BASIS}`;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA } });
      if (r.ok) {
        const j = await r.json();
        const out = Object.fromEntries((j.facets?.[0]?.counts ?? []).map((c) => [c.name, c.count]));
        writeFileSync(f, JSON.stringify(out));
        return out;
      }
    } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 900 * (a + 1)));
  }
  return null;
}

/** Replace a transcontinental country's single count with its two halves, split on a meridian.
 *
 *  Only asked for when the country is actually material to this species (>= THRESHOLD of its
 *  records), so it costs two extra requests on the few dozen species it matters for and nothing
 *  on the rest. The two halves are queried EXPLICITLY rather than one half against the country
 *  total: a bare country query counts records with no coordinates, which the longitude filter
 *  excludes, and comparing the two understated the eastern share badly enough to read the sable
 *  as 21% Siberian when it is 97%. */
async function splitMeridians(key, counts) {
  let total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const [cc, s] of Object.entries(MERIDIAN_SPLITS)) {
    const n = counts[cc];
    if (!n || n / total < THRESHOLD) continue;
    const f = resolve(CACHE, `${key}.split-${cc}.json`);
    let halves;
    if (existsSync(f)) halves = JSON.parse(readFileSync(f, "utf8"));
    else {
      const side = async (range) => {
        const u = `https://api.gbif.org/v1/occurrence/search?taxonKey=${key}&limit=0&country=${cc}`
          + `&decimalLongitude=${range}${BASIS}`;
        for (let a = 0; a < 4; a++) {
          try { const r = await fetch(u, { headers: { "user-agent": UA } });
            if (r.ok) return (await r.json()).count ?? 0; } catch { /* retry */ }
          await new Promise((z) => setTimeout(z, 700 * (a + 1)));
        }
        return null;
      };
      const w = await side(`-180,${s.at}`);
      const e = await side(`${s.at},180`);
      if (w === null || e === null) continue;      // leave the country whole rather than guess
      halves = { w, e };
      writeFileSync(f, JSON.stringify(halves));
    }
    const geo = halves.w + halves.e;
    if (!geo) continue;                            // nothing georeferenced — leave it whole
    // Apply the georeferenced RATIO to the full count, so records without coordinates are
    // distributed the same way rather than silently dropped.
    delete counts[cc];
    counts[s.west] = Math.round((n * halves.w) / geo);
    counts[s.east] = n - counts[s.west];
  }
  return counts;
}

/** Country counts -> the regions holding at least THRESHOLD of the records.
 *
 *  The denominator is the SUM OF THE FACETS, not GBIF's total count: a large share of records
 *  carry no country at all, and dividing by the total would push everything under the bar and
 *  quietly return an empty set for half the pool. */
function regionsOf(counts, table, order) {
  const per = {};
  let total = 0;
  for (const [cc, n] of Object.entries(counts)) {
    const region = table[cc];
    total += n;
    if (region) per[region] = (per[region] ?? 0) + n;
  }
  if (total < MIN_RECORDS) return { regions: null, total, unmapped: 0 };
  const unmapped = total - Object.values(per).reduce((a, b) => a + b, 0);
  const regions = order.filter((r) => (per[r] ?? 0) / total >= THRESHOLD);
  return { regions: regions.length ? regions : null, total, unmapped };
}

const out = {
  $source: "GBIF occurrence country facets",
  $fetched: new Date().toISOString().slice(0, 10),
  $threshold: THRESHOLD,
  $minRecords: MIN_RECORDS,
  $scope: POOL_ONLY ? "mosaic-pool" : "all-animals",
  $meaning: "where the species is RECORDED, not where it is native",
  // Shipped WITH the data rather than copied into the app: a code and its label drifting apart
  // is the kind of thing nothing catches until a column reads "AFR" at someone.
  $continents: CONTINENT_LABEL,
  $realms: REALM_LABEL,
};
const entries = {};
const unknownCodes = new Map();
let done = 0, noKey = 0, noData = 0, thin = 0;

for (const sci of species) {
  const key = gbifOf.get(sci);
  done++;
  if (done % 100 === 0) process.stderr.write(`  ${done}/${species.length}\n`);
  if (!key) { noKey++; entries[sci] = null; continue; }
  const counts = await facets(key);
  if (!counts) { noData++; entries[sci] = null; continue; }
  await splitMeridians(key, counts);
  for (const cc of Object.keys(counts)) if (!CONTINENT_OF[cc] && !IGNORED_CODES.has(cc)) unknownCodes.set(cc, (unknownCodes.get(cc) ?? 0) + 1);
  const c = regionsOf(counts, CONTINENT_OF, CONTINENTS);
  const r = regionsOf(counts, REALM_OF, REALMS);
  if (c.regions === null) thin++;
  entries[sci] = c.regions || r.regions ? { c: c.regions, r: r.regions, n: c.total } : null;
}

writeFileSync(resolve(ROOT, "src/data/geo.json"), JSON.stringify({ ...out, species: entries }));

// ---- report ----
const have = Object.values(entries).filter((v) => v?.c).length;
console.log(`\n${have}/${species.length} species placed (${(100 * have / species.length).toFixed(0)}%)`);
console.log(`  no GBIF key ${noKey} · no data ${noData} · under ${MIN_RECORDS} records ${thin}`);
const spread = Object.values(entries).filter((v) => v?.c).map((v) => v.c.length);
console.log(`  mean continents ${(spread.reduce((a, b) => a + b, 0) / spread.length).toFixed(2)} · on 5+ ${spread.filter((n) => n >= 5).length}`);
if (unknownCodes.size) {
  // A country code we have no region for is silently dropped from the denominator's numerator,
  // which biases every percentage on that species. Loud, not swallowed.
  console.log(`\n  UNMAPPED COUNTRY CODES (add them to geo-regions.mjs):`);
  for (const [cc, n] of [...unknownCodes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20))
    console.log(`    ${cc}  seen on ${n} species`);
}
console.log(`\n  realm compromises in force: ${Object.keys(REALM_COMPROMISES).join(", ")}`);
console.log(`  wrote src/data/geo.json`);
