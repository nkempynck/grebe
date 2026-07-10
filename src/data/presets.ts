import taxonomy from "./taxonomy.json";

/** Scope presets, validated at build time against the pulled tree (only scopes
 *  whose node actually exists are emitted into taxonomy.json). Ids are GBIF keys
 *  (e.g. "1" = Animalia, "212" = Aves); "life" is the synthetic root. */
export const SCOPE_PRESETS: Array<{ id: string; label: string }> = taxonomy.scopes;

/** The id of the default scope to open on (Animals if present, else the first). */
export const DEFAULT_SCOPE_ID =
  SCOPE_PRESETS.find((s) => /animals/i.test(s.label))?.id ?? SCOPE_PRESETS[0].id;

/** Resolution presets. winWithin is an index into the win-rank ladder in
 *  core/game.ts (0 = exact species, 1 = genus, 2 = family, 3 = order): a guess
 *  wins when it shares the answer's clade at that rank. */
export const RESOLUTION_PRESETS: Array<{ label: string; winWithin: number }> = [
  { label: "Exact species", winWithin: 0 },
  { label: "Same genus", winWithin: 1 },
  { label: "Same family", winWithin: 2 },
  { label: "Same order", winWithin: 3 },
];
