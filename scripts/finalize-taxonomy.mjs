// STEP 5-6: write the final in-set taxonomy.json from the named nodes.
//   - node schema matches the current file (id, sciName, common?, rank, parentId) with
//     species carrying `views` (replaces the old `occ` prominence signal)
//   - provenance: generatedAt + OTL synthetic-tree release + Wikidata snapshot date +
//     a source string + counts (reproducibility stamp for the frozen dailies). No GBIF
//     version — GBIF isn't a structural source anymore (ids came via Wikidata P846).
// Backs up the current file first. Run: node scripts/finalize-taxonomy.mjs
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OUT = resolve(ROOT, "src/data/taxonomy.json");

// OTL synthetic-tree release, for the reproducibility pin
let otlRelease = "unknown", otlDate = "unknown";
try {
  const about = await fetch("https://api.opentreeoflife.org/v3/tree_of_life/about", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.json());
  otlRelease = about.synth_id ?? about.tree_id ?? "unknown";
  otlDate = about.date_created ?? about.date ?? "unknown";
} catch { /* keep unknown */ }

const nodes = JSON.parse(readFileSync(resolve(C, "sel-nodes-named.json"), "utf8"));
// clean node objects: drop undefined common, keep views on species only
const list = nodes.map((n) => {
  const o = { id: n.id, sciName: n.sciName, rank: n.rank, parentId: n.parentId };
  if (n.common) o.common = n.common;
  if (n.rank === "species" && n.views != null) o.views = n.views;
  return o;
});
const species = list.filter((n) => n.rank === "species").length;

// scope presets (play-within-this-group filters) — emit only clades that exist in the
// new tree, by scientific name. Fungi dropped (out of scope now).
// Group scopes — also the keys for per-group leaderboards/stats/badges. Each entry
// lists fallback scientific names; the first present in the tree is used. Fungi dropped.
const SCOPE_CANDIDATES = [
  { sci: ["Metazoa"], label: "Animals" }, { sci: ["Chordata"], label: "Chordates" },
  { sci: ["Mammalia"], label: "Mammals" }, { sci: ["Aves"], label: "Birds" },
  { sci: ["Actinopterygii"], label: "Fish" }, { sci: ["Amphibia"], label: "Amphibians" },
  { sci: ["Squamata"], label: "Reptiles" }, { sci: ["Insecta"], label: "Insects" },
  { sci: ["Arthropoda"], label: "Arthropods" },
  { sci: ["Chloroplastida", "Viridiplantae", "Tracheophyta"], label: "Plants" },
];
const byName = new Map();
for (const n of list) if (n.sciName && !byName.has(n.sciName)) byName.set(n.sciName, n.id);
const scopes = [{ id: "life", label: "All life" }];
for (const c of SCOPE_CANDIDATES) { const hit = c.sci.find((s) => byName.has(s)); if (hit) scopes.push({ id: byName.get(hit), label: c.label }); }

if (existsSync(OUT)) copyFileSync(OUT, OUT + ".bak");

const out = {
  generatedAt: new Date().toISOString(),
  source: "Wikidata + Wikipedia (species selection by pageviews, names) × Open Tree of Life (topology)",
  provenance: {
    otlSynthRelease: otlRelease,
    otlReleaseDate: otlDate,
    wikidataSnapshot: new Date().toISOString().slice(0, 10),
    pageviewWindow: "~60 days ending " + new Date().toISOString().slice(0, 10),
  },
  counts: { nodes: list.length, species },
  scopes,
  nodes: list,
};
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`✓ wrote ${OUT}`);
console.log(`  ${list.length} nodes, ${species} species`);
console.log(`  provenance: OTL ${otlRelease} (${otlDate}), Wikidata ${out.provenance.wikidataSnapshot}`);
console.log(`  ↩ backup: ${OUT}.bak`);
