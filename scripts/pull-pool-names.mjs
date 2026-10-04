// Fetch Wikidata English common names (P1843) for every pool species outside the base tree, so
// build-augment.mjs can name species whose Wikipedia article sits under a Latin title, the way
// build-names.mjs already names base species. Without it the augment only took species with an
// English article title, which starved invertebrates, reptiles and fish of a fourth species.
//
// Names are stored sorted, so the pick downstream does not depend on the order SPARQL happens to
// return them in. Incremental: QIDs already in the cache are skipped.
//   node scripts/pull-pool-names.mjs
//   writes: node_modules/.cache/sel-pool-p1843.json  { qid: [name, ...] }
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OUT = resolve(C, "sel-pool-p1843.json");
const WDQS = "https://query.wikidata.org/sparql";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(q, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(WDQS, {
        method: "POST",
        headers: {
          "user-agent": "GrebeGames/1.0 (pool names)",
          accept: "application/sparql-results+json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `query=${encodeURIComponent(q)}`,
      });
      if (r.ok) return (await r.json()).results.bindings;
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      return null;
    } catch { await sleep(1500 * (i + 1)); }
  }
  return null;
}

const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));
const base = new Set(JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8")).nodes
  .filter((n) => n.rank === "species").map((n) => n.sciName));
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const qids = [...new Set(pool.filter((s) => s.qid && !base.has(s.sci)).map((s) => s.qid))].filter((q) => !(q in cache));
console.log(`${qids.length} QIDs to look up (${Object.keys(cache).length} cached)`);

for (let i = 0; i < qids.length; i += 150) {
  const batch = qids.slice(i, i + 150);
  const rows = await sparql(`SELECT ?item (GROUP_CONCAT(DISTINCT ?cn;separator="|") AS ?cns) WHERE {
    VALUES ?item { ${batch.map((q) => `wd:${q}`).join(" ")} } ?item wdt:P1843 ?cn. FILTER(lang(?cn)="en") } GROUP BY ?item`);
  if (!rows) { console.error(`batch at ${i} failed; rerun to resume`); break; }
  for (const q of batch) cache[q] = [];
  for (const b of rows) cache[b.item.value.split("/").pop()] = (b.cns?.value ?? "").split("|").filter(Boolean).sort();
  process.stderr.write(`  ${Math.min(i + 150, qids.length)}/${qids.length}\r`);
  await sleep(200);
}
process.stderr.write("\n");
writeFileSync(OUT, JSON.stringify(cache));
const withName = Object.values(cache).filter((v) => v.length).length;
console.log(`✓ ${withName} of ${Object.keys(cache).length} have an English P1843; wrote ${OUT}`);
