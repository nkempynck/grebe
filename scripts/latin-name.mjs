// Is a "common name" actually a scientific binomial?
//
// Both name builders take the English Wikipedia article title as a species' common name,
// rejecting it only when it EQUALS our own scientific name. That misses the case that
// matters: when Wikipedia files a species under a SYNONYM, the title is a different
// binomial and sails through as a vernacular. Camponotus saundersi came out labelled
// "Colobopsis saundersi", Xylocopa aeratus as "Xylocopa aerata". Those tiles then count as
// NAMED, so the Latin-tile budget in grid.ts (one per group, and none at all on the
// name-only Thursday and Friday boards) never applies to them and a Thursday board deals
// two Latin tiles with no picture to go on.
//
// No regex can decide this. "Gila monster", "Venus flytrap", "Luna moth", "Harpy eagle",
// "Komodo dragon" and "Polar bear" are all English names whose first word is rare or
// Latin-looking, and word-frequency heuristics flag every one of them. What does work is a
// LOOKUP against the build's own species pool (~18k species, ~7.8k genera, ~10.7k
// epithets): a name is Latin when its first word is a real genus AND its second word is a
// real species epithet. Both halves are needed — "Gila" is a fish genus, so the genus test
// alone rejects the Gila monster.
//
// Still not infallible, which is why KEEP_ENGLISH exists: a two-word English name can hit
// both halves by coincidence. Two do, out of 53 flagged across the shipped trees.

/** English names that pass the genus+epithet test by accident. Verified by hand; add to
 *  this rather than weakening the test, which is what makes the test worth having.
 *    Virginia opossum — Virginia is a snake genus, opossum an epithet (Philander opossum)
 *    Rhinoceros iguana — Rhinoceros is a genus, iguana an epithet */
export const KEEP_ENGLISH = new Set(["Virginia opossum", "Rhinoceros iguana"]);

/** Build the test from a species pool: objects carrying `genus` and a binomial `sci`.
 *  Returns (name) => true when that name is a scientific binomial rather than English. */
export function latinBinomialTest(poolSpecies) {
  const genera = new Set();
  const epithets = new Set();
  for (const s of poolSpecies) {
    if (s.genus) genera.add(s.genus);
    const ep = (s.sci ?? "").split(/\s+/)[1];
    if (ep) epithets.add(ep);
  }
  return (name) => {
    const n = (name ?? "").trim();
    if (!n || KEEP_ENGLISH.has(n)) return false;
    const parts = n.split(/\s+/);
    return parts.length === 2 && genera.has(parts[0]) && epithets.has(parts[1]);
  };
}
