// FIX the pageview cache. The original pull batched 40 titles but did NOT follow the
// MediaWiki `continue` token: when a batch contained a problematic title, the API
// returned pageviews for only some titles + a `pvipcontinue`, and the rest were
// wrongly recorded as 0 (this zeroed famous articles like Tiger/Wolf/Great crested
// grebe when they shared a batch with a bad title). Non-zero values are correct (the
// bug only drops to 0). So re-fetch ONLY the zeros, this time draining `continue`.
// Run: node scripts/fix-pageviews.mjs   (safe to re-run; resumable)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OUT = resolve(C, "sel-pool-pageviews.json");
const API = "https://en.wikipedia.org/w/api.php";
const UA = "GrebeGames/1.0 (pageview fix)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, tries = 6) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } }); if (r.ok) return await r.json(); if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; } return { __err: r.status }; } catch { await sleep(1500 * (i + 1)); } } return { __err: "to" }; }

// Fetch pageviews for a batch, draining the continue token so EVERY title is populated.
async function fetchBatch(batch) {
  const base = `${API}?action=query&format=json&redirects=1&prop=pageviews&titles=${encodeURIComponent(batch.join("|"))}`;
  const map = new Map();       // redirect/normalize: requested -> final title
  const byTitle = new Map();   // final title -> summed views
  // Two SEPARATE guards: errGuard bounds transient-error retries (rate limits),
  // contGuard bounds continue-token iterations. Sharing them (old bug) let 429s
  // exhaust the budget and stop draining `continue` early, zeroing famous titles.
  let cont = null, contGuard = 0, errGuard = 0;
  while (true) {
    let url = base;
    if (cont) for (const [k, v] of Object.entries(cont)) url += `&${k}=${encodeURIComponent(v)}`;
    const doc = await getJSON(url);
    if (doc?.__err) { if (++errGuard > 12) break; await sleep(1500 * errGuard); continue; }
    const q = doc.query ?? {};
    for (const n of q.normalized ?? []) map.set(n.from, n.to);
    for (const r of q.redirects ?? []) map.set(r.from, r.to);
    for (const p of Object.values(q.pages ?? {})) {
      if (!p.pageviews) continue;
      let v = 0, any = false; for (const x of Object.values(p.pageviews)) { if (x != null) { v += x; any = true; } }
      if (any) byTitle.set(p.title, v);
    }
    cont = doc.continue ?? null;
    if (!cont || ++contGuard >= 60) break;
  }
  const resolveT = (t) => { let x = t, k = 0; while (map.has(x) && k++ < 8) x = map.get(x); return x; };
  const out = new Map();
  for (const t of batch) out.set(t, byTitle.get(resolveT(t)) ?? 0);
  return out;
}

const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
const todo = Object.keys(cache).filter((t) => cache[t] === 0); // re-fetch suspect zeros
process.stderr.write(`fix-pageviews: re-fetching ${todo.length} zero-valued titles (draining continue), concurrency ${6}\n`);
let fixed = 0, done = 0;
// build the list of 40-title batches, then run CONC of them in parallel
const batches = [];
for (let i = 0; i < todo.length; i += 40) batches.push(todo.slice(i, i + 40));
const CONC = 6;
let bi = 0;
await Promise.all(Array.from({ length: CONC }, async () => {
  while (bi < batches.length) {
    const batch = batches[bi++];
    const res = await fetchBatch(batch);
    for (const [t, v] of res) { if (v > 0 && cache[t] === 0) fixed++; cache[t] = v; }
    done += batch.length;
    if (done % 4000 < 40) { writeFileSync(OUT, JSON.stringify(cache)); process.stderr.write(`fix: ~${done}/${todo.length} (recovered ${fixed} nonzero)\n`); }
    await sleep(30);
  }
}));
writeFileSync(OUT, JSON.stringify(cache));
const pos = Object.values(cache).filter((v) => v > 0).length;
console.log(`\n✓ fix done. recovered ${fixed} previously-zeroed titles. now ${pos} titles with >0 views (was 40402).`);
