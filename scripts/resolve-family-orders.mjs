// FAMILY -> ORDER, from Open Tree, cached to sel-family-order.json.
//
// Kinship reads difficulty off the RANK of the MRCA between two groups, so the tree needs
// ranked nodes at the levels players actually reason about. assemble-taxonomy step 5 already
// injects a mid-rank layer from Wikidata's parent-taxon property (P171), and for plants that
// lands on orders — Amaryllidaceae -> Asparagales — which is why it was written that way.
//
// For birds it does not, because P171 returns the IMMEDIATE parent and its rank varies:
//
//   Scolopacidae -> Charadriiformes   (order)
//   Alcidae      -> Pan-Alcidae       (unranked clade)
//   Laridae      -> Lari              (unranked clade)
//   Alcedinidae  -> Alcedines         (unranked clade)
//   Ardeidae     -> Ardei             (unranked clade)
//
// Grouping by that key splits one order across several names, and none of the fragments is a
// clean clade — the "Charadriiformes" group would exclude Alcidae and Laridae, which sit
// inside it — so the injection rejects them all as impure and no order node is ever created.
// Measured: Charadriiformes, Coraciiformes and Pelecaniformes are absent from the tree
// entirely, and 82% of bird boards resolve all the way up to Neognathae (infraclass) as a
// result, which is why separation is nearly constant across the whole class.
//
// Walking P171 upward is not an option: Open Tree has never heard of Lari, Pan-Alcidae,
// Alcedines, Ardei or Accipitroidea — they are Wikidata clade names. So this asks Open Tree
// directly, family by family, and reads the order off the lineage. Grouped by the answer, all
// seven bird orders form clean clades (verified before writing this), so the injection takes
// them.
//
// Resumable: every answer is cached, so a re-run costs nothing and a failed run can be
// repeated. Delete node_modules/.cache/sel-family-order.json to force a full refetch.
//
//   node scripts/resolve-family-orders.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OUT = resolve(C, "sel-family-order.json");
const OTL = "https://api.opentreeoflife.org/v3";
/** Requests in flight. Modest on purpose — this is a public API and the job is not urgent. */
const CONCURRENCY = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postJSON(url, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) return await r.json();
      // 429/5xx are worth waiting out; anything else is a real answer of "no".
      if (r.status === 429 || r.status >= 500) { await sleep(600 * (i + 1)); continue; }
      return { __error: r.status };
    } catch {
      await sleep(600 * (i + 1));
    }
  }
  return { __error: true };
}

const classify = JSON.parse(readFileSync(resolve(C, "sel-classify-otl.json"), "utf8")).byName;
const inset = JSON.parse(readFileSync(resolve(C, "sel-inset.json"), "utf8"));

// Only families our own species actually use — no point resolving the other 9,700.
const families = [...new Set(inset.map((s) => s.family).filter(Boolean))].sort();

/** famName -> order name, or null when Open Tree's lineage has no order rank. */
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const todo = families.filter((f) => !(f in cache) && classify[f]?.ott);
const noOtt = families.filter((f) => !classify[f]?.ott);

console.log(`${families.length} in-set families; ${families.length - todo.length - noOtt.length} cached, ${todo.length} to fetch, ${noOtt.length} without an ott id`);

let done = 0, failed = 0;
async function worker(queue) {
  for (;;) {
    const fam = queue.pop();
    if (!fam) return;
    const doc = await postJSON(`${OTL}/taxonomy/taxon_info`, { ott_id: classify[fam].ott, include_lineage: true });
    if (doc?.__error) { failed++; continue; }
    const order = (doc.lineage ?? []).find((t) => String(t.rank).toLowerCase() === "order");
    cache[fam] = order?.name ?? null;
    if (++done % 100 === 0) {
      console.log(`  ${done}/${todo.length}`);
      writeFileSync(OUT, JSON.stringify(cache)); // checkpoint, so a crash costs at most 100
    }
  }
}

const queue = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
writeFileSync(OUT, JSON.stringify(cache));

const resolved = Object.values(cache).filter(Boolean).length;
const orders = new Set(Object.values(cache).filter(Boolean));
console.log(`\n✓ ${resolved}/${families.length} families mapped to an order (${orders.size} distinct orders), ${failed} fetch failures`);
if (noOtt.length) console.log(`  no ott id, skipped: ${noOtt.join(", ")}`);

// The families this whole exercise is about.
for (const f of ["Scolopacidae", "Alcidae", "Laridae", "Alcedinidae", "Ardeidae", "Threskiornithidae", "Cathartidae"])
  if (f in cache) console.log(`  ${f.padEnd(20)} -> ${cache[f]}`);
