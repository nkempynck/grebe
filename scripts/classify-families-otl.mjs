// Classify every family by kingdom + phylum from OPEN TREE OF LIFE (our topology
// source), replacing the slow Wikidata transitive pull. TNRS-match family names ->
// OTT ids (batched), then taxon_info(include_lineage) per family (concurrent) to read
// kingdom/phylum off the lineage. Lets step 2 pick a set balanced across the tree and
// filter to animals + green plants (drop fungi/protists/monera). Resumable.
//
//   node scripts/classify-families-otl.mjs
//   progress: /tmp/grebe-classify.log   data: node_modules/.cache/sel-classify-otl.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = resolve(ROOT, "node_modules/.cache");
const FAM = resolve(CACHE, "sel-families.json");
const OUT = resolve(CACHE, "sel-classify-otl.json");
const OTL = "https://api.opentreeoflife.org/v3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1)); continue; }
      return { __err: r.status };
    } catch { await sleep(1000 * (i + 1)); }
  }
  return { __err: "to" };
}
async function mapLimit(items, limit, fn) {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; await fn(items[i], i); }
  }));
}

// Only classify the most-prominent families (by sitelinks). We want ~1000 prominent
// animal+plant families; the high-sitelink head is overwhelmingly animals/plants, so
// the top slice yields far more than 1000 candidates without touching the obscure
// (mostly fungi/protist/monera) tail. Tunable via TOP_N.
const TOP_N = Number(process.env.TOP_N ?? 2500);
const fams = Object.entries(JSON.parse(readFileSync(FAM, "utf8")).fams)
  .map(([qid, f]) => ({ qid, name: f.name, sl: f.sl }))
  .sort((a, b) => b.sl - a.sl)
  .slice(0, TOP_N);
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { byName: {} };
process.stderr.write(`classifying top ${fams.length} families by sitelinks (>= ${fams.at(-1).sl} sitelinks)\n`);

// ---- 1) TNRS match names -> ott id (batched 200) ----
const need = fams.filter((f) => cache.byName[f.name]?.ott === undefined);
process.stderr.write(`match: ${need.length} family names to resolve (${fams.length - need.length} cached)\n`);
for (let i = 0; i < need.length; i += 200) {
  const chunk = need.slice(i, i + 200);
  const doc = await post(`${OTL}/tnrs/match_names`, { names: chunk.map((f) => f.name), do_approximate_matching: false });
  if (doc.__err) { process.stderr.write(`  match batch @${i} err ${doc.__err}, retry\n`); await sleep(2000); i -= 200; continue; }
  for (const r of doc.results ?? []) {
    const t = r.matches?.find((m) => m.taxon?.rank === "family")?.taxon ?? r.matches?.[0]?.taxon;
    cache.byName[r.name] = { ott: t?.ott_id ?? null };
  }
  for (const f of chunk) if (cache.byName[f.name] === undefined) cache.byName[f.name] = { ott: null };
  writeFileSync(OUT, JSON.stringify(cache));
  process.stderr.write(`match: ${Math.min(i + 200, need.length)}/${need.length}\n`);
}

// ---- 2) taxon_info lineage -> kingdom + phylum (concurrent) ----
const toInfo = fams.filter((f) => { const c = cache.byName[f.name]; return c?.ott && c.kingdom === undefined; });
process.stderr.write(`lineage: ${toInfo.length} families to classify\n`);
let done = 0;
await mapLimit(toInfo, 8, async (f) => {
  const info = await post(`${OTL}/taxonomy/taxon_info`, { ott_id: cache.byName[f.name].ott, include_lineage: true });
  const lin = info.__err ? [] : (info.lineage ?? []);
  const names = new Set(lin.map((x) => x.name));
  const kingdom = names.has("Metazoa") ? "Animalia"
    : (names.has("Chloroplastida") || names.has("Viridiplantae") || names.has("Archaeplastida")) ? "Plantae"
    : names.has("Fungi") ? "Fungi"
    : (lin.find((x) => x.rank === "kingdom")?.name ?? "other");
  const phylum = lin.find((x) => x.rank === "phylum")?.name ?? null;
  cache.byName[f.name].kingdom = kingdom;
  cache.byName[f.name].phylum = phylum;
  if (++done % 200 === 0) { writeFileSync(OUT, JSON.stringify(cache)); process.stderr.write(`lineage: ${done}/${toInfo.length}\n`); }
});
writeFileSync(OUT, JSON.stringify(cache));

// ---- summary ----
const rows = fams.map((f) => ({ ...f, ...cache.byName[f.name] }));
const byKing = {};
for (const r of rows) byKing[r.kingdom ?? "unmatched"] = (byKing[r.kingdom ?? "unmatched"] ?? 0) + 1;
console.log(`\nclassified ${rows.filter((r) => r.kingdom).length}/${fams.length} families (from OTL)`);
console.log("by kingdom:", JSON.stringify(byKing, null, 0));
const ap = rows.filter((r) => r.kingdom === "Animalia" || r.kingdom === "Plantae");
console.log(`animals + plants: ${ap.length} families`);
const byPhy = {};
for (const r of ap) byPhy[r.phylum ?? "(no phylum)"] = (byPhy[r.phylum ?? "(no phylum)"] ?? 0) + 1;
const top = Object.entries(byPhy).sort((a, b) => b[1] - a[1]).slice(0, 20);
console.log("top phyla (animals+plants):", JSON.stringify(Object.fromEntries(top)));
