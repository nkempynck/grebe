// Inject the curated EXTRAS (iconic species) that the Wikipedia-first pull can't reach
// because their article lives on a NON-TAXON Wikidata item (house cat -> "Cat",
// horse -> "Horse", grape, coconut, Portuguese man o' war…). For each EXTRA not already
// in the pool, resolve OTT id + lineage (OTL), GBIF id (GBIF match), and pageviews for
// its common-name article (Wikipedia), then append to sel-pool.json. Animal+plant only
// (fungi/microbe EXTRAS dropped). Cached in sel-extras.json (idempotent, re-runnable).
//
// Run AFTER build-pool.mjs and BEFORE pull-topology.mjs.  node scripts/inject-extras.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { EXTRAS as CURATED } from "./curated-extras.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const POOL = resolve(C, "sel-pool.json");
const CACHE = resolve(C, "sel-extras.json");
const OTL = "https://api.opentreeoflife.org/v3";
const GBIF = "https://api.gbif.org/v1";
const API = "https://en.wikipedia.org/w/api.php";
const UA = "GrebeGames/1.0 (inject extras)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (u, b) => { try { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return r.ok ? r.json() : { __err: r.status }; } catch { return { __err: "net" }; } };
const get = async (u) => { try { const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json" } }); return r.ok ? r.json() : { __err: r.status }; } catch { return { __err: "net" }; } };

const EXTRAS = CURATED.map((e) => ({ sci: e.name, common: e.common }));

const pool = JSON.parse(readFileSync(POOL, "utf8"));
const inPool = new Set(pool.map((s) => s.sci));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};

const todo = EXTRAS.filter((e) => !inPool.has(e.sci) && cache[e.sci] === undefined);
process.stderr.write(`EXTRAS: ${EXTRAS.length} total, ${EXTRAS.filter((e) => !inPool.has(e.sci)).length} not in pool, ${todo.length} to resolve\n`);

async function pageviews(title) {
  const doc = await get(`${API}?action=query&format=json&redirects=1&prop=pageviews&titles=${encodeURIComponent(title)}`);
  const p = Object.values(doc?.query?.pages ?? {})[0];
  if (!p?.pageviews) return { v: 0, article: title };
  let v = 0; for (const x of Object.values(p.pageviews)) v += x ?? 0;
  return { v, article: p.title };
}

for (const e of todo) {
  // OTL: name -> ott + lineage (family/genus/kingdom/phylum)
  const m = await post(`${OTL}/tnrs/match_names`, { names: [e.sci], do_approximate_matching: false });
  const ott = m?.results?.[0]?.matches?.[0]?.taxon?.ott_id ?? null;
  let family = null, genus = null, kingdom = null, phylum = null;
  if (ott) {
    const info = await post(`${OTL}/taxonomy/taxon_info`, { ott_id: ott, include_lineage: true });
    const lin = info?.lineage ?? [];
    const names = new Set(lin.map((x) => x.name));
    family = lin.find((x) => x.rank === "family")?.name ?? null;
    genus = lin.find((x) => x.rank === "genus")?.name ?? e.sci.split(" ")[0];
    kingdom = names.has("Metazoa") ? "Animalia" : (names.has("Chloroplastida") || names.has("Viridiplantae") || names.has("Archaeplastida")) ? "Plantae" : names.has("Fungi") ? "Fungi" : "other";
    phylum = lin.find((x) => x.rank === "phylum")?.name ?? "(no phylum)";
  }
  // GBIF id
  const gm = await get(`${GBIF}/species/match?name=${encodeURIComponent(e.sci)}`);
  const gbif = gm && !gm.__err ? String(gm.speciesKey ?? gm.usageKey ?? "") || null : null;
  // pageviews via common name (resolves redirect to the real article)
  const { v, article } = await pageviews(e.common);
  cache[e.sci] = { sci: e.sci, common: e.common, genus, family, kingdom, phylum, ott, gbif, title: e.common, article, v, sl: 100, injected: true };
  process.stderr.write(`  ${e.sci.padEnd(24)} ${kingdom ?? "?"} ${family ?? "?"} views=${v}\n`);
  await sleep(120);
}
writeFileSync(CACHE, JSON.stringify(cache));

// append animal+plant extras (not already in pool) to the pool
const add = Object.values(cache).filter((x) => (x.kingdom === "Animalia" || x.kingdom === "Plantae") && x.ott && x.v > 0 && !inPool.has(x.sci));
const merged = [...pool, ...add.map(({ injected, ...s }) => ({ ...s, injected: true }))];
merged.sort((a, b) => b.v - a.v);
writeFileSync(POOL, JSON.stringify(merged));
console.log(`\n✓ injected ${add.length} EXTRAS into pool (${pool.length} -> ${merged.length})`);
console.log("  added:", add.map((s) => `${s.common}(${s.v})`).join(", "));
const skipped = Object.values(cache).filter((x) => !((x.kingdom === "Animalia" || x.kingdom === "Plantae") && x.ott && x.v > 0) && !inPool.has(x.sci));
if (skipped.length) console.log("  skipped (fungi/unresolved):", skipped.map((s) => s.sci).join(", "));
