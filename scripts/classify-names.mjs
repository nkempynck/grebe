// Classify a given list of family NAMES by kingdom+phylum from OTL, merging into the
// existing sel-classify-otl.json cache. Used to seed the family set with current-data
// families that fell outside the top-2500 sitelink slice. Run: node scripts/classify-names.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const D = resolve(ROOT, "src/data");
const OUT = resolve(C, "sel-classify-otl.json");
const OTL = "https://api.opentreeoflife.org/v3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(u, b, t = 4) { for (let i = 0; i < t; i++) { try { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); if (r.ok) return await r.json(); if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1)); continue; } return { __err: r.status }; } catch { await sleep(1000 * (i + 1)); } } return { __err: "to" }; }
async function mapLimit(items, limit, fn) { let idx = 0; await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (idx < items.length) { const i = idx++; await fn(items[i]); } })); }

const cache = JSON.parse(readFileSync(OUT, "utf8"));
const tax = JSON.parse(readFileSync(resolve(D, "taxonomy.json"), "utf8"));
const gi = JSON.parse(readFileSync(resolve(D, "guessIndex.generated.json"), "utf8"));
const cur = new Set(tax.nodes.filter((n) => n.rank === "family").map((n) => n.sciName));
for (const e of gi.entries) for (const l of (e.graft?.lineage || [])) if (l.rank === "family") cur.add(l.sciName);
const need = [...cur].filter((n) => !cache.byName[n]?.kingdom);
process.stderr.write(`classifying ${need.length} current families\n`);
// TNRS match
for (let i = 0; i < need.length; i += 200) {
  const chunk = need.slice(i, i + 200);
  const doc = await post(`${OTL}/tnrs/match_names`, { names: chunk, do_approximate_matching: false });
  if (doc.__err) { i -= 200; await sleep(1500); continue; }
  for (const r of doc.results ?? []) { const t = r.matches?.find((m) => m.taxon?.rank === "family")?.taxon ?? r.matches?.[0]?.taxon; if (!cache.byName[r.name]) cache.byName[r.name] = {}; cache.byName[r.name].ott = t?.ott_id ?? null; }
}
const toInfo = need.filter((n) => cache.byName[n]?.ott);
let done = 0;
await mapLimit(toInfo, 8, async (n) => {
  const info = await post(`${OTL}/taxonomy/taxon_info`, { ott_id: cache.byName[n].ott, include_lineage: true });
  const lin = info.__err ? [] : (info.lineage ?? []);
  const names = new Set(lin.map((x) => x.name));
  cache.byName[n].kingdom = names.has("Metazoa") ? "Animalia" : (names.has("Chloroplastida") || names.has("Viridiplantae") || names.has("Archaeplastida")) ? "Plantae" : names.has("Fungi") ? "Fungi" : (lin.find((x) => x.rank === "kingdom")?.name ?? "other");
  cache.byName[n].phylum = lin.find((x) => x.rank === "phylum")?.name ?? null;
  if (++done % 100 === 0) process.stderr.write(`  ${done}/${toInfo.length}\n`);
});
writeFileSync(OUT, JSON.stringify(cache));
const byK = {}; for (const n of cur) { const k = cache.byName[n]?.kingdom ?? "unmatched"; byK[k] = (byK[k] ?? 0) + 1; }
console.log(`current families by kingdom:`, JSON.stringify(byK));
