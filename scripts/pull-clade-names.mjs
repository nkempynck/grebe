// Snapshot Wikidata's English common names (P1843) for every clade in our trees that has an
// Open Tree id, for patch-clade-common.mjs. build-names does the same lookup during a full
// rebuild, but only for nodes whose id IS an ott id (not junctions named since, not the
// augment), and it takes whichever name the query returns first. This snapshot covers every
// clade and stores the names sorted, so applying it is reproducible.
//
// Wikidata is not versioned, so the snapshot IS the version: rerun deliberately, then review the
// diff. Each entry keeps the item's taxon name (P225), because Open Tree reuses some ids across a
// clade and a species, and a name may only be taken from the item that is this clade.
//
// Second source, and the better one where it exists: the clade's English Wikipedia article.
// Wikipedia files many groups under their English name (Spheniscidae is the article "Penguin",
// Bombus "Bumblebee"). A title only counts when its page's Wikidata item carries exactly this
// clade's scientific name (P225); "Obama" resolves to Barack Obama, not the flatworm genus.
//
// Network. Writes scripts/clade-names.json (committed):
//   { fetched, byOtt: { "<ott number>": [{ sci, names: [...] }] }, titles: { "<sciName>": "<title>" } }
//   node scripts/pull-clade-names.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WDQS = "https://query.wikidata.org/sparql";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Wikimedia throttles anonymous clients hard; its policy asks for contact details in the user
// agent. Set WIKIMEDIA_CONTACT (an email or URL) when pulling; it is read from the environment so
// no address ends up in the repository.
const UA = `GrebeGames/1.0 (clade names${process.env.WIKIMEDIA_CONTACT ? `; ${process.env.WIKIMEDIA_CONTACT}` : ""})`;

async function sparql(q, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(WDQS, {
        method: "POST",
        headers: { "user-agent": UA, accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" },
        body: `query=${encodeURIComponent(q)}`,
      });
      if (r.ok) return (await r.json()).results.bindings;
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
      return null;
    } catch { await sleep(1500 * (i + 1)); }
  }
  return null;
}

/** The Open Tree id a clade node stands for: its own id, or the taxon a naming step matched. */
export const ottOf = (n) => (/^ott\d+$/.test(n.id) ? n.id.slice(3) : n.ottTaxon?.replace(/^ott/, "") ?? null);

if (import.meta.url === `file://${process.argv[1]}`) {
  const nodes = [
    ...JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8")).nodes,
    ...JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomyAugment.json"), "utf8")).nodes,
  ];
  const otts = [...new Set(nodes.filter((n) => n.rank !== "species").map(ottOf).filter(Boolean))].sort();
  console.log(`${otts.length} clade ott ids to look up`);
  const byOtt = {};
  for (let i = 0; i < otts.length; i += 150) {
    const batch = otts.slice(i, i + 150);
    const rows = await sparql(`SELECT ?ott ?sci (GROUP_CONCAT(DISTINCT ?cn;separator="|") AS ?cns) WHERE {
      VALUES ?ott { ${batch.map((o) => `"${o}"`).join(" ")} }
      ?item wdt:P9157 ?ott; wdt:P1843 ?cn. OPTIONAL { ?item wdt:P225 ?sci } FILTER(lang(?cn)="en") } GROUP BY ?ott ?sci`);
    if (!rows) throw new Error(`batch at ${i} failed; rerun`);
    for (const b of rows) {
      (byOtt[b.ott.value] ??= []).push({ sci: b.sci?.value ?? null, names: (b.cns?.value ?? "").split("|").filter(Boolean).sort() });
    }
    if ((i / 150) % 5 === 0) console.error(`  wikidata names ${Math.min(i + 150, otts.length)}/${otts.length}`);
    await sleep(200);
  }
  process.stderr.write("\n");
  const sorted = Object.fromEntries(Object.entries(byOtt).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => [k, v.sort((x, y) => String(x.sci).localeCompare(String(y.sci)))]));

  // Phase 2: Wikipedia titles, checked against Wikidata's taxon name.
  const getJSON = async (url) => {
    let status = "";
    for (let i = 0; i < 8; i++) {
      try {
        const r = await fetch(url, { headers: { "user-agent": UA } });
        if (r.ok) return await r.json();
        status = String(r.status);
      } catch (e) { status = String(e); }
      console.error(`  retry ${i + 1} after ${status}`);
      await sleep(3000 * (i + 1));
    }
    throw new Error(`request failed (${status}): ${url}`);
  };
  const names = [...new Set(nodes.filter((n) => n.rank !== "species" && n.sciName && !n.synthetic).map((n) => n.sciName))].sort();
  const pageOf = new Map(); // sciName -> { title, qid }
  for (let i = 0; i < names.length; i += 50) {
    const batch = names.slice(i, i + 50);
    const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageprops&ppprop=wikibase_item&titles=${encodeURIComponent(batch.join("|"))}`);
    const norm = new Map((j.query?.normalized ?? []).map((x) => [x.from, x.to]));
    const redir = new Map((j.query?.redirects ?? []).map((x) => [x.from, x.to]));
    const pages = new Map(Object.values(j.query?.pages ?? {}).filter((p) => !("missing" in p)).map((p) => [p.title, p.pageprops?.wikibase_item ?? null]));
    for (const sci of batch) {
      let t = norm.get(sci) ?? sci;
      t = redir.get(t) ?? t;
      if (pages.has(t)) pageOf.set(sci, { title: t, qid: pages.get(t) });
    }
    if ((i / 50) % 10 === 0) console.error(`  wikipedia titles ${Math.min(i + 50, names.length)}/${names.length}`);
    await sleep(400);
  }
  process.stderr.write("\n");
  const qids = [...new Set([...pageOf.values()].map((p) => p.qid).filter(Boolean))];
  const taxonNames = new Map(); // qid -> [P225...]
  for (let i = 0; i < qids.length; i += 50) {
    const j = await getJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=claims&ids=${qids.slice(i, i + 50).join("|")}`);
    for (const [q, e] of Object.entries(j.entities ?? {})) {
      taxonNames.set(q, (e.claims?.P225 ?? []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean));
    }
    if ((i / 50) % 10 === 0) console.error(`  taxon check ${Math.min(i + 50, qids.length)}/${qids.length}`);
    await sleep(400);
  }
  process.stderr.write("\n");
  const titles = {};
  for (const [sci, { title, qid }] of [...pageOf].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (title.toLowerCase() === sci.toLowerCase()) continue;
    if (!(taxonNames.get(qid) ?? []).some((x) => x.toLowerCase() === sci.toLowerCase())) continue;
    titles[sci] = title;
  }
  writeFileSync(resolve(ROOT, "scripts/clade-names.json"), JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), byOtt: sorted, titles }));
  console.log(`✓ ${Object.keys(sorted).length} clades have an English name on Wikidata, ${Object.keys(titles).length} a differently titled Wikipedia article -> scripts/clade-names.json`);
}
