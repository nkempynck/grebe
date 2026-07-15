// Bake a familiarity signal onto the EXISTING taxonomy.json — NO rebuild.
//
// Like patch-common-names.mjs, this opens the shipped snapshot and edits it in
// place: it does NOT re-query Open Tree, re-select species, or touch topology. It
// only adds two per-species fields:
//   occ  — GBIF occurrence count (how often the species is recorded; a proxy for
//          how familiar it is). Lineage weights the daily answer by a within-order
//          percentile of this, scaled by difficulty, so easy days lean recognisable.
//   icon — true if the species is one of the curated EXTRAS (lion, whale, panda…),
//          floored to top prominence so icons surface on easy/medium days.
//
// Run:  node scripts/patch-prominence.mjs   (idempotent; a few minutes of GBIF calls)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "data", "taxonomy.json");
const BUILD = join(HERE, "build-taxonomy.mjs");
const GBIF = "https://api.gbif.org/v1";

// ---- tiny fetch helpers (self-contained; no build import) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      const text = await res.text();
      if (res.ok) return text ? JSON.parse(text) : null;
      if (res.status === 429 || res.status >= 500) { await sleep(500 * (i + 1)); continue; }
      return null;
    } catch { await sleep(500 * (i + 1)); }
  }
  return null;
}
async function mapLimit(items, limit, fn) {
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; await fn(items[i], i); }
  }));
}

// ---- curated icon names: read EXTRAS out of build-taxonomy.mjs as TEXT ----
// (no import → the build never runs; we only want the scientific names.) Only the
// genuinely ICONIC entries count — we stop at the "Within-clade depth…" marker so
// the Kinship board-filler species (fin whale, bobcat, bush dog, gadwall…) are NOT
// treated as icons; they still surface by occurrence on medium/hard days.
function iconNames() {
  const src = readFileSync(BUILD, "utf8");
  const start = src.indexOf("const EXTRAS = [");
  const depth = src.indexOf("Within-clade depth for harder Kinship", start);
  const end = depth > start ? depth : src.indexOf("\n];", start);
  const block = start >= 0 && end > start ? src.slice(start, end) : "";
  const set = new Set();
  for (const m of block.matchAll(/name:\s*"([^"]+)"/g)) set.add(m[1]);
  return set;
}

async function main() {
  const data = JSON.parse(readFileSync(OUT, "utf8"));
  const species = data.nodes.filter((n) => n.rank === "species");
  const icons = iconNames();
  console.log(`→ patching ${species.length} species (${icons.size} curated icon names)…`);

  // Re-flag icons from the (narrowed) set every run; only fetch occ when missing,
  // so re-running to adjust icons is instant instead of re-querying GBIF.
  for (const n of species) { delete n.icon; if (icons.has(n.sciName)) n.icon = true; }
  const iconHits = species.filter((n) => n.icon).length;
  const todo = species.filter((n) => n.occ == null);
  let done = 0;
  await mapLimit(todo, 8, async (n) => {
    const c = await getJSON(`${GBIF}/occurrence/count?taxonKey=${n.id}`);
    n.occ = typeof c === "number" && Number.isFinite(c) ? c : 0;
    if (++done % 250 === 0) console.log(`   ${done}/${todo.length}`);
  });
  const withOcc = species.filter((n) => (n.occ ?? 0) > 0).length;

  writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(`✓ patched ${OUT}`);
  console.log(`  occ set on ${withOcc}/${species.length} species; ${iconHits} icons flagged`);
  console.log(`  (topology & species set unchanged — only occ/icon fields added)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
