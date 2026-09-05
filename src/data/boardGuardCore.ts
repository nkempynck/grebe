// What counts as "in play in another game today", as a pure function of two decoded boards.
//
// Split out of boardGuard.ts for one reason: pinnedPuzzles.ts needs guardFrom, to keep Mosaic's
// pinned answer off the species Kinship and Branches are already using that day, and boardGuard
// reads its boards THROUGH pinnedPuzzles. Importing it back would close a cycle, and a cycle
// whose bindings resolve at module-init time is how you get an `undefined` function in one
// bundler and a working one in another.
//
// So the rule lives here, with no imports but the tree, and both sides read it from the same
// place. boardGuard.ts re-exports everything below, so nothing else has to know this file exists.
import { isAncestor } from "../core";
import type { Tree } from "../core";

export interface BoardGuard {
  /** Clade ids Mosaic must not name today. */
  hidden: ReadonlySet<string>;
  /** Species on today's other boards. Not hidden from the lookup (knowing a tile is a mammal
   *  gives no group away once the groups are veiled) but used at pin time to keep Mosaic's own
   *  answer off them. */
  species: ReadonlySet<string>;
  /** False when a board could not be read, so the caller must withhold the aids. */
  known: boolean;
}

export const GUARD_UNKNOWN: BoardGuard = { hidden: new Set(), species: new Set(), known: false };

/** Build the guard from two already-decoded boards. Pure, so pin-time tooling and the client
 *  share one definition of "in play today". */
export function guardFrom(
  kinship: { groups: { cladeId: string }[]; tiles: string[] } | null,
  branches: { groupIds: string[]; leafIds: string[]; tray: string[] } | null
): BoardGuard {
  const hidden = new Set<string>();
  const species = new Set<string>();
  for (const g of kinship?.groups ?? []) hidden.add(g.cladeId);
  for (const t of kinship?.tiles ?? []) species.add(t);
  for (const g of branches?.groupIds ?? []) hidden.add(g);
  for (const l of branches?.leafIds ?? []) species.add(l);
  for (const t of branches?.tray ?? []) species.add(t);
  return { hidden, species, known: true };
}

/** Would naming this organism or clade give away part of today's Kinship or Branches board?
 *
 *  True for a group in play, for a species on either board, and for ANY species inside a group
 *  in play — that last one is the point. Blocking only the sixteen tiles would leave the tree
 *  underneath them open, and "which clade do these two share" is Kinship's whole question; you
 *  could ask it of any two bears rather than of the two on the board.
 *
 *  FAILS OPEN, unlike Mosaic's use of the same guard. There the unknown case hides two optional
 *  panels, so refusing costs a feature; here it decides what is guessable, so refusing on an
 *  unreadable pin would block the entire tree. A small leak beats an unplayable game. */
export function isGuarded(tree: Tree, guard: BoardGuard, id: string): boolean {
  if (!guard.known) return false;
  if (guard.species.has(id) || guard.hidden.has(id)) return true;
  for (const c of guard.hidden) if (isAncestor(tree, c, id)) return true;
  return false;
}

/** The same question for an organism that is NOT in the tree yet: an out-of-set guess arrives
 *  with its own lineage, and grafting it would expose whichever board clade it hangs under. */
export function lineageIsGuarded(guard: BoardGuard, lineageIds: string[]): boolean {
  if (!guard.known) return false;
  return lineageIds.some((id) => guard.hidden.has(id) || guard.species.has(id));
}
