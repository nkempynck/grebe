// Snapshot the Mammal Diversity Database (MDD) classification for patch-mdd-names.mjs.
//
// MDD is the expert-curated, versioned checklist of the world's mammals (American Society of
// Mammalogists). Unlike the Open Tree Taxonomy it records the ranks between family and genus
// (subfamily, tribe, subtribe), which is where most of our unnamed mammal junctions sit:
// Globicephalinae, Vulpini, Papionini, Ursinae. The release is pinned by commit so a rerun reads
// the same data; bump COMMIT (and the label) deliberately to move to a new release.
//
// Writes scripts/mdd-ranks.json, committed: { source, ranks, taxa: [[rank, name]], species:
// { "Genus species": [taxon index per rank, -1 when the rank is empty] } }, every MDD species,
// so membership counts never depend on which species we happen to ship.
//   node scripts/pull-mdd.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COMMIT = "2ce3d6ca42f5c94359e301f5eae671f3a13cd471";
const LABEL = "MDD v2.5";
const URL = `https://raw.githubusercontent.com/mammaldiversity/mammaldiversity.github.io/${COMMIT}/assets/data/mdd.csv`;
const RANKS = ["suborder", "infraorder", "parvorder", "superfamily", "family", "subfamily", "tribe", "subtribe", "genus"];

const parse = (txt) => {
  const rows = [];
  let row = [], f = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) {
      if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
};

const r = await fetch(URL);
if (!r.ok) throw new Error(`MDD fetch failed: ${r.status}`);
const [hdr, ...data] = parse(await r.text());
const col = Object.fromEntries(hdr.map((h, i) => [h, i]));
for (const k of ["sciName", ...RANKS]) if (!(k in col)) throw new Error(`MDD has no column ${k}`);
// MDD writes ranks above genus in capitals ("DELPHINIDAE"); taxon names are capitalised words.
const cap = (s) => s[0] + s.slice(1).toLowerCase();
const taxa = [], taxonIdx = new Map(), species = {};
for (const row of data) {
  const sci = row[col.sciName]?.replace(/_/g, " ").trim();
  if (!sci) continue;
  species[sci] = RANKS.map((rank) => {
    const v = row[col[rank]]?.trim();
    if (!v || v === "NA") return -1;
    const key = `${rank}:${cap(v)}`;
    if (!taxonIdx.has(key)) { taxonIdx.set(key, taxa.length); taxa.push([rank, cap(v)]); }
    return taxonIdx.get(key);
  });
}
const sorted = Object.fromEntries(Object.entries(species).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(resolve(ROOT, "scripts/mdd-ranks.json"), JSON.stringify({ source: `${LABEL} (${COMMIT.slice(0, 7)})`, ranks: RANKS, taxa, species: sorted }));
console.log(`✓ ${LABEL}: ${Object.keys(sorted).length} species, ${taxa.length} taxa -> scripts/mdd-ranks.json`);
