// Whether an iNaturalist photo record is an old illustration rather than a photograph: public
// domain, credited with a year before 1950, or credited to a scanned-plate source. Shared by
// pull-inat-photos.mjs (field photos go ahead of plates) and patch-photo-flags.mjs (a species
// whose best picture is a plate does not count as photographed).
export const looksIllustrated = (p) =>
  p.l === "pd" ||
  /\b(1[5-8]\d\d|19[0-4]\d)\b/.test(p.by ?? "") ||
  /biodiversity heritage library|\bplate\b|lithograph|illustrat/i.test(p.by ?? "");
