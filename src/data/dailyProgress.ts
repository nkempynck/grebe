import type { GameStatus, GraftTaxon } from "../core";

/** Today's daily attempt, persisted so a reload restores it — signed-out players
 *  on the same device stay locked to one attempt. (Signed-in players restore from
 *  the cloud, which also works across devices.) Keyed to a single date + answer;
 *  a new day or a changed pinned answer discards it. */
export interface DailyProgress {
  date: string;
  answerId: string;
  guessIds: string[]; // newest-first, matching in-memory order
  hintIds: string[];
  status: GameStatus;
  /** Graft payloads for any out-of-set guesses, so a reload can re-graft them onto
   *  the (baked) tree before restoring — their ids aren't in taxonomy.json. */
  grafts?: GraftTaxon[];
}

const KEY = "cladensis.daily.progress";

export function loadDailyProgress(): DailyProgress | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as DailyProgress;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveDailyProgress(p: DailyProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

/** Forget this device's saved Lineage daily attempt (admin playtest reset). */
export function clearDailyProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
