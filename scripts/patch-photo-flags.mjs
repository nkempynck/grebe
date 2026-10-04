// Stamp `photo: true` on every species whose picture in src/data/speciesPhotos.json is a real
// photograph, in both trees. Kinship deals only these species, on every tier: a tile with no
// picture, or only an old plate, makes a peek worthless and a picture day unplayable.
//
// Offline and idempotent: clears every flag first. Run after pull-inat-photos.mjs.
//   node scripts/patch-photo-flags.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { looksIllustrated } from "./photo-quality.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const photos = JSON.parse(readFileSync(resolve(ROOT, "src/data/speciesPhotos.json"), "utf8")).photos;
for (const file of ["src/data/taxonomy.json", "src/data/taxonomyAugment.json"]) {
  const path = resolve(ROOT, file);
  const doc = JSON.parse(readFileSync(path, "utf8"));
  let species = 0, flagged = 0;
  for (const n of doc.nodes) {
    delete n.photo;
    if (n.rank !== "species") continue;
    species++;
    const p = photos[n.id];
    if (p && !looksIllustrated(p)) { n.photo = true; flagged++; }
  }
  writeFileSync(path, JSON.stringify(doc));
  console.log(`✓ ${file}: ${flagged} of ${species} species photographed, ${species - flagged} without`);
}
