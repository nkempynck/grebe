// Snapshot the Catalogue of Life (COL) classification of every NON-mammal species in our trees,
// for patch-col-names.mjs. COL takes each group from a named specialist database (snakes from the
// Reptile Database, fish from FishBase, Lepidoptera from the Global Lepidoptera Index, birds from
// ITIS), so it records ranks the Open Tree Taxonomy lacks: snake subfamilies, insect tribes, and
// bird families that newer checklists split out (Calcariidae for the longspurs and snow bunting).
// Mammals come from MDD instead (pull-mdd.mjs), the specialist source there.
//
// The release is pinned (DATASET) so a rerun reads the same data; bump it deliberately. A name
// COL knows only as a synonym takes the accepted name's classification; a name it cannot match
// exactly is left out, so it can block a name downstream but never earn one. Each species also
// records COL's source database, kept as provenance on any name it gives.
//
// Network, incremental: raw answers are cached in node_modules/.cache/col-raw.json.
// Writes scripts/col-ranks.json (committed), the shape of mdd-ranks.json plus `sources`.
//   node scripts/pull-col.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATASET = 316321; // COL26.9, 2026-09-11
const LABEL = "COL 26.9";
const API = "https://api.checklistbank.org";
const CACHE = resolve(ROOT, "node_modules/.cache/col-raw.json");
const RANKS = ["superorder", "order", "suborder", "infraorder", "parvorder", "superfamily", "family",
  "subfamily", "tribe", "subtribe", "genus"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  for (let i = 0; i < 5; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": "GrebeGames/1.0 (taxonomy build)" } });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(1000 * (i + 1)); }
  }
  throw new Error(`request failed: ${url}`);
}

const nodes = [
  ...JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8")).nodes,
  ...JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomyAugment.json"), "utf8")).nodes,
];
const byId = new Map(nodes.map((n) => [n.id, n]));
const isMammal = (n) => { for (let c = n; c; c = byId.get(c.parentId)) if (c.sciName === "Mammalia") return true; return false; };
const names = [...new Set(nodes.filter((n) => n.rank === "species" && !isMammal(n)).map((n) => n.sciName))].sort();

const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const todo = names.filter((s) => !(s in cache));
console.log(`${names.length} non-mammal species, ${todo.length} to look up`);

const lookup = async (sci) => {
  const j = await getJSON(`${API}/dataset/${DATASET}/match/nameusage?q=${encodeURIComponent(sci)}`);
  if (!j || !["exact", "variant"].includes(j.type) || !j.usage) return null;
  return {
    sector: j.usage.sectorKey ?? null,
    cls: (j.usage.classification ?? []).filter((c) => RANKS.includes(c.rank)).map((c) => [c.rank, c.name]),
  };
};
const CONCURRENCY = 4;
for (let i = 0; i < todo.length; i += CONCURRENCY) {
  const batch = todo.slice(i, i + CONCURRENCY);
  const res = await Promise.all(batch.map(lookup));
  batch.forEach((s, k) => (cache[s] = res[k]));
  if ((i / CONCURRENCY) % 50 === 0 || i + CONCURRENCY >= todo.length) {
    writeFileSync(CACHE, JSON.stringify(cache));
    process.stderr.write(`  ${Math.min(i + CONCURRENCY, todo.length)}/${todo.length}\r`);
  }
}
writeFileSync(CACHE, JSON.stringify(cache));
process.stderr.write("\n");

// Sector -> the specialist database it came from, for provenance.
const sectorKeys = [...new Set(Object.values(cache).filter(Boolean).map((v) => v.sector).filter((s) => s != null))].sort((a, b) => a - b);
const sources = {};
for (const s of sectorKeys) {
  const sec = await getJSON(`${API}/dataset/${DATASET}/sector/${s}`);
  const ds = sec?.subjectDatasetKey != null ? await getJSON(`${API}/dataset/${sec.subjectDatasetKey}`) : null;
  sources[s] = ds ? `${ds.alias ?? ds.title}${ds.version ? ` ${ds.version}` : ""}` : "unknown";
}

const taxa = [], taxonIdx = new Map(), species = {}, speciesSource = {};
let matched = 0;
for (const sci of names) {
  const hit = cache[sci];
  if (!hit) continue;
  matched++;
  const at = new Map(hit.cls);
  species[sci] = RANKS.map((rank) => {
    const v = at.get(rank);
    if (!v) return -1;
    const key = `${rank}:${v}`;
    if (!taxonIdx.has(key)) { taxonIdx.set(key, taxa.length); taxa.push([rank, v]); }
    return taxonIdx.get(key);
  });
  if (hit.sector != null) speciesSource[sci] = hit.sector;
}
writeFileSync(resolve(ROOT, "scripts/col-ranks.json"),
  JSON.stringify({ source: `${LABEL} (ChecklistBank dataset ${DATASET})`, ranks: RANKS, taxa, species, speciesSource, sources }));
console.log(`✓ ${LABEL}: ${matched} of ${names.length} matched, ${taxa.length} taxa, ${sectorKeys.length} source databases -> scripts/col-ranks.json`);
