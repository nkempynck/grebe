// Resolve where each NEW genus should hang in the in-set tree, so build-augment can graft
// it under its real subfamily instead of dumping it on the family node (BREADTH-genus,
// phase 2). The pool carries a GBIF family and nothing finer, so a minted genus used to
// land as a SIBLING of the subfamily that contains it: `Ovis` beside `Caprinae` rather
// than inside it, which put sheep outside the group labelled "Sheep & goats" and made a
// sheep no closer to a goat than to a gazelle. We ask OTL for each genus's lineage and
// walk it to the first ancestor that IS an in-set node (ott<id> in taxonomy.json).
//
// Same job as pull-family-anchors.mjs, one rank down, with one extra guard: a genus name
// is not a key (Prunella is a bird and a mint), so a resolved anchor is only kept when the
// genus's OTL lineage actually passes through the family we meant. Anything unresolved or
// unvalidated stays null and build-augment falls back to the family node as before.
//
//   node scripts/pull-genus-anchors.mjs [--refresh]
//   reads: src/data/taxonomy.json, node_modules/.cache/{sel-pool,sel-classify-otl}.json
//   writes: node_modules/.cache/sel-genus-anchors.json
//           { byGenus: { "<genus>|<family>": <anchorOttId|null> } }
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { latinBinomialTest } from "./latin-name.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OTL = "https://api.opentreeoflife.org/v3";
const OUT = resolve(C, "sel-genus-anchors.json");
const refresh = process.argv.includes("--refresh");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));

// ---- the in-set tree we graft onto ----
const insetOtt = new Set();
const famOttBySci = new Map(); // in-set family name -> its ott number
const genusInsetSci = new Set(); // genus NODES the base tree already has
const insetSpeciesGenus = new Set(); // genus names the base tree holds species of
for (const n of tax.nodes) {
  if (/^ott\d+$/.test(n.id)) insetOtt.add(n.id);
  if (!n.sciName) continue;
  if (n.rank === "family" && /^ott(\d+)$/.test(n.id)) famOttBySci.set(n.sciName, Number(n.id.slice(3)));
  if (n.rank === "genus") genusInsetSci.add(n.sciName);
  if (n.rank === "species") insetSpeciesGenus.add(n.sciName.split(/\s+/)[0]);
}

// ---- candidates: genera build-augment would MINT (phase 2) ----
// A superset of what it actually keeps, exactly like pull-family-anchors: cheap to resolve
// a few extra, and the build is free to ignore any key it doesn't need.
const isLatinName = latinBinomialTest(pool);
const named = (s) =>
  s.article &&
  s.article.toLowerCase() !== s.sci.toLowerCase() &&
  !isLatinName(s.article) &&
  s.sci.split(/\s+/).length === 2;

const cand = new Map(); // "genus|family" -> { genus, family, famOtt }
for (const s of pool) {
  if (!named(s) || !s.genus || !s.family) continue;
  if (genusInsetSci.has(s.genus) || insetSpeciesGenus.has(s.genus)) continue; // depth graft, not a new genus
  const famOtt = famOttBySci.get(s.family);
  if (!famOtt) continue; // no in-set family node → phase 3 (a whole new family), not our job
  const key = `${s.genus}|${s.family}`;
  if (!cand.has(key)) cand.set(key, { genus: s.genus, family: s.family, famOtt });
}
console.log(`resolving anchors for ${cand.size} candidate new genera`);

const cache = existsSync(OUT) && !refresh ? JSON.parse(readFileSync(OUT, "utf8")) : { byGenus: {} };
const need = [...cand.entries()].filter(([k]) => cache.byGenus[k] === undefined);
if (!need.length) {
  console.log("  nothing new to resolve");
  writeFileSync(OUT, JSON.stringify(cache));
  process.exit(0);
}

async function post(path, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${OTL}/${path}`, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(1000 * (i + 1)); }
  }
  return null;
}

// 1) name -> candidate ott ids. Exact matching only: an approximate match on a genus name
//    is a different genus, and a wrong graft is worse than no graft.
const ottsByName = new Map();
const names = [...new Set(need.map(([, c]) => c.genus))];
const BATCH = 100;
for (let i = 0; i < names.length; i += BATCH) {
  const doc = await post("tnrs/match_names", { names: names.slice(i, i + BATCH), do_approximate_matching: false });
  for (const r of doc?.results ?? []) {
    const ids = r.matches.filter((m) => m.taxon?.rank === "genus").map((m) => m.taxon.ott_id);
    if (ids.length) ottsByName.set(r.name, ids);
  }
  process.stderr.write(`  matched ${Math.min(i + BATCH, names.length)}/${names.length}\r`);
}
process.stderr.write("\n");

// 2) lineage per candidate ott, cached across the homonyms that share it.
const lineageCache = new Map();
async function lineageOf(ott) {
  if (lineageCache.has(ott)) return lineageCache.get(ott);
  const doc = await post("taxonomy/taxon_info", { ott_id: ott, include_lineage: true });
  const lin = doc?.lineage ?? null;
  lineageCache.set(ott, lin);
  return lin;
}

let done = 0, deeper = 0, atFamily = 0, unresolved = 0;
const LIMIT = 8;
let idx = 0;
await Promise.all(Array.from({ length: Math.min(LIMIT, need.length) }, async () => {
  while (idx < need.length) {
    const [key, c] = need[idx++];
    let anchor = null;
    for (const ott of ottsByName.get(c.genus) ?? []) {
      const lin = await lineageOf(ott);
      // Homonym guard: this ott is only OUR genus if its lineage runs through the family
      // the pool assigned the species to.
      if (!lin?.some((a) => a.ott_id === c.famOtt)) continue;
      for (const a of lin) {
        if (a.ott_id === c.famOtt) break; // reached the family = nothing deeper is in-set
        if (insetOtt.has(`ott${a.ott_id}`)) { anchor = `ott${a.ott_id}`; break; }
      }
      break; // validated match found; a second homonym can't also pass the family test
    }
    cache.byGenus[key] = anchor; // null = no deeper in-set home than the family node
    if (anchor) deeper++;
    else if (ottsByName.has(c.genus)) atFamily++;
    else unresolved++;
    if (++done % 20 === 0) process.stderr.write(`  ${done}/${need.length}\r`);
  }
}));
process.stderr.write("\n");
writeFileSync(OUT, JSON.stringify(cache));
console.log(`✓ ${deeper} genera anchored below their family, ${atFamily} already at the family, ${unresolved} unmatched`);
console.log(`  wrote ${OUT}`);
