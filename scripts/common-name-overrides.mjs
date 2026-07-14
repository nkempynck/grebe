// Curated common-name corrections, keyed by scientific (canonical) name.
//
// GBIF's vernacular-name feed is noisy: it sometimes hands two different species
// the SAME English name (so the autocomplete shows visual duplicates and the
// guess resolver can't disambiguate), or an outright wrong one (a snipe labelled
// "Chaga", a fungus). This map is the hand-picked truth. It's applied in two
// places from one source: build-taxonomy.mjs (so a future rebuild stays clean)
// and scripts/patch-common-names.mjs (to fix the shipped snapshot without a full
// GBIF/OTL rebuild). Add a line here whenever a bad/colliding name surfaces.
//
// Each entry resolves a collision found in the current snapshot; the comment
// notes the wrong name it replaces and (where relevant) which species rightly
// keeps the shared name.
export const COMMON_NAME_OVERRIDES = {
  // "Common kingfisher" — Alcedo atthis rightly keeps it
  "Halcyon smyrnensis": "White-throated kingfisher", // was "Common Kingfisher"

  // "Buzzard" — split the Old-World hawk from the New-World vulture
  "Buteo buteo": "Common buzzard",
  "Cathartes aura": "Turkey vulture", // was "Buzzard"

  // "Bird Cherry" — Prunus padus is the true bird cherry
  "Prunus avium": "Wild cherry", // was "Bird Cherry"

  // "Bluebell" — disambiguate the two unrelated plants
  "Hyacinthoides non-scripta": "Common bluebell",
  "Campanula rotundifolia": "Harebell", // was "Bluebell"

  // "Pond Bird" — junk GBIF vernacular on three shorebirds
  "Calidris alba": "Sanderling",
  "Arenaria interpres": "Ruddy turnstone",
  "Charadrius semipalmatus": "Semipalmated plover",

  // "Chaga" — that's the fungus (Inonotus obliquus keeps it); this is a snipe
  "Gallinago gallinago": "Common snipe",

  // "Black-headed Gull" — Chroicocephalus ridibundus rightly keeps it
  "Leucophaeus atricilla": "Laughing gull",

  // "Blue Heron" — the two American herons by size
  "Egretta caerulea": "Little blue heron",
  "Ardea herodias": "Great blue heron",

  // "Bleak" — Alburnus alburnus is the common bleak
  "Alburnoides bipunctatus": "Spirlin",

  // "Chub" — Squalius cephalus is the chub; this is a whitefish
  "Coregonus artedi": "Cisco",

  // "Mexican Tetra" — Astyanax mexicanus keeps it
  "Astyanax fasciatus": "Banded astyanax",

  // "Blue Dog" — junk vernacular on two sharks
  "Prionace glauca": "Blue shark",
  "Squalus acanthias": "Spiny dogfish",

  // "Mite" — three obscure mites share the generic name; give each its group name
  "Macrocheles merdarius": "Dung mite",
  "Oppiella nova": "Oribatid mite",
  "Atropacarus striculus": "Armoured mite",
};
