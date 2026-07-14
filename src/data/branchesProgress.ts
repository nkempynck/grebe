/** Today's Branches attempt, persisted so a reload restores it. The board is
 *  deterministic from the date, so we store only the player's placements + hints
 *  + status — never the board. A new day discards it. */
export interface BranchesProgress {
  date: string;
  /** slotId → the species id placed there (or absent/empty if unplaced). */
  placements: Record<string, string>;
  /** Slot ids revealed by a hint. */
  hints: string[];
  /** Species (slot) ids looked up on Wikipedia while playing. */
  peeked?: string[];
  status: "playing" | "done";
}

const KEY = "cladensis.branches.progress";

export function loadBranchesProgress(): BranchesProgress | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as BranchesProgress;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveBranchesProgress(p: BranchesProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
