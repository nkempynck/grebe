// What the other games must not give away about today's Kinship and Branches boards.
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
//
// This file is the READ half: it turns pinned rows into a guard. The RULE half is in
// boardGuardCore, which the pinner also uses, and is re-exported below so callers see one module.
import { fetchPinnedPuzzle, pinnedPuzzleCached } from "./pinnedPuzzles";
import { guardFrom, GUARD_UNKNOWN, type BoardGuard } from "./boardGuardCore";

export { guardFrom, GUARD_UNKNOWN, isGuarded, lineageIsGuarded } from "./boardGuardCore";
export type { BoardGuard } from "./boardGuardCore";

/** Today's guard, from the pin cache if it is already primed. `undefined` means "not looked up
 *  yet" and is distinct from GUARD_UNKNOWN, which means "looked and could not tell". */
export function boardGuardCached(date: string): BoardGuard | undefined {
  const k = pinnedPuzzleCached("kinship", date);
  const b = pinnedPuzzleCached("branches", date);
  if (k === undefined || b === undefined) return undefined;
  if (k === null || b === null) return GUARD_UNKNOWN;
  return guardFrom(k, b);
}

/** Fetch both boards and build the guard. Never throws; a failure is GUARD_UNKNOWN, which the
 *  game reads as "withhold the aids". */
export async function fetchBoardGuard(date: string): Promise<BoardGuard> {
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
