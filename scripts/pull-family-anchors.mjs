// Resolve where each OUT-OF-SET family should hang in the in-set tree, so build-augment
// can graft new families (BREADTH-family, phase 3) under the right class without crossing
// a class boundary. The OTL topology we cache is an INDUCED subtree over in-set species,
// so it doesn't contain out-of-set families — we ask OTL for each family's lineage and
// walk it to the first ancestor that IS an in-set node (ott<id> in taxonomy.json).
//
//   node scripts/pull-family-anchors.mjs
//   reads: src/data/taxonomy.json, node_modules/.cache/{sel-pool,sel-classify-otl}.json
//   writes: node_modules/.cache/sel-family-anchors.json  { byFamily: { <family>: <anchorOttId> } }
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OTL = "https://api.opentreeoflife.org/v3";
const OUT = resolve(C, "sel-family-anchors.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));
const classify = JSON.parse(readFileSync(resolve(C, "sel-classify-otl.json"), "utf8")).byName;

const insetOtt = new Set();
const famInset = new Set();
const genusInset = new Set();
for (const n of tax.nodes) {
  if (/^ott\d+$/.test(n.id)) insetOtt.add(n.id);
  if (n.rank === "family" && n.sciName) famInset.add(n.sciName);
  if (n.rank === "genus" && n.sciName) genusInset.add(n.sciName);
}

// Candidate families: NOT in-set, classifiable (have an ott), with ≥4 named out-of-set
// species in new genera — a superset of what build-augment will actually keep.
const named = (s) => s.article && s.article.toLowerCase() !== s.sci.toLowerCase() && s.sci.split(/\s+/).length === 2;
const count = new Map();
for (const s of pool) {
  if (!named(s) || !s.family || famInset.has(s.family) || genusInset.has(s.genus)) continue;
  if (!classify[s.family]?.ott) continue;
  count.set(s.family, (count.get(s.family) ?? 0) + 1);
}
const families = [...count].filter(([, n]) => n >= 4).map(([name]) => ({ name, ott: classify[name].ott }));
console.log(`resolving anchors for ${families.length} out-of-set families`);

const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { byFamily: {} };

async function taxonInfo(ott, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${OTL}/taxonomy/taxon_info`, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ott_id: ott, include_lineage: true }),
      });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(1000 * (i + 1)); }
  }
  return null;
}

let done = 0, resolved = 0, unplaced = 0;
const need = families.filter((f) => cache.byFamily[f.name] === undefined);
const LIMIT = 8;
let idx = 0;
await Promise.all(Array.from({ length: Math.min(LIMIT, need.length) }, async () => {
  while (idx < need.length) {
    const f = need[idx++];
    const doc = await taxonInfo(f.ott);
    let anchor = null;
    for (const a of doc?.lineage ?? []) {
      const id = `ott${a.ott_id}`;
      if (insetOtt.has(id)) { anchor = id; break; }
    }
    cache.byFamily[f.name] = anchor; // null = couldn't place (leave out of the graft)
    anchor ? resolved++ : unplaced++;
    if (++done % 20 === 0) process.stderr.write(`  ${done}/${need.length}\r`);
  }
}));
process.stderr.write("\n");
writeFileSync(OUT, JSON.stringify(cache));
const total = Object.values(cache.byFamily).filter(Boolean).length;
console.log(`✓ anchors: +${resolved} resolved, ${unplaced} unplaced this run; ${total} placeable families cached`);
console.log(`  wrote ${OUT}`);
