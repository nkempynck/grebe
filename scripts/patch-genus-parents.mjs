// Re-hang augment genus nodes that were grafted onto a FAMILY when a deeper in-set node
// exists. See pull-genus-anchors.mjs for the why: the pool's finest rank is family, so a
// minted genus landed beside the subfamily that should contain it (`Ovis` as a sibling of
// `Caprinae`, so a board could show "Sheep & goats" next to a group of sheep).
//
// This patches the SHIPPED augment in place rather than rebuilding it. A rebuild against
// today's base tree drops ~39 nodes that no longer pass the name-quality test, and dropping
// nodes invalidates pins that reference them; re-parenting touches nothing but parentId, so
// no id, name or species set moves. build-augment.mjs reads the same anchor cache, so a
// future rebuild produces these parents directly and this patch becomes a no-op.
//
// Run after pull-genus-anchors.mjs.
//   node scripts/patch-genus-parents.mjs [--dry]
//   reads: src/data/taxonomy.json, node_modules/.cache/sel-genus-anchors.json
//   writes: src/data/taxonomyAugment.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = resolve(ROOT, "node_modules/.cache/sel-genus-anchors.json");
const AUG = resolve(ROOT, "src/data/taxonomyAugment.json");
const dry = process.argv.includes("--dry");

if (!existsSync(CACHE)) {
  console.error(`✗ ${CACHE} missing — run scripts/pull-genus-anchors.mjs first`);
  process.exit(1);
}
const anchors = JSON.parse(readFileSync(CACHE, "utf8")).byGenus;
const tax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const aug = JSON.parse(readFileSync(AUG, "utf8"));

const byId = new Map();
for (const n of tax.nodes) byId.set(n.id, n);
for (const n of aug.nodes) if (!byId.has(n.id)) byId.set(n.id, n);

/** Is `id` at or below `ancestorId`? Guards the move: a genus never leaves the family it
 *  was grafted into, whatever the anchor cache says. */
const isBelow = (id, ancestorId) => {
  for (let c = id; c; c = byId.get(c)?.parentId) if (c === ancestorId) return true;
  return false;
};

// Anchors are keyed genus|family (a genus name is not a key). Collapse to genus, and skip
// any name whose families disagree — an ambiguous move is not worth making.
const byGenus = new Map();
for (const [key, anchor] of Object.entries(anchors)) {
  if (!anchor) continue;
  const genus = key.slice(0, key.indexOf("|"));
  const seen = byGenus.get(genus);
  if (seen === undefined) byGenus.set(genus, anchor);
  else if (seen !== anchor) byGenus.set(genus, null); // conflicting homes → leave alone
}

const moved = [];
let skippedAmbiguous = 0, skippedUnsafe = 0;
for (const n of aug.nodes) {
  if (n.rank !== "genus" || !n.sciName) continue;
  const anchor = byGenus.get(n.sciName);
  if (anchor === undefined) continue;
  if (anchor === null) { skippedAmbiguous++; continue; }
  if (anchor === n.parentId || !byId.has(anchor)) continue;
  if (!isBelow(anchor, n.parentId)) { skippedUnsafe++; continue; }
  moved.push([n.sciName, n.parentId, anchor]);
  if (!dry) n.parentId = anchor;
}

const label = (id) => `${byId.get(id)?.sciName ?? id}[${byId.get(id)?.rank ?? "?"}]`;
for (const [genus, from, to] of moved.sort()) console.log(`  ${genus.padEnd(16)} ${label(from)} -> ${label(to)}`);
console.log(`${dry ? "would move" : "moved"} ${moved.length} genera (${skippedAmbiguous} ambiguous, ${skippedUnsafe} outside their family)`);

if (!dry) {
  aug.genusParentsPatchedAt = new Date().toISOString();
  writeFileSync(AUG, JSON.stringify(aug));
  console.log(`✓ wrote ${AUG}`);
}
