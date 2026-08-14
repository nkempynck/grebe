/** Load-time common-name corrections for SPECIES, the counterpart to CLADE_COMMON.
 *  Keyed by scientific name, applied in loadTaxonomy's build(). Empty by design: this
 *  is the route, not a backlog.
 *
 *  Why it exists separately from scripts/common-name-overrides.mjs: that map is a
 *  BUILD-time fix. build-names.mjs applies it and bakes the result into taxonomy.json,
 *  so it only ever reaches the base snapshot. The Kinship/Branches augment
 *  (taxonomyAugment.json) comes from build-augment.mjs, which never consults it, so an
 *  augment species with a bad vernacular had no way to be corrected at all. build() in
 *  loadTaxonomy is the one layer both trees pass through, which is why the fix sits here.
 *
 *  Roughly 20 species across the two trees carry a bare Latin name in the common-name
 *  slot where no English speaker uses it ("Blicca", "Elopichthys", "Chytolita"). Note
 *  that many more look like that and are correct: Ginkgo, Hippopotamus, Caracal, Dugong,
 *  Vanilla and Anhinga really are the English names, so a blanket "common must not equal
 *  a Latin name" rule would do damage. Judge them one at a time, or replace the lot from
 *  Wikidata's English labels in a single pass.
 *
 *  Prefer the build-time map for base-tree species: it keeps the shipped JSON honest for
 *  anything reading it directly. Use this one for augment species, or when a fix is
 *  needed without regenerating. Unknown keys are harmless no-ops.
 *
 *  Not to be confused with speciesNames.ts, which is the random display-name generator. */
export const SPECIES_COMMON: Record<string, string> = {
  // Rheum undulatum is a synonym of Rheum rhabarbarum: the same plant, sitting in the
  // augment a second time, and GBIF handed it the bare binomial as its "common" name.
  // Calling it Rhubarb fixes the junk label and, because the base tree's Rheum
  // rhabarbarum is also "Rhubarb", additionally trips pickMembers' identical-name guard.
  // That guard is per GROUP, which is enough here: both sit in genus Rheum and a board's
  // groups are disjoint, so the pair can only ever meet inside one group. It matters
  // because tile pictures are fetched live from Wikipedia by scientific name and
  // Wikipedia follows redirects, so a synonym pair resolves to a single article and the
  // two tiles would show the same photo.
  "Rheum undulatum": "Rhubarb",
};
