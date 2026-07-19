// STEP A of the pool pull. All species (with an English Wikipedia article) under each
// family in sel-familyset.json — per-family transitive-down query (the only reliable
// fast primitive; batched/global forms time out on WDQS). Captures sci name, article
// title (for pageviews), sitelinks, GBIF id, parent genus. Dedups by QID, drops
// fossils. Resumable per family. No pageview filter here — that happens after step B.
//
//   caffeinate -i node scripts/pull-species.mjs
//   progress: /tmp/grebe-species.log   data: node_modules/.cache/sel-familyspecies.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const SET = resolve(C, "sel-familyset.json");
const OUT = resolve(C, "sel-familyspecies.json");
const UA = "GrebeGames/1.0 (species pull)";
const WDQS = "https://query.wikidata.org/sparql";
const FOSSIL = "Q23038290";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sparql(q) { for (let i = 0; i < 5; i++) { try { const r = await fetch(`${WDQS}?format=json&query=${encodeURIComponent(q)}`, { headers: { "user-agent": UA, accept: "application/sparql-results+json" } }); if (r.ok) return await r.json(); if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; } return { __err: r.status }; } catch { await sleep(2000 * (i + 1)); } } return { __err: "to" }; }

const set = JSON.parse(readFileSync(SET, "utf8")).filter((f) => f.qid);
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { byFam: {} };
const todo = set.filter((f) => !cache.byFam[f.qid]);
process.stderr.write(`species pull: ${set.length} families, ${todo.length} to fetch (${set.length - todo.length} cached)\n`);

let n = set.length - todo.length, tSpecies = 0;
for (const f of set) if (cache.byFam[f.qid]) tSpecies += cache.byFam[f.qid].length;
for (const f of todo) {
  const q = `SELECT ?sp ?spName ?gName ?sl ?gbif ?article WHERE {
    ?g wdt:P171* wd:${f.qid}; wdt:P105 wd:Q34740; wdt:P225 ?gName .
    ?sp wdt:P171 ?g; wdt:P105 wd:Q7432; wdt:P225 ?spName; wikibase:sitelinks ?sl .
    ?a schema:about ?sp; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?article .
    FILTER NOT EXISTS { ?sp wdt:P31 wd:${FOSSIL} }
    OPTIONAL { ?sp wdt:P846 ?gbif }
  }`;
  const res = await sparql(q);
  if (res.__err) { process.stderr.write(`  ${f.name} err ${res.__err}, retry\n`); await sleep(2500); continue; }
  const seen = new Set(), list = [];
  for (const b of res.results.bindings) {
    const qid = b.sp.value.split("/").pop();
    if (seen.has(qid)) continue; seen.add(qid);
    list.push({ qid, sci: b.spName.value, genus: b.gName.value, title: b.article.value, sl: Number(b.sl.value), gbif: b.gbif?.value ?? null });
  }
  cache.byFam[f.qid] = list;
  tSpecies += list.length; n++;
  if (n % 10 === 0 || list.length > 400) { writeFileSync(OUT, JSON.stringify(cache)); process.stderr.write(`species: ${n}/${set.length} families, ${tSpecies} species (last: ${f.name} +${list.length})\n`); }
  await sleep(80);
}
writeFileSync(OUT, JSON.stringify(cache));
const allSpecies = Object.values(cache.byFam).flat();
const genera = new Set(allSpecies.map((s) => s.genus));
console.log(`\n✓ STEP A done: ${allSpecies.length} species, ${Object.keys(cache.byFam).length} families, ${genera.size} genera (${allSpecies.filter((s) => s.gbif).length} with GBIF id)`);
console.log(`  next: caffeinate -i node scripts/pull-pageviews.mjs`);
