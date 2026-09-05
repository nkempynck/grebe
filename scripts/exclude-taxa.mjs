// Junk taxa (by scientific name) to keep OUT of the tree entirely.
//
// The Wikidata/GBIF pool carries a few cryptids and disputed "species" that have Wikipedia
// articles but aren't valid taxa. As tiles they read as real organisms and pad a genus into
// a fake group, so they have to go. Add a line here whenever one surfaces.
//
// Enforced at the SOURCE, in both scripts that build a species set:
//   - build-pool.mjs      base in-set pool  → src/data/taxonomy.json
//   - build-augment.mjs   out-of-set depth  → src/data/taxonomyAugment.json
// and re-checked by patch-drop-excluded.mjs, a member of the `build:taxonomy` chain, which
// starts at assemble — downstream of build-pool — so the chain alone would otherwise carry
// an excluded species forward until someone re-ran the network-heavy pull stages.
//
// The list lived only in build-augment.mjs until 2026-09-03, which is how "De Loys's ape"
// reached two consecutive Kinship boards: it arrives through the BASE pool, and that path
// never consulted the list.
export const EXCLUDE_SCI = new Set([
  "Trichechus hydropithecus", // "Steller's sea ape" — a cryptid, never a valid species
  "Trichechus pygmaeus",      // "Dwarf manatee" — disputed; widely held to be juvenile Amazonian manatees
  "Ameranthropoides loysi",   // "De Loys's ape" — named in 1929 from a single 1920 photograph;
                              // a hoax or a misidentified spider monkey. OTL places it inside
                              // Ateles, which is the misidentification.
]);
