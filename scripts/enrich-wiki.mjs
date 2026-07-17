// Enrich augment candidates with WIKIPEDIA PAGEVIEWS — a "how often do people look
// this up" signal, i.e. actual fame/recognisability, unlike GBIF occurrence counts
// which track survey effort and are geographically biased. Board generation can then
// prefer recognisable species and skip the obscure tail.
//
// Queries the MediaWiki API by SCIENTIFIC name (unambiguous; redirects=1 resolves to
// the real article even when it's titled by the common name, e.g. "Panthera leo" →
// "Lion"). prop=pageviews returns the last ~60 days of daily views, and titles batch
// 50 per call — so this is ~80 calls, not thousands. A missing article ⇒ 0 (obscure).
//
// Writes a resumable cache src/data/wikiViews.json ({ ottId: viewsSum }). Re-runnable.
//
// Run: node scripts/enrich-wiki.mjs

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const IDX = resolve(ROOT, "src/data/guessIndex.generated.json");
const CACHE = resolve(ROOT, "src/data/wikiViews.json");
const API = "https://en.wikipedia.org/w/api.php";
// Wikimedia blocks requests without a descriptive User-Agent (learned the hard way
// on the coverage check) — identify the tool and a contact.
const UA = "GrebeGames/1.0 (taxonomy augment prominence; contact nkempynck@gmail.com)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json", "user-agent": UA } });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) { await sleep(700 * (i + 1)); continue; }
      return null;
    } catch { await sleep(700 * (i + 1)); }
  }
  return null;
}

const FOREIGN = /\b(de|du|des|la|le|les|van|von|der|del|di|da|dos|das)\b/i;
const clean = (c, sci) => {
  if (!c) return false;
  const x = c.trim();
  if (x.length < 3) return false;
  if (!/[\s-]/.test(x) && x.length < 6 && !sci.toLowerCase().includes(x.toLowerCase())) return false;
  if (FOREIGN.test(x)) return false;
  return true;
};

const index = JSON.parse(readFileSync(IDX, "utf8"));
const seen = new Set();
const species = [];
for (const e of index.entries) {
  const g = e.graft;
  if (!g || g.rank !== "species" || !clean(g.common, g.sciName)) continue;
  if (seen.has(g.id) || !g.lineage?.length) continue;
  seen.add(g.id);
  species.push({ id: g.id, sci: g.sciName, common: g.common });
}

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const todo = species.filter((s) => cache[s.id] === undefined);
console.log(`${species.length} candidates; ${todo.length} to fetch (${species.length - todo.length} cached)`);

// Resolve a title through the normalized→redirect chain the API reports.
function makeResolver(query) {
  const map = new Map();
  for (const n of query?.normalized ?? []) map.set(n.from, n.to);
  for (const r of query?.redirects ?? []) map.set(r.from, r.to);
  return (title) => { let t = title, seen = 0; while (map.has(t) && seen++ < 10) t = map.get(t); return t; };
}

// Sum a page's pageviews, 0 if missing/none.
function pageViews(byTitle, resolver, title) {
  const page = byTitle.get(resolver(title));
  if (!page || "missing" in page || !page.pageviews) return 0;
  let v = 0;
  for (const x of Object.values(page.pageviews)) v += x ?? 0;
  return v;
}
// One batched pageviews query for a list of titles → { inputTitle: views }.
async function fetchViews(titles) {
  const url = `${API}?action=query&format=json&redirects=1&prop=pageviews&titles=${encodeURIComponent(titles.join("|"))}`;
  const doc = await getJSON(url);
  const query = doc?.query;
  const resolver = makeResolver(query);
  const byTitle = new Map();
  for (const p of Object.values(query?.pages ?? {})) byTitle.set(p.title, p);
  const out = new Map();
  for (const t of titles) out.set(t, pageViews(byTitle, resolver, t));
  return out;
}

let done = 0;
for (let i = 0; i < todo.length; i += 50) {
  const batch = todo.slice(i, i + 50);
  // Store BOTH signals: sci-name views (unambiguous but sparser coverage) and
  // common-name views (broader but risks ambiguous-title false positives). The
  // augment build decides how to combine them.
  const sciViews = await fetchViews(batch.map((s) => s.sci));
  const comViews = await fetchViews(batch.map((s) => s.common).filter(Boolean));
  for (const s of batch) cache[s.id] = { s: sciViews.get(s.sci) ?? 0, c: (s.common && comViews.get(s.common)) || 0 };
  done += batch.length;
  if (done % 500 < 50) { writeFileSync(CACHE, JSON.stringify(cache)); console.log(`  ${done}/${todo.length}`); }
  await sleep(120); // be polite
}
writeFileSync(CACHE, JSON.stringify(cache));

const maxes = Object.values(cache).map((v) => Math.max(v.s, v.c)).sort((a, b) => a - b);
const pct = (p) => maxes[Math.floor((maxes.length - 1) * p)];
console.log(`cached ${maxes.length} view pairs → src/data/wikiViews.json`);
console.log(`max(sci,common) dist: median=${pct(0.5)} p75=${pct(0.75)} p90=${pct(0.9)} max=${maxes[maxes.length - 1]}`);
console.log(`has any article (max>0): ${maxes.filter((v) => v > 0).length}/${maxes.length}`);
