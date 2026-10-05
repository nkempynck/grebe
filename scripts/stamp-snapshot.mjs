// Stamp the figures the About page shows onto the base tree, so it can show them without
// loading the augment (a lazy chunk only Kinship and Branches need):
//   counts      species and nodes in the base tree (Lineage, Mosaic)
//   richCounts  species and nodes in base + augment (Kinship, Branches)
//   updatedAt   the newest of the committed source snapshots' own dates, so the stamp only
//               moves when the data does, and a rerun writes the same value
// Offline. Run last in build:taxonomy.
//   node scripts/stamp-snapshot.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = resolve(ROOT, "src/data/taxonomy.json");
const read = (p) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

const base = read("src/data/taxonomy.json");
const aug = read("src/data/taxonomyAugment.json");
const count = (nodes) => ({ nodes: nodes.length, species: nodes.filter((n) => n.rank === "species").length });

const dates = [
  read("scripts/clade-names.json").fetched,
  read("scripts/ott-lineages.json").fetchedAt,
  read("src/data/speciesPhotos.json").built,
  base.generatedAt,
].filter(Boolean).map((d) => String(d).slice(0, 10)).sort();

base.counts = count(base.nodes);
base.richCounts = count([...base.nodes, ...aug.nodes]);
base.updatedAt = dates[dates.length - 1];
writeFileSync(BASE, JSON.stringify(base));
console.log(`stamped: base ${base.counts.species} species / ${base.counts.nodes} nodes, ` +
  `rich ${base.richCounts.species} / ${base.richCounts.nodes}, updated ${base.updatedAt}`);
