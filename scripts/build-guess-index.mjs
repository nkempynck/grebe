// Build the OUT-OF-SET guess index (guess-coverage feature).
//
// The playable/answer set (taxonomy.json) is a curated slice. This script builds a
// broader index of organisms a player might GUESS but that we don't ship, each with
// the lineage needed to graft it onto our tree (see src/core/graft.ts): the missing
// ancestor clades plus the first ancestor we DO ship (the connection point).
//
// Pipeline per candidate:
//   GBIF occurrence-ranked species (per group, with an English common name)
//     → drop ones already in taxonomy.json
//     → OTL TNRS: canonical name → OTT id
//     → OTL taxon_info(include_lineage): OTT ancestor chain
//     → trim at the first ancestor we ship  ⇒  a graft payload.
//
// Output: src/data/guessIndex.generated.json (bundled for now; the DB-backed
// search_taxa RPC is a later step). Re-run to refresh. Usage:
//   node scripts/build-guess-index.mjs [--groups=Mammalia,Aves] [--cap=200]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const TAX = resolve(ROOT, "src/data/taxonomy.json");
const OUT = resolve(ROOT, "src/data/guessIndex.generated.json");

const GBIF = "https://api.gbif.org/v1";
const OTL = "https://api.opentreeoflife.org/v3";

// --- CLI ---
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};
const GROUPS = arg("groups", "Mammalia,Aves,Squamata,Amphibia").split(",").map((s) => s.trim()).filter(Boolean);
const CAP = parseInt(arg("cap", "200"), 10);            // species swept per group
const CLADE_RANKS = ["ORDER", "FAMILY"];                // higher taxa to index (scouting-useful)
const CLADE_CAP = parseInt(arg("cladecap", "500"), 10); // higher taxa scanned per rank per group
const NO_CLADES = process.argv.includes("--no-clades");

