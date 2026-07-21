/** Today's Branches attempt, persisted so a reload restores it. The board is
 *  deterministic from the date, so we store only the player's placements + hints
 *  + status — never the board. A new day discards it. */
export interface BranchesProgress {
  date: string;
  /** slotId → the species id currently placed there (free arrangement). */
  placements: Record<string, string>;
  /** Slot ids confirmed correct and frozen (correct submits + hints). */
  locked?: string[];
  /** Slot ids revealed by a hint. */
  hints: string[];
  /** Species (slot) ids looked up on Wikipedia while playing. */
  peeked?: string[];
  /** Wrong placements committed so far (against the day's mistake budget). */
  mistakes?: number;
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

/** Forget today's saved Branches attempt (admin playtest reset). */
export function clearBranchesProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
