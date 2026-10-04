// Name unnamed non-mammal clades from the Catalogue of Life (scripts/col-ranks.json, from
// pull-col.mjs): snake and turtle subfamilies from the Reptile Database, insect tribes from the
// Lepidoptera Index and other catalogues, bird families newer checklists split out. The rule and
// what is written are in checklist-names.mjs; each name also records which specialist database
// COL took it from. Runs after patch-ott-names and patch-mdd-names, so an earlier name is kept.
//   node scripts/patch-col-names.mjs [--dry]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { applyChecklistNames } from "./checklist-names.mjs";

const col = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "col-ranks.json"), "utf8"));
const isMammal = (n, byId) => {
  for (let c = n; c; c = byId.get(c.parentId)) if (c.sciName === "Mammalia" && c.rank !== "species") return true;
  return false;
};
applyChecklistNames({
  snapshot: "col-ranks.json",
  field: "colTaxon",
  inScope: (n, byId) => !isMammal(n, byId),
  provenance: (sci) => col.sources[col.speciesSource[sci]],
  dry: process.argv.includes("--dry"),
});
