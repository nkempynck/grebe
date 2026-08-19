// Where a species is RECORDED, read from the GBIF-derived table (see scripts/build-geo.mjs).
//
// This is the one axis in Mosaic that is not a function of the tree. Every authored character
// is a clade rule, so it can only ever re-cut the taxonomy, which is why six of them together
// add under a bit beyond the class you can already see in the photograph. Geography is
// independent of all of it.
//
// IT IS NOT NATIVE RANGE. Occurrence records measure where people looked. The pharaoh ant reads
// United States / Costa Rica / Finland, which is true of where it has been logged and false of
// where it is from. Player-facing copy says "recorded in".
import raw from "./geo.json";

export type RegionScheme = "continent" | "realm";

interface GeoFile {
  $fetched: string;
  $threshold: number;
  $scope: string;
  $continents: Record<string, string>;
  $realms: Record<string, string>;
  species: Record<string, { c: string[] | null; r: string[] | null; n: number } | null>;
}

const file = raw as unknown as GeoFile;

export const GEO_FETCHED = file.$fetched;
export const GEO_SCOPE = file.$scope;

/** Code → human label, for whichever scheme is in play. Both ship inside geo.json so a code and
 *  its label cannot drift apart. */
export function regionLabels(scheme: RegionScheme): Record<string, string> {
  return scheme === "realm" ? file.$realms : file.$continents;
}

/** The regions a species is recorded in, or null when we have no usable record.
 *
 *  Null is a real third state and must stay distinct from "recorded nowhere": a species under
 *  the record floor has not told us anything, and scoring that as a mismatch would invent a
 *  fact. Same three-state honesty as the character table's n/a. */
export function regionsOf(sciName: string, scheme: RegionScheme): string[] | null {
  const e = file.species[sciName];
  if (!e) return null;
  const v = scheme === "realm" ? e.r : e.c;
  return v && v.length ? v : null;
}

export interface GeoCell {
  /** The guess's own regions, in table order. */
  mine: string[];
  /** Those the answer shares. A subset of `mine`. */
  shared: string[];
}

/** One row's geography cell: what the guess is, and how much of it the answer agrees with.
 *
 *  Overlap rather than equality, which is why this is not a `CHARACTER`. A guess recorded across
 *  Europe and Asia against an answer recorded only in Asia is neither a match nor a miss; it is
 *  half right, and the cell shows exactly which half. Null when either side is unknown. */
export function geoCell(guessSci: string, answerSci: string, scheme: RegionScheme): GeoCell | null {
  const mine = regionsOf(guessSci, scheme);
  const theirs = regionsOf(answerSci, scheme);
  if (!mine || !theirs) return null;
  const set = new Set(theirs);
  return { mine, shared: mine.filter((r) => set.has(r)) };
}

/** Coverage over a set of species, for the drift guard in the tests. A geo table keyed by
 *  scientific name goes stale the moment a taxonomy rebuild renames or replaces species, and it
 *  fails SILENTLY — every lookup simply returns null and the column quietly empties. */
export function geoCoverage(sciNames: string[], scheme: RegionScheme = "continent"): number {
  if (!sciNames.length) return 1;
  return sciNames.filter((s) => regionsOf(s, scheme)).length / sciNames.length;
}
