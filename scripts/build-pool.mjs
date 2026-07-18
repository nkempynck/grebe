// Assemble the deduplicated recognizable POOL from the pull caches:
//   1. keep species with >100 Wikipedia pageviews
//   2. resolve each title through redirects to its CANONICAL article (synonyms like
//      "Felis leo" redirect to "Lion" — they share NO gbif id or title, only the
//      article, so redirect resolution is the only reliable dedup key)
//   3. collapse species that share a canonical article, keeping the best record
//      (accepted name whose title == the article, else most sitelinks)
// Writes node_modules/.cache/sel-pool.json. Run: node scripts/build-pool.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OUT = resolve(C, "sel-pool.json");
const RED = resolve(C, "sel-redirects.json"); // title -> canonical article (cached)
const API = "https://en.wikipedia.org/w/api.php";
const UA = "GrebeGames/1.0 (pool dedup)";
const MIN_VIEWS = Number(process.env.POOL_MIN ?? 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, headers, tries = 5) { for (let i = 0; i < tries; i++) { try { const r = await fetch(url, { headers }); if (r.ok) return await r.json(); if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; } return { __err: r.status }; } catch { await sleep(1500 * (i + 1)); } } return { __err: "to" }; }

const byFam = JSON.parse(readFileSync(resolve(C, "sel-familyspecies.json"), "utf8")).byFam;
const pv = JSON.parse(readFileSync(resolve(C, "sel-pool-pageviews.json"), "utf8"));
const set = JSON.parse(readFileSync(resolve(C, "sel-familyset.json"), "utf8"));
const famByQid = new Map(set.map((f) => [f.qid, f]));

// 1) candidates: species >100 views, tagged with family/phylum + views
const cand = [];
for (const [qid, list] of Object.entries(byFam)) {
  const fam = famByQid.get(qid);
  for (const s of list) { const v = pv[s.title] ?? 0; if (v > MIN_VIEWS) cand.push({ ...s, v, family: fam?.name ?? null, phylum: fam?.phylum ?? null, kingdom: fam?.kingdom ?? null }); }
}
console.log(`candidates (>${MIN_VIEWS} views): ${cand.length}`);

// 2) resolve titles -> canonical article via redirects (cached, batched 50)
const redir = existsSync(RED) ? JSON.parse(readFileSync(RED, "utf8")) : {};
const titles = [...new Set(cand.map((s) => s.title))];
const todo = titles.filter((t) => redir[t] === undefined);
console.log(`resolving ${todo.length} titles through redirects (${titles.length - todo.length} cached)…`);
for (let i = 0; i < todo.length; i += 50) {
  const batch = todo.slice(i, i + 50);
  const doc = await getJSON(`${API}?action=query&format=json&redirects=1&titles=${encodeURIComponent(batch.join("|"))}`, { "user-agent": UA, accept: "application/json" });
  if (doc?.__err) { await sleep(800); i -= 50; continue; }
  const q = doc.query ?? {};
  const map = new Map();
  for (const n of q.normalized ?? []) map.set(n.from, n.to);
  for (const r of q.redirects ?? []) map.set(r.from, r.to);
  const res = (t) => { let x = t, k = 0; while (map.has(x) && k++ < 8) x = map.get(x); return x; };
  for (const t of batch) redir[t] = res(t);
  if (i % 2000 === 0) writeFileSync(RED, JSON.stringify(redir));
  await sleep(90);
}
writeFileSync(RED, JSON.stringify(redir));

// 3) collapse by canonical article, keep best record
const groups = new Map();
for (const s of cand) { const key = redir[s.title] ?? s.title; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(s); }
let pool = [];
for (const [article, members] of groups) {
  members.sort((a, b) => {
    const am = a.title === article ? 1 : 0, bm = b.title === article ? 1 : 0; // prefer accepted (title == article)
    return bm - am || b.sl - a.sl;
  });
  pool.push({ ...members[0], article });
}
const deduped = pool.length;

// 4) CLEAN: drop junk articles/names and bad redirects.
//  - junk: non-article targets (En.wikipedia.org, List of…, disambiguation, raw URLs/genids)
//  - family-page redirects: a species whose only article is its family page
//  - genus-page redirects that are POLYTYPIC + low own-sitelinks: obscure species (and
//    untagged fossils like Bison palaeosinensis) that inherit their genus's inflated
//    views. Kept: monotypic genus-articles (Hippopotamus, Dugong) and famous type
//    species (Caracal caracal, Sorghum bicolor — high sitelinks).
const junkRe = /wikipedia|\.org|\.com|main page|^list of|\(disambiguation\)|https?:|genid/i;
const famSet = new Set(set.map((f) => f.name));
const genusCount = {};
for (const s of pool) genusCount[s.genus] = (genusCount[s.genus] ?? 0) + 1;
const REP_SITELINKS = 30; // a genus-page redirect with >= this many sitelinks is the famous representative
const dropped = { junk: 0, family: 0, genusRedirect: 0 };
pool = pool.filter((s) => {
  if (junkRe.test(s.article) || junkRe.test(s.sci)) { dropped.junk++; return false; }
  if (famSet.has(s.article)) { dropped.family++; return false; }
  if (s.article === s.genus && genusCount[s.genus] >= 2 && s.sl < REP_SITELINKS) { dropped.genusRedirect++; return false; }
  return true;
});
pool.sort((a, b) => b.v - a.v);
writeFileSync(OUT, JSON.stringify(pool));
console.log(`\n✓ pool: ${cand.length} candidates -> ${deduped} deduped -> ${pool.length} after clean`);
console.log(`  cleaned: ${dropped.junk} junk, ${dropped.family} family-page, ${dropped.genusRedirect} inflated genus-redirects`);
// sanity: the known synonym dups gone?
const lion = pool.filter((s) => (s.article ?? "").toLowerCase() === "lion");
const apple = pool.filter((s) => (s.article ?? "").toLowerCase() === "apple");
console.log(`  "Lion" article: ${lion.length} record (${lion.map((s) => s.sci).join(", ")})`);
console.log(`  "Apple" article: ${apple.length} record (${apple.map((s) => s.sci).join(", ")})`);
const byPhy = {}; for (const s of pool) byPhy[s.phylum] = (byPhy[s.phylum] ?? 0) + 1;
console.log(`  by phylum:`, JSON.stringify(Object.fromEntries(Object.entries(byPhy).sort((a, b) => b[1] - a[1]))));
