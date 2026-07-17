// Benchmark Wikidata as a common-name source against the CURRENT (GBIF-derived)
// names in taxonomy.json — BEFORE deciding whether/how to adopt it. Read-only.
//
// For every species (by GBIF taxon id, P846) and named clade (by OTT id, P9157) it
// pulls from Wikidata: the English rdfs:label (usually the SCI name for taxa), the
// P1843 "taxon common name" values (en), sitelink count, and the enwiki article
// title. Then it reports coverage, agreement, gaps Wikidata could fill, and
// divergences — the numbers we need to pick a strategy.
//
// Caches raw Wikidata results to node_modules/.cache/wd-names.json (resumable).
// Run: node scripts/bench-wikidata-names.mjs

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CACHE_DIR = resolve(ROOT, "node_modules/.cache");
const CACHE = resolve(CACHE_DIR, "wd-names.json");
const WDQS = "https://query.wikidata.org/sparql";
const UA = "GrebeGames/1.0 (taxonomy name benchmark; nkempynck@gmail.com)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sparql(query, tries = 4) {
  const url = `${WDQS}?format=json&query=${encodeURIComponent(query)}`;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/sparql-results+json" } });
      if (r.ok) return (await r.json()).results.bindings;
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      console.error("HTTP", r.status); return null;
    } catch (e) { await sleep(1500 * (i + 1)); }
  }
  return null;
}

// cleanCommon, mirroring build-taxonomy.mjs (so "would Wikidata pass our filter?").
function cleanCommon(name) {
  if (!name) return null;
  const n = name.trim();
  if (n.length < 2 || n.length > 30) return null;
  if (/[0-9(){}\[\]\/]/.test(n)) return null;
  if (/[^\x00-\x7F]/.test(n)) return null;
  if (n === n.toUpperCase() && n.length <= 5) return null;
  if (n.split(/\s+/).length > 4) return null;
  const norm = n === n.toUpperCase() ? n.toLowerCase() : n;
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}

const tax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const species = tax.nodes.filter((n) => n.rank === "species");
const clades = tax.nodes.filter((n) => n.rank !== "species" && /^ott/.test(n.id) && (n.common || n.sciName));

// ---- fetch (cached) ----
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : { sp: {}, cl: {} };

async function fetchGroup(items, idProp, keyOf, store) {
  const todo = items.filter((it) => cache[store][keyOf(it)] === undefined);
  console.error(`${store}: ${items.length} total, ${todo.length} to fetch`);
  for (let i = 0; i < todo.length; i += 200) {
    const batch = todo.slice(i, i + 200);
    const values = batch.map((it) => `"${keyOf(it)}"`).join(" ");
    const q = `SELECT ?id ?label ?sl ?article (GROUP_CONCAT(DISTINCT ?cn;separator="|") AS ?cns) WHERE {
      VALUES ?id { ${values} }
      ?item wdt:${idProp} ?id .
      OPTIONAL { ?item rdfs:label ?label. FILTER(lang(?label)="en") }
      OPTIONAL { ?item wikibase:sitelinks ?sl. }
      OPTIONAL { ?item wdt:P1843 ?cn. FILTER(lang(?cn)="en") }
      OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. }
    } GROUP BY ?id ?label ?sl ?article`;
    const rows = await sparql(q);
    if (rows === null) { console.error("  batch failed, saving partial"); break; }
    for (const it of batch) cache[store][keyOf(it)] = null; // default: no WD item
    for (const b of rows) {
      cache[store][b.id.value] = {
        label: b.label?.value ?? null,
        sl: b.sl ? Number(b.sl.value) : 0,
        article: b.article ? decodeURIComponent(b.article.value.split("/wiki/")[1] || "").replace(/_/g, " ") : null,
        cns: b.cns?.value ? b.cns.value.split("|") : [],
      };
    }
    writeFileSync(CACHE, JSON.stringify(cache));
    console.error(`  ${Math.min(i + 200, todo.length)}/${todo.length}`);
    await sleep(300);
  }
}

