// Correct separation ranks that came from the wrong organism, in place.
//
// WHY A PATCH AND NOT A REBUILD. Same reason as patch-order-sepranks: re-running
// `npm run build:taxonomy` currently loses common names, because build-names refetches
// Wikidata and returns less than it did when taxonomy.json was last built. Changes of this
// shape go onto the file we have. Nothing here reads the network.
//
// WHAT WENT WRONG. assemble-taxonomy step 5 names an unranked clade after the Wikidata parent
// taxon (P171) of the families beneath it, then asks Open Tree for that name's RANK — as a
// bare string, in a second database. A name that means one thing to Wikidata and another to
// Open Tree therefore gets the other thing's rank, and the step's ambiguity guard does not
// help: it skips names with SEVERAL matches, and a cross-kingdom homonym returns exactly one.
//
//   Delphinoidea  The clade holding Delphinidae, Monodontidae and Phocoenidae — the dolphin
//                 superfamily. Open Tree has no cetacean by that name; its only Delphinoidea
//                 (ott 5681161, from WoRMS/GBIF/IRMNG) is a SEA SNAIL genus in Skeneidae. So
//                 a clade of three whale families was stamped `genus`, which reads as the
//                 closest possible relationship. Wikidata Q1139670: superfamily.
//
//   Ascaridida    Open Tree matched it to Ascaridomorpha, which in our tree is one of this
//                 node's own two children (the other is Oxyuridomorpha). A node cannot be the
//                 same rank as the infraorder inside it. Wikidata Q17160: order. But Open Tree
//                 puts it under Spirurina, a suborder, and an order cannot sit inside a
//                 suborder either. No rank fits between the two, so it becomes "clade" and the
//                 ruler reads Spirurina (2026-10-07, with patch-inverted-ranks).
//
// Two more, found by the 2026-10-03 taxonomy evaluation, carry the wrong value in `rank` itself
// (assemble-taxonomy step 2 labels ranks by name through Open Tree's TNRS), so here `from` is
// "no sepRank yet" and the fix overrides `rank` for separation only:
//
//   Dictyoptera   The superorder of cockroaches (Blattodea) and mantises (Mantodea), both
//                 orders beneath it. Stamped `genus`: Wikidata also has a Dictyoptera genus of
//                 insects (Q4037324). Every cockroach-mantis pair read as genus-close.
//                 Wikidata Q2087279: superorder.
//
//   Sauria        The clade of all lizards, snakes, turtles, crocodiles and birds. Stamped
//                 `order`; Wikidata also has a Sauria genus of plants (Q17487639). It has no
//                 formal rank (Q2254408: clade), so it becomes "clade" and the ruler reads the
//                 next ranked ancestor, as for any unranked node.
//
//   Acanthomorphata  The spiny-rayed fish, holding dozens of fish orders. Stamped `order` in
//                 `rank`. Most perch-like pairs meet at Percomorphaceae, which is unranked, so
//                 every walk climbed to it: Mosaic told a player guessing a pufferfish for a
//                 perch "same order". Wikidata Q337777: superorder (as Acanthomorpha). Open
//                 Tree also ranks Atherinomorphae and Cichlomorphae, inside it, as
//                 superorders; equal ranks nested read the same, so that is left alone. Fixed
//                 2026-10-07. Kinship read these pairs one step tighter than it now does, which
//                 suited how fish play; check perch-like boards on the bench before the next
//                 repin and decide whether src/core/lookalike.ts needs to make up the step.
//
// NOT FIXED HERE, deliberately: Ornithorhynchoidea, where Wikidata says superfamily and the
// shipped value is `order`. The shipped value is right and Wikidata is right — about
// different things. That node holds Tachyglossidae AND Ornithorhynchidae, so it is
// Monotremata wearing the wrong name, and `order` describes what is in it. The NAME is the
// bug there, and it is a separate one. See check-taxonomy-ranks, which knows about it.
//
// Sets `sepRank`, NEVER `rank`, for the reason patch-order-sepranks gives: Lineage's
// nearestAncestorOfRank stops at the first ancestor ranked above the one it wants, so a real
// rank here would move win targets on already-pinned days. separationTierOf reads
// `sepRank ?? rank`; nothing else looks at it.
//
// CHANGING THESE MOVES BOARDS. separationTierOf turns the MRCA's rank into Kinship's and
// Branches' closeness, so Delphinoidea goes from tier 7 (genus-close) to 5 for every pair
// whose MRCA it is. Re-pin after running this.
//
//   node scripts/patch-seprank-homonyms.mjs [--dry]

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAX = resolve(ROOT, "src/data/taxonomy.json");
const dry = process.argv.includes("--dry");

/** Each entry states what it expects to find, so a rebuild that already fixed the value (or
 *  changed it to something else again) reports rather than overwriting blind. */
const FIXES = [
  { sciName: "Delphinoidea", from: "genus", to: "superfamily", wikidata: "Q1139670" },
  { sciName: "Ascaridida", from: null, to: "clade", wikidata: "Q17160" },
  { sciName: "Dictyoptera", from: null, to: "superorder", wikidata: "Q2087279" },
  { sciName: "Sauria", from: null, to: "clade", wikidata: "Q2254408" },
  { sciName: "Acanthomorphata", from: null, to: "superorder", wikidata: "Q337777" },
];

const doc = JSON.parse(readFileSync(TAX, "utf8"));
const bySci = new Map();
for (const n of doc.nodes) if (n.sciName && !bySci.has(n.sciName)) bySci.set(n.sciName, n);

let changed = 0, already = 0, unexpected = 0;
for (const fix of FIXES) {
  const node = bySci.get(fix.sciName);
  if (!node) {
    console.log(`  MISSING  ${fix.sciName} is not in the tree`);
    unexpected++;
    continue;
  }
  const have = node.sepRank ?? null;
  if (have === fix.to) {
    console.log(`  already  ${fix.sciName} = ${fix.to}`);
    already++;
    continue;
  }
  if (have !== fix.from) {
    console.log(`  SKIPPED  ${fix.sciName} expected ${fix.from}, found ${have ?? "no sepRank"} — check before forcing`);
    unexpected++;
    continue;
  }
  node.sepRank = fix.to;
  console.log(`  fixed    ${fix.sciName}: ${fix.from} -> ${fix.to}  (wikidata ${fix.wikidata})`);
  changed++;
}

console.log(`${changed} changed, ${already} already correct, ${unexpected} needing a look`);
if (changed && !dry) {
  // Minified and newline-free, the shape patch-order-sepranks leaves it in. A reformat here
  // would be a 10,870-node diff hiding a two-field change.
  writeFileSync(TAX, JSON.stringify(doc));
  console.log(`wrote ${TAX}`);
  console.log("sepRank feeds separationTierOf: re-pin Kinship and Branches, and diff the boards.");
} else if (changed) {
  console.log("--dry: nothing written");
}
process.exit(unexpected ? 1 : 0);
