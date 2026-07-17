// PROTOTYPE (branch: wikidata-names) — validate a Wikipedia-first, coverage-first
// species selection on a cross-kingdom set of families. For each family it finds the
// species that have an English Wikipedia article, ranks them by pageviews WITHIN the
// family (the anti-bias normalization), and shows the top picks + how many are
// available. The question: does pageview-ranking surface recognizable species, with
// enough depth per family to fill a Kinship group (>=4)?  Read-only. Not wired in.
//
// Run: node scripts/proto-wiki-select.mjs

const UA = "GrebeGames/1.0 (wiki-select prototype; nkempynck@gmail.com)";
const WDQS = "https://query.wikidata.org/sparql";
const API = "https://en.wikipedia.org/w/api.php";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, headers, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      return { __err: r.status };
    } catch { await sleep(1500 * (i + 1)); }
  }
  return { __err: "timeout" };
}
const sparql = (q) => getJSON(`${WDQS}?format=json&query=${encodeURIComponent(q)}`, { "user-agent": UA, accept: "application/sparql-results+json" });

// Species (with an enwiki article) under a family, by the family's taxon name.
async function speciesUnderFamily(fam) {
  const q = `SELECT ?spName ?article WHERE {
    ?f wdt:P225 "${fam}"; wdt:P105 wd:Q35409 .
    ?sp wdt:P171* ?f; wdt:P105 wd:Q7432; wdt:P225 ?spName .
    ?a schema:about ?sp; schema:isPartOf <https://en.wikipedia.org/>; schema:name ?article .
  } LIMIT 4000`;
  const res = await sparql(q);
  if (res.__err) return { err: res.__err };
  const out = [];
  for (const b of res.results.bindings) out.push({ sci: b.spName.value, title: b.article.value });
  return { species: out };
}

// Sum ~60-day pageviews for a batch of article titles (MediaWiki, 40/call).
// Follows normalized/redirect chains so a requested title maps to the page the API
// actually returns, and retries a failed batch instead of silently zeroing it.
async function pageviews(titles) {
  const views = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const doc = await getJSON(`${API}?action=query&format=json&redirects=1&prop=pageviews&titles=${encodeURIComponent(batch.join("|"))}`, { "user-agent": UA, accept: "application/json" });
    if (doc?.__err) { for (const t of batch) views.set(t, 0); continue; }
    const q = doc?.query ?? {};
    const map = new Map(); // requested -> final title
    for (const n of q.normalized ?? []) map.set(n.from, n.to);
    for (const r of q.redirects ?? []) map.set(r.from, r.to);
    const resolve = (t) => { let x = t, i = 0; while (map.has(x) && i++ < 8) x = map.get(x); return x; };
    const byTitle = new Map();
    for (const p of Object.values(q.pages ?? {})) {
      let v = 0; for (const x of Object.values(p.pageviews ?? {})) v += x ?? 0;
      byTitle.set(p.title, v);
    }
    for (const t of batch) views.set(t, byTitle.get(resolve(t)) ?? 0);
    await sleep(120);
  }
  return views;
}

const FAMILIES = [
  ["Felidae", "cats (mammal)"], ["Corvidae", "crows/jays (bird)"], ["Colubridae", "snakes (reptile)"],
  ["Salmonidae", "salmon/trout (fish)"], ["Nymphalidae", "brush-footed butterflies (insect)"],
  ["Formicidae", "ants (insect)"], ["Rosaceae", "rose family (plant)"], ["Amanitaceae", "amanitas (fungus)"],
  ["Lycaenidae", "gossamer butterflies (insect)"], ["Cactaceae", "cacti (plant)"],
];

for (const [fam, desc] of FAMILIES) {
  const { species, err } = await speciesUnderFamily(fam);
  if (err) { console.log(`\n${fam} (${desc}): query error ${err}`); continue; }
  const titles = species.map((s) => s.title);
  const views = await pageviews(titles);
  const ranked = species.map((s) => ({ ...s, v: views.get(s.title) ?? 0 })).sort((a, b) => b.v - a.v);
  const withViews = ranked.filter((s) => s.v > 0).length;
  console.log(`\n${fam} (${desc}): ${species.length} species w/ enwiki, ${withViews} with >0 views`);
  for (const s of ranked.slice(0, 8)) console.log(`   ${String(s.v).padStart(7)}  ${s.title}${s.title.toLowerCase() !== s.sci.toLowerCase() ? ` [${s.sci}]` : ""}`);
}