// --- HTTP (retry + concurrency), mirroring build-taxonomy.mjs ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(url, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (res.ok) return json;
      if (res.status === 429 || res.status >= 500) { await sleep(500 * (i + 1)); continue; }
      return { __error: true, status: res.status };
    } catch { await sleep(500 * (i + 1)); }
  }
  return { __error: true, status: 0 };
}
const getJSON = (url) => req(url, { headers: { accept: "application/json" } });
const postJSON = (url, body) =>
  req(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// --- name cleaning (subset of build-taxonomy.mjs cleanCommon) ---
function cleanCommon(name) {
  if (!name) return null;
  const n = name.trim();
  if (n.length < 2 || n.length > 30) return null;
  if (/[0-9(){}\[\]\/]/.test(n)) return null;
  if (/[^\x00-\x7F]/.test(n)) return null;
  if (n.split(/\s+/).length > 4) return null;
  const norm = n === n.toUpperCase() ? n.toLowerCase() : n;
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}
const normalizeName = (s) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();

async function englishCommonName(key, sciName) {
  const doc = await getJSON(`${GBIF}/species/${key}/vernacularNames?limit=80`);
  if (!doc || doc.__error) return null;
  const eng = (doc.results ?? []).filter((v) => v.language === "eng" && v.vernacularName);
  const preferred = eng.filter((v) => v.preferred).map((v) => v.vernacularName);
  const sciTokens = new Set((sciName ?? "").toLowerCase().split(/\s+/));
  for (const c of [...preferred, ...eng.map((v) => v.vernacularName)]) {
    const cc = cleanCommon(c);
    if (cc && !sciTokens.has(cc.toLowerCase())) return cc;
  }
  return null;
}

const GBIF_BACKBONE = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";
async function groupKey(name) {
  const doc = await getJSON(`${GBIF}/species/match?name=${encodeURIComponent(name)}`);
  if (doc && !doc.__error && doc.matchType !== "NONE" && doc.usageKey) return doc.usageKey;
  // Some higher taxa (e.g. Amphibia) don't resolve via /match — fall back to an
  // exact-name search within the GBIF backbone dataset.
  const s = await getJSON(`${GBIF}/species/search?q=${encodeURIComponent(name)}&datasetKey=${GBIF_BACKBONE}&limit=10`);
  const hit = (s?.results ?? []).find((r) => r.canonicalName === name);
  return hit ? (hit.nubKey ?? hit.key ?? null) : null;
}

// Occurrence-ranked species in a group that carry an English common name.
async function sweepGroup(name) {
  const key = await groupKey(name);
  if (!key) { console.warn(`  ! could not resolve group ${name}`); return []; }
  const doc = await getJSON(`${GBIF}/occurrence/search?taxonKey=${key}&facet=speciesKey&facetLimit=${CAP * 3}&limit=0`);
  const ranked = (doc?.facets?.[0]?.counts ?? []).map((c) => c.name);
  const chosen = [];
  for (let i = 0; i < ranked.length && chosen.length < CAP; i += 24) {
    const recs = (await mapLimit(ranked.slice(i, i + 24), 8, (sk) => getJSON(`${GBIF}/species/${sk}`)))
      .filter((s) => s && !s.__error && s.rank === "SPECIES" && s.canonicalName);
    await mapLimit(recs, 8, async (s) => { s.common = await englishCommonName(s.speciesKey ?? s.key, s.canonicalName); });
    for (const s of recs) {
      if (chosen.length >= CAP) break;
      if (s.common) chosen.push({ canonicalName: s.canonicalName, common: s.common });
    }
  }
  return chosen;
}

// Higher taxa (orders, families) in a group — the scouting-useful clades. Unlike
// species we DON'T require a common name (Latin is a valid way to scout a clade),
// but we take an English vernacular inline from the search result when present.
async function sweepClades(name) {
  const key = await groupKey(name);
  if (!key) return [];
  const out = [];
  for (const rank of CLADE_RANKS) {
    for (let offset = 0; offset < CLADE_CAP; offset += 100) {
      const doc = await getJSON(`${GBIF}/species/search?highertaxonKey=${key}&rank=${rank}&status=ACCEPTED&limit=100&offset=${offset}`);
      const results = doc?.results ?? [];
      for (const r of results) {
        if (!r.canonicalName) continue;
        const eng = (r.vernacularNames ?? []).find((v) => v.language === "eng" && v.vernacularName);
        out.push({ canonicalName: r.canonicalName, common: eng ? cleanCommon(eng.vernacularName) : null });
      }
      if (results.length < 100) break;
    }
  }
  return out;
}

// OTL TNRS: canonical names → { name: ott_id }.
async function tnrsMatch(names) {
  const out = new Map();
  for (let i = 0; i < names.length; i += 250) {
    const chunk = names.slice(i, i + 250);
    const doc = await postJSON(`${OTL}/tnrs/match_names`, { names: chunk, do_approximate_matching: false });
    for (const r of doc?.results ?? []) {
      const m = r.matches?.[0];
      if (m?.taxon?.ott_id) out.set(r.name, { ott: m.taxon.ott_id, rank: m.taxon.rank, name: m.taxon.name });
    }
  }
  return out;
}

async function main() {
  const tax = JSON.parse(readFileSync(TAX, "utf8"));
  const shipped = new Set(tax.nodes.map((n) => n.id)); // OTT ids we already have
  const shippedNames = new Set(tax.nodes.map((n) => normalizeName(n.sciName)));
  console.log(`taxonomy: ${tax.nodes.length} nodes shipped. Groups: ${GROUPS.join(", ")} (cap ${CAP})`);

  // 1) sweep candidates: recognizable species + higher taxa (orders/families)
  const seen = new Set();
  const candidates = [];
  const add = (c) => {
    const k = normalizeName(c.canonicalName);
    if (!k || seen.has(k) || shippedNames.has(k)) return; // dedupe + skip already-shipped
    seen.add(k);
    candidates.push(c);
  };
  for (const g of GROUPS) {
    const species = await sweepGroup(g);
    species.forEach(add);
    const clades = NO_CLADES ? [] : await sweepClades(g);
    clades.forEach(add);
    console.log(`  ${g}: species ${species.length}, clades ${clades.length}, kept ${candidates.length} total`);
  }

  // 2) resolve to OTT
  const matched = await tnrsMatch(candidates.map((c) => c.canonicalName));
  const toResolve = [];
  for (const c of candidates) {
    const m = matched.get(c.canonicalName);
    if (!m) continue;
    if (shipped.has("ott" + m.ott)) continue; // already in our tree under another name
    toResolve.push({ ...c, ott: m.ott, rank: m.rank, sciName: m.name });
  }
  console.log(`resolved ${toResolve.length}/${candidates.length} to OTT ids not already shipped`);

  // 3) lineage → graft payload (trim at first shipped ancestor)
  let connected = 0, orphaned = 0;
  const entries = [];
  await mapLimit(toResolve, 6, async (c) => {
    const doc = await postJSON(`${OTL}/taxonomy/taxon_info`, { ott_id: c.ott, include_lineage: true });
    if (!doc || doc.__error || !Array.isArray(doc.lineage)) { orphaned++; return; }
    const lineage = [];
    let connectedHere = false;
    for (const a of doc.lineage) {
      const id = "ott" + a.ott_id;
      lineage.push({ id, sciName: a.name, rank: a.rank });
      if (shipped.has(id)) { connectedHere = true; break; } // connection point — stop
    }
    if (!connectedHere) { orphaned++; return; }
    connected++;
    const keys = [...new Set([normalizeName(c.common), normalizeName(c.canonicalName)])].filter(Boolean);
    entries.push({
      keys,
      graft: { id: "ott" + c.ott, sciName: c.sciName, common: c.common, rank: c.rank, lineage },
    });
  });
  console.log(`grafted ${connected}, orphaned ${orphaned} (no shipped ancestor)`);

  // Dedupe by OTT id: distinct source names can resolve to the same taxon.
  const uniq = [...new Map(entries.map((e) => [e.graft.id, e])).values()];
  uniq.sort((a, b) => a.keys[0].localeCompare(b.keys[0]));
  writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), groups: GROUPS, cap: CAP, entries: uniq }, null, 0) + "\n");
  console.log(`wrote ${uniq.length} entries (${entries.length - uniq.length} duplicate ott_id dropped) → ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
