// Name unnamed mammal clades from the Mammal Diversity Database (scripts/mdd-ranks.json, from
// pull-mdd.mjs). The Open Tree Taxonomy stops at family for much of Mammalia; MDD records
// subfamily, tribe and subtribe (Globicephalinae, Vulpini, Papionini, Ursinae). The rule and what
// is written are in checklist-names.mjs. Runs after patch-ott-names, so a junction both could
// name keeps the Open Tree name.
//   node scripts/patch-mdd-names.mjs [--dry]
import { applyChecklistNames } from "./checklist-names.mjs";

const isMammal = (n, byId) => {
  for (let c = n; c; c = byId.get(c.parentId)) if (c.sciName === "Mammalia" && c.rank !== "species") return true;
  return false;
};
applyChecklistNames({ snapshot: "mdd-ranks.json", field: "mddTaxon", inScope: isMammal, dry: process.argv.includes("--dry") });
