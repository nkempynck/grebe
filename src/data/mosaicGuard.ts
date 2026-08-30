// What Mosaic must not give away about the other two games today.
//
// Mosaic runs on the same tree as Kinship and Branches, and its two aids answer their questions
// exactly: the lookup is species -> its clades, which is Kinship's whole question, and the drill
// is clade -> its species, which is Branches'. Measured over real boards, 49% of Kinship's groups
// had their answer clade printed in the chain of every one of their members. Sixteen tiles typed
// in, four groups read off.
//
// So Mosaic reads the other two games' PINNED boards for the day and refuses to name the clades
// in play. Only those; nothing is hidden on general principle, which is what an earlier
// clade-size rule got wrong — it hid the answer's own narrow clade (the most useful scope on the
// board) while the drill handed the groups over anyway.
//
// FAILS CLOSED. If the pins cannot be read, the guard reports `unknown` and the game hides the
// lookup and drill entirely rather than showing them unprotected. An empty hidden set and a
// failed fetch are the same value in the wrong design, and the difference matters: one means
// "nothing to hide today", the other means "we do not know what to hide".
import { fetchPinnedPuzzle, pinnedPuzzleCached } from "./pinnedPuzzles";

export interface MosaicGuard {
  /** Clade ids Mosaic must not name today. */
  hidden: ReadonlySet<string>;
  /** Species on today's other boards. Not hidden from the lookup (knowing a tile is a mammal
   *  gives no group away once the groups are veiled) but used at pin time to keep Mosaic's own
   *  answer off them. */
  species: ReadonlySet<string>;
  /** False when a board could not be read, so the caller must withhold the aids. */
  known: boolean;
}

export const GUARD_UNKNOWN: MosaicGuard = { hidden: new Set(), species: new Set(), known: false };

/** Build the guard from two already-decoded boards. Pure, so pin-time tooling and the client
 *  share one definition of "in play today". */
export function guardFrom(
  kinship: { groups: { cladeId: string }[]; tiles: string[] } | null,
  branches: { groupIds: string[]; leafIds: string[]; tray: string[] } | null
): MosaicGuard {
  const hidden = new Set<string>();
  const species = new Set<string>();
  for (const g of kinship?.groups ?? []) hidden.add(g.cladeId);
  for (const t of kinship?.tiles ?? []) species.add(t);
  for (const g of branches?.groupIds ?? []) hidden.add(g);
  for (const l of branches?.leafIds ?? []) species.add(l);
  for (const t of branches?.tray ?? []) species.add(t);
  return { hidden, species, known: true };
}

/** Today's guard, from the pin cache if it is already primed. `undefined` means "not looked up
 *  yet" and is distinct from GUARD_UNKNOWN, which means "looked and could not tell". */
export function mosaicGuardCached(date: string): MosaicGuard | undefined {
  const k = pinnedPuzzleCached("kinship", date);
  const b = pinnedPuzzleCached("branches", date);
  if (k === undefined || b === undefined) return undefined;
  if (k === null || b === null) return GUARD_UNKNOWN;
  return guardFrom(k, b);
}

/** Fetch both boards and build the guard. Never throws; a failure is GUARD_UNKNOWN, which the
 *  game reads as "withhold the aids". */
export async function fetchMosaicGuard(date: string): Promise<MosaicGuard> {
  try {
    const [k, b] = await Promise.all([
      fetchPinnedPuzzle("kinship", date),
      fetchPinnedPuzzle("branches", date),
    ]);
    if (!k || !b) return GUARD_UNKNOWN;
    return guardFrom(k, b);
  } catch {
    return GUARD_UNKNOWN;
  }
}
