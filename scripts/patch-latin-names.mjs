// Strip "common names" that are really scientific binomials.
//
// Wikipedia files a fair number of species under a SYNONYM, and both name builders used to
// accept that article title as a vernacular: Camponotus saundersi shipped as "Colobopsis
// saundersi", Xylocopa aeratus as "Xylocopa aerata". A tile then shows a Latin name while
// counting as NAMED, which bypasses the Latin-tile budget in grid.ts — one per group, and
// none at all on the name-only Thursday and Friday boards. That is how a Thursday board
// came to deal two Latin tiles with no picture to go on.
//
// Clearing `common` moves them into the theme's latinPool, where the existing rules apply:
// drawn only to fill a group that would otherwise come up short, at most one per group, and
// only on days that show a picture. The species stays in the tree and keeps its topology,
// so the species set and the frozen puzzles are untouched.
//
// The builders now reject these at source (see latin-name.mjs), so this is only needed to
// fix the SHIPPED snapshot without a full rebuild. Both files are patched, because base and
// augment have the problem independently.
// Run: node scripts/patch-latin-names.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { latinBinomialTest, KEEP_ENGLISH } from "./latin-name.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const FILES = ["src/data/taxonomy.json", "src/data/taxonomyAugment.json"];
const DRY = process.argv.includes("--dry");

const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));
const isLatinName = latinBinomialTest(Array.isArray(pool) ? pool : Object.values(pool));
console.log(`kept as English by hand: ${[...KEEP_ENGLISH].join(", ")}`);

let total = 0;
for (const f of FILES) {
  const doc = JSON.parse(readFileSync(resolve(ROOT, f), "utf8"));
  const hit = doc.nodes.filter((n) => n.rank === "species" && n.common && isLatinName(n.common));
  for (const n of hit) {
    console.log(`  ${f.includes("Augment") ? "aug " : "base"} ${String(n.views ?? 0).padStart(6)}v  ${n.common.padEnd(32)} -> Latin only (${n.sciName})`);
    delete n.common;
  }
  total += hit.length;
  if (!DRY) writeFileSync(resolve(ROOT, f), JSON.stringify(doc));
}
console.log(`${DRY ? "would clear" : "cleared"} ${total} common names`);
