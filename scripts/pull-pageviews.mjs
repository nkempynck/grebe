// STEP B of the pool pull. Fetch ~60-day Wikipedia pageviews for every SPECIES title
// pulled in step A, plus every distinct GENUS and FAMILY name (clade pageviews, for
// board-making). Stores ALL pageviews (no threshold) so the in-set / board filters can
// be re-tuned later without re-fetching. Resumable, concurrent.
//
// IMPORTANT: the MediaWiki `prop=pageviews` action API, when a 40-title batch contains a
// problematic title, returns pageviews for only some titles + a `pvipcontinue`/`continue`
// token and leaves the rest unpopulated. We DRAIN the continue token so every title is
// scored (an earlier version recorded the unpopulated ones as 0, silently zeroing famous
// articles). Non-zero cached values are always correct.
//
//   caffeinate -i node scripts/pull-pageviews.mjs
//   progress: /tmp/grebe-pageviews.log   data: node_modules/.cache/sel-pool-pageviews.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const SP = resolve(C, "sel-familyspecies.json");
const SET = resolve(C, "sel-familyset.json");
const OUT = resolve(C, "sel-pool-pageviews.json");
const API = "https://en.wikipedia.org/w/api.php";
const UA = "GrebeGames/1.0 (pool pageviews)";
const CONC = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, tries = 6) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } }); if (r.ok) return await r.json(); if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; } return { __err: r.status }; } catch { await sleep(1500 * (i + 1)); } } return { __err: "to" }; }

// Fetch pageviews for a batch, DRAINING the continue token so every title is populated.
async function fetchBatch(batch) {
  const base = `${API}?action=query&format=json&redirects=1&prop=pageviews&titles=${encodeURIComponent(batch.join("|"))}`;
  const map = new Map(), byTitle = new Map();
  let cont = null, guard = 0;
  do {
    let url = base;
    if (cont) for (const [k, v] of Object.entries(cont)) url += `&${k}=${encodeURIComponent(v)}`;
    const doc = await getJSON(url);
    if (doc?.__err) { await sleep(1000); if (++guard > 30) break; continue; }
    const q = doc.query ?? {};
    for (const n of q.normalized ?? []) map.set(n.from, n.to);
    for (const r of q.redirects ?? []) map.set(r.from, r.to);
    for (const p of Object.values(q.pages ?? {})) { if (!p.pageviews) continue; let v = 0, any = false; for (const x of Object.values(p.pageviews)) { if (x != null) { v += x; any = true; } } if (any) byTitle.set(p.title, v); }
    cont = doc.continue ?? null;
  } while (cont && ++guard < 30);
  const resolveT = (t) => { let x = t, k = 0; while (map.has(x) && k++ < 8) x = map.get(x); return x; };
  const out = new Map();
  for (const t of batch) out.set(t, byTitle.get(resolveT(t)) ?? 0);
  return out;
}

const byFam = JSON.parse(readFileSync(SP, "utf8")).byFam;
const species = Object.values(byFam).flat();
const titles = new Set();
for (const s of species) { titles.add(s.title); titles.add(s.genus); }
for (const f of JSON.parse(readFileSync(SET, "utf8"))) titles.add(f.name);
const all = [...titles];
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const todo = all.filter((t) => cache[t] === undefined);
process.stderr.write(`pageviews: ${all.length} titles (${species.length} species + clades), ${todo.length} to fetch, concurrency ${CONC}\n`);

const batches = [];
for (let i = 0; i < todo.length; i += 40) batches.push(todo.slice(i, i + 40));
let bi = 0, done = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (bi < batches.length) {
    const batch = batches[bi++];
    const res = await fetchBatch(batch);
    for (const [t, v] of res) cache[t] = v;
    done += batch.length;
    if (done % 4000 < 40) { writeFileSync(OUT, JSON.stringify(cache)); process.stderr.write(`pageviews: ~${done}/${todo.length}\n`); }
    await sleep(30);
  }
}));
writeFileSync(OUT, JSON.stringify(cache));
const spWithViews = species.filter((s) => (cache[s.title] ?? 0) > 100).length;
console.log(`\n✓ STEP B done: ${Object.keys(cache).length} titles scored`);
console.log(`  species with >100 pageviews: ~${spWithViews} of ${species.length}`);
console.log(`  next: node scripts/build-pool.mjs`);
