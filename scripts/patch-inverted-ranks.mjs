// Drop separation ranks that are broader than a rank above them, in place.
//
// WHAT WENT WRONG. The order stamp (patch-order-sepranks, assemble-taxonomy step 6) puts
// `order` on the smallest clade holding all of an order's species. Where an order has one
// family (hummingbirds, falcons, penguins, trogons), that clade sits INSIDE the family node,
// so every pair of hummingbirds met at an "order" below Trochilidae. Mosaic told a player who
// guessed one hummingbird for another "same order", and Kinship read those pairs as far apart.
// Family names injected by step 5 did the same under genera (Certhiidae inside Certhia).
// Both steps now refuse such a stamp; this cleans the shipped file and catches any step that
// slips later.
//
// THE RULE. A node's `sepRank` must be strictly narrower than every ranked node above it. One
// that is not describes a node that cannot be what it says, so the stamp goes and the node
// reads as unranked, the way any junction does: the walk climbs to the real rank above it.
// Equal ranks nested (an order inside an order) are left alone; they read the same either way.
//
// Only `sepRank` is touched, never `rank` (Lineage's win targets read `rank`). A node whose
// wrong rank is in `rank` itself is a homonym fix in patch-seprank-homonyms.mjs instead.
//
// CHANGING THESE MOVES BOARDS. separationTierOf reads `sepRank ?? rank`, so Kinship and
// Branches read the affected pairs differently at the next repin. Mosaic reads it at play time.
//
// Run after every step that writes `sepRank`. Idempotent.
//   node scripts/patch-inverted-ranks.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = resolve(ROOT, "src/data/taxonomy.json");
const AUG = resolve(ROOT, "src/data/taxonomyAugment.json");
const dry = process.argv.includes("--dry");

// Same order as check-taxonomy-ranks.mjs, which verifies the result.
const ORDER = [
  "domain", "kingdom", "subkingdom", "superphylum", "phylum", "subphylum", "infraphylum",
  "superclass", "class", "subclass", "infraclass", "subterclass", "cohort", "subcohort",
  "magnorder", "superorder", "order", "suborder", "infraorder", "parvorder",
  "superfamily", "family", "subfamily", "tribe", "subtribe",
  "genus", "subgenus", "species group", "species subgroup", "species", "subspecies",
];

const base = JSON.parse(readFileSync(BASE, "utf8"));
const aug = JSON.parse(readFileSync(AUG, "utf8"));
const all = [...base.nodes, ...aug.nodes];
const byId = new Map(all.map((n) => [n.id, n]));
const pos = (n) => { const i = ORDER.indexOf(n?.sepRank ?? n?.rank); return i < 0 ? null : i; };

// Repeat until stable: dropping one stamp can expose another under a node that was hiding it.
const dropped = [];
for (let changed = true; changed; ) {
  changed = false;
  for (const n of all) {
    if (!n.sepRank || n.rank === "species") continue;
    const mine = pos(n);
    if (mine == null) continue;
    for (let p = n.parentId; p; p = byId.get(p)?.parentId) {
      const up = byId.get(p);
      const theirs = pos(up);
      if (theirs != null && theirs > mine) {
        dropped.push(`${n.sciName || n.id} (${n.sepRank}) under ${up.sciName || up.id} (${up.sepRank ?? up.rank})`);
        delete n.sepRank;
        changed = true;
        break;
      }
    }
  }
}

console.log(`${dropped.length} separation ranks dropped`);
for (const d of dropped) console.log(`  ${d}`);
if (dropped.length && !dry) {
  writeFileSync(BASE, JSON.stringify(base));
  writeFileSync(AUG, JSON.stringify(aug));
} else if (dropped.length) {
  console.log("--dry: nothing written");
}
