// Fetch the Open Tree Taxonomy (OTT) classification of every species in both trees and write
// the committed scripts/ott-lineages.json that patch-ott-names.mjs names clades from.
//
// WHY COMMITTED. The names must be reproducible: the same tree and this file always give the
// same names, offline. The file records the taxonomy version the API reported, so a refresh is
// a visible diff rather than a silent change.
//
// FORMAT. Each taxon is stored once with its parent, so a species' lineage is a walk:
//   species: { "<sciName>": <ott id of its parent taxon> }
//   taxa:    { "<ott id>": [name, rank, parent ott id | null] }
//
// Incremental: species already in the file are skipped. --refresh refetches everything.
//   node scripts/pull-ott-lineages.mjs [--refresh]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "scripts/ott-lineages.json");
const OTL = "https://api.opentreeoflife.org/v3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${OTL}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(800 * (i + 1)); continue; }
      return null;
    } catch { await sleep(800 * (i + 1)); }
  }
  return null;
}

const refresh = process.argv.includes("--refresh");
const prev = existsSync(OUT) && !refresh ? JSON.parse(readFileSync(OUT, "utf8")) : null;
const species = { ...(prev?.species ?? {}) };
const taxa = { ...(prev?.taxa ?? {}) };
let source = prev?.source ?? null;

const nodes = [
  ...JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8")).nodes,
  ...JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomyAugment.json"), "utf8")).nodes,
];
const wanted = [...new Set(nodes.filter((n) => n.rank === "species" && n.sciName).map((n) => n.sciName))]
  .filter((s) => !(s in species));
console.log(`${wanted.length} species to fetch (${Object.keys(species).length} already in the file)`);

// Species -> OTT id. The topology pull already resolved the pool; TNRS (exact only) for the rest.
const ottByName = new Map();
const topo = resolve(ROOT, "node_modules/.cache/sel-topology.json");
if (existsSync(topo)) {
  for (const [s, o] of Object.entries(JSON.parse(readFileSync(topo, "utf8")).ottByName ?? {})) ottByName.set(s, o);
}
const unresolved = wanted.filter((s) => !ottByName.has(s));
for (let i = 0; i < unresolved.length; i += 250) {
  const doc = await post("/tnrs/match_names", { names: unresolved.slice(i, i + 250), do_approximate_matching: false });
  for (const res of doc?.results ?? []) {
    const exact = (res.matches ?? []).filter((m) => !m.is_synonym && m.taxon?.unique_name && m.score === 1);
    if (exact.length === 1) ottByName.set(res.name, exact[0].taxon.ott_id);
  }
}

let done = 0, missing = 0;
const work = wanted.filter((s) => ottByName.has(s));
missing += wanted.length - work.length;
const CONC = 4;
let next = 0;
async function worker() {
  while (next < work.length) {
    const sci = work[next++];
    const r = await post("/taxonomy/taxon_info", { ott_id: ottByName.get(sci), include_lineage: true });
    if (!r?.lineage?.length) { missing++; continue; }
    source ??= r.source;
    const chain = r.lineage; // nearest first
    species[sci] = chain[0].ott_id;
    chain.forEach((t, k) => {
      taxa[t.ott_id] = [t.name, t.rank, chain[k + 1]?.ott_id ?? null];
    });
    if (++done % 250 === 0) console.log(`  ${done}/${work.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
writeFileSync(OUT, JSON.stringify({
  source,
  fetchedAt: prev && !wanted.length ? prev.fetchedAt : new Date().toISOString().slice(0, 10),
  note: "Written by scripts/pull-ott-lineages.mjs; read by scripts/patch-ott-names.mjs.",
  species: sorted(species),
  taxa: sorted(taxa),
}) + "\n");
console.log(`✓ ${done} fetched, ${missing} with no OTT match (left unclassified); wrote ${OUT}`);