await fetchGroup(species, "P846", (n) => n.id, "sp");
await fetchGroup(clades, "P9157", (n) => n.id.replace(/^ott/, ""), "cl");

// ---- analyze ----
function analyzeSpecies() {
  let wdItem = 0, hasP1843 = 0, articleCommon = 0, agree = 0, diverge = 0, wdFillsGap = 0, currentOnly = 0;
  const fixSamples = [], divergeSamples = [], gapSamples = [];
  for (const n of species) {
    const w = cache.sp[n.id];
    const cur = n.common ?? null;
    const p1843 = w ? w.cns.map(cleanCommon).find(Boolean) ?? null : null;
    // enwiki title is a "common" only if it differs from the scientific name
    const artCommon = w?.article && w.article.toLowerCase() !== n.sciName.toLowerCase() ? cleanCommon(w.article) : null;
    if (w) wdItem++;
    if (p1843) hasP1843++;
    if (artCommon) articleCommon++;
    if (cur && p1843) {
      if (cur.toLowerCase() === p1843.toLowerCase()) agree++;
      else { diverge++; if (divergeSamples.length < 20) divergeSamples.push(`${cur}  ~  ${p1843}  [${n.sciName}]`); }
    }
    if (!cur && p1843) { wdFillsGap++; if (gapSamples.length < 15) gapSamples.push(`${p1843}  [${n.sciName}]`); }
    if (cur && !p1843) currentOnly++;
  }
  console.log(`\n===== SPECIES (${species.length}) =====`);
  console.log(`Wikidata item found (P846):   ${wdItem} (${pct(wdItem, species.length)})`);
  console.log(`has P1843 en common name:     ${hasP1843} (${pct(hasP1843, species.length)})`);
  console.log(`enwiki title is a common:     ${articleCommon} (${pct(articleCommon, species.length)})`);
  console.log(`both present & AGREE:          ${agree}`);
  console.log(`both present & DIVERGE:        ${diverge}`);
  console.log(`WD fills a gap (we had none):  ${wdFillsGap}`);
  console.log(`we have name, WD has none:     ${currentOnly}`);
  console.log(`\ndiverge samples (current ~ wikidata):`);
  for (const s of divergeSamples) console.log("  " + s);
  console.log(`\ngap-fill samples (we had no name, WD does):`);
  for (const s of gapSamples) console.log("  " + s);
}

function analyzeClades() {
  let wdItem = 0, hasP1843 = 0, agree = 0, diverge = 0, gap = 0;
  const divergeSamples = [], gapSamples = [];
  for (const n of clades) {
    const w = cache.cl[n.id.replace(/^ott/, "")];
    const cur = n.common && n.common !== n.sciName ? n.common : null;
    const p1843 = w ? w.cns.map(cleanCommon).find(Boolean) ?? null : null;
    if (w) wdItem++;
    if (p1843) hasP1843++;
    if (cur && p1843) { if (cur.toLowerCase() === p1843.toLowerCase()) agree++; else { diverge++; if (divergeSamples.length < 15) divergeSamples.push(`${cur}  ~  ${p1843}  [${n.sciName}]`); } }
    if (!cur && p1843) { gap++; if (gapSamples.length < 15) gapSamples.push(`${p1843}  [${n.sciName}]`); }
  }
  console.log(`\n===== NAMED CLADES (${clades.length}) =====`);
  console.log(`Wikidata item found (P9157):  ${wdItem} (${pct(wdItem, clades.length)})`);
  console.log(`has P1843 en common name:     ${hasP1843} (${pct(hasP1843, clades.length)})`);
  console.log(`both present & AGREE:          ${agree}`);
  console.log(`both present & DIVERGE:        ${diverge}`);
  console.log(`WD fills a gap (sci-only now): ${gap}`);
  console.log(`\nclade diverge samples:`); for (const s of divergeSamples) console.log("  " + s);
  console.log(`\nclade gap-fill samples (sci-only now -> WD common):`); for (const s of gapSamples) console.log("  " + s);
}
const pct = (a, b) => `${((a / b) * 100).toFixed(0)}%`;

analyzeSpecies();
analyzeClades();
