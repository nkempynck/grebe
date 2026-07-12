/** Today's grid attempt, persisted so a reload restores it. The board itself is
 *  deterministic from the date, so we only store the player's progress against it
 *  (which groups are solved, mistakes, attempt history) — never the board. A new
 *  day discards it. */
export interface GridProgress {
  date: string;
  /** Solved group indices, in the order they were solved. */
  solved: number[];
  /** Wrong guesses so far. */
  mistakes: number;
  /** Each submitted guess as its four tiles' true group levels (for the share). */
  attempts: number[][];
  status: "playing" | "won" | "lost";
}

const KEY = "cladensis.grid.progress";

export function loadGridProgress(): GridProgress | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as GridProgress;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveGridProgress(p: GridProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
