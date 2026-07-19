// Assemble the final ~1000-family set for the Wikipedia-first pool:
//   SEED  = every current animal+plant family (in-set ∪ guessIndex; fungi dropped) — no regression
//   FILL  = all available families from the neglected/thin phyla (annelids, sponges,
//           corals, mosses, sea stars, worms…) that the current GBIF data misses
// Resolves each family to a Wikidata qid (needed for the species pull); families with
// no standalone enwiki page (sloths, frigatebirds…) get their qid via P225 lookup.
// Writes node_modules/.cache/sel-familyset.json. Run: node scripts/build-family-set.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const D = resolve(ROOT, "src/data");
const OUT = resolve(C, "sel-familyset.json");
const UA = "GrebeGames/1.0 (family-set)";
const WDQS = "https://query.wikidata.org/sparql";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sparql = async (q) => { for (let i = 0; i < 4; i++) { try { const r = await fetch(`${WDQS}?format=json&query=${encodeURIComponent(q)}`, { headers: { "user-agent": UA, accept: "application/sparql-results+json" } }); if (r.ok) return await r.json(); if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; } return { __err: r.status }; } catch { await sleep(1500 * (i + 1)); } } return { __err: "to" }; };

const famCache = JSON.parse(readFileSync(resolve(C, "sel-families.json"), "utf8")).fams;
const nameToQid = new Map(); for (const [qid, f] of Object.entries(famCache)) if (!nameToQid.has(f.name)) nameToQid.set(f.name, qid);
const cl = JSON.parse(readFileSync(resolve(C, "sel-classify-otl.json"), "utf8")).byName;

const tax = JSON.parse(readFileSync(resolve(D, "taxonomy.json"), "utf8"));
const gi = JSON.parse(readFileSync(resolve(D, "guessIndex.generated.json"), "utf8"));
const cur = new Set(tax.nodes.filter((n) => n.rank === "family").map((n) => n.sciName));
for (const e of gi.entries) for (const l of (e.graft?.lineage || [])) if (l.rank === "family") cur.add(l.sciName);

const ap = (n) => { const k = cl[n]?.kingdom; return k === "Animalia" || k === "Plantae"; };

const seed = [...cur].filter(ap);                       // current animal+plant families
const seedSet = new Set(seed);
// fill: ALL prominent (classified, top-2500-by-sitelinks) animal+plant families not in
// the seed — every phylum, not just the neglected ones. The earlier neglected-only fill
// dropped prominent big-phylum families absent from the current data (Hominidae, Apidae,
// Cyprinidae, Liliaceae, Rutaceae…). Include them so the pull covers the whole tree.
const fill = [];
for (const [n] of Object.entries(cl)) {
  if (!ap(n) || seedSet.has(n)) continue;
  if (nameToQid.has(n)) fill.push(n);
}
const chosen = [...seed, ...fill];
console.log(`seed (current animal+plant): ${seed.length}`);
console.log(`fill (neglected phyla): ${fill.length}`);
console.log(`total: ${chosen.length}`);

// resolve qids; the ones missing an enwiki family page need a P225 lookup
const rec = chosen.map((name) => ({ name, qid: nameToQid.get(name) ?? null, ott: cl[name]?.ott ?? null, kingdom: cl[name]?.kingdom ?? null, phylum: cl[name]?.phylum ?? "(no phylum)", source: seedSet.has(name) ? "seed" : "fill" }));
const missing = rec.filter((r) => !r.qid);
console.log(`\nresolving ${missing.length} families without a cached qid via P225…`);
for (let i = 0; i < missing.length; i += 100) {
  const chunk = missing.slice(i, i + 100);
  const vals = chunk.map((r) => `"${r.name.replace(/"/g, '')}"`).join(" ");
  const q = `SELECT ?name ?f WHERE { VALUES ?name { ${vals} } ?f wdt:P225 ?name; wdt:P105 wd:Q35409 . }`;
  const res = await sparql(q);
  if (res.__err) { console.error(`  P225 batch err ${res.__err}`); continue; }
  const m = new Map(); for (const b of res.results.bindings) if (!m.has(b.name.value)) m.set(b.name.value, b.f.value.split("/").pop());
  for (const r of chunk) if (m.has(r.name)) r.qid = m.get(r.name);
}
const stillMissing = rec.filter((r) => !r.qid);
writeFileSync(OUT, JSON.stringify(rec));

// summary
const byPhy = {}; for (const r of rec) byPhy[r.phylum] = (byPhy[r.phylum] ?? 0) + 1;
const byKing = {}; for (const r of rec) byKing[r.kingdom] = (byKing[r.kingdom] ?? 0) + 1;
console.log(`\n✓ wrote ${OUT}`);
console.log(`final family set: ${rec.length} (${rec.filter((r) => r.qid).length} with qid, ${stillMissing.length} unresolved)`);
console.log(`by kingdom:`, JSON.stringify(byKing));
console.log(`by phylum:`, JSON.stringify(Object.fromEntries(Object.entries(byPhy).sort((a, b) => b[1] - a[1]))));
if (stillMissing.length) console.log(`unresolved (will pull via OTL fallback):`, stillMissing.map((r) => r.name).join(", "));
