/** Lineage scratchpad: the species and groups the player has crossed off as
 *  "can't be it". Entirely the player's own notes — the game never checks them
 *  against the answer, and they touch nothing that is scored: no leaderboard, no
 *  share text, no stats.
 *
 *  Deliberately NOT part of DailyProgress. That record feeds the daily restore and
 *  the recorded result, and a notepad has no business in it; keeping it in its own
 *  key means a malformed scratchpad can never cost someone their round.
 *
 *  Keyed by the round's hydration token (mode + date + answer), so a new day, a
 *  swapped pin or a free-play reroll all discard it without any explicit cleanup. */

const KEY = "grebe.lineage.ruledout";

interface Stored {
  token: string;
  ids: string[];
}

/** The marks belonging to `token`, or an empty list for any other round. */
export function loadRuledOut(token: string): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const s = JSON.parse(raw) as Stored;
    if (s?.token !== token || !Array.isArray(s.ids)) return [];
    return s.ids.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export function saveRuledOut(token: string, ids: string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ token, ids } satisfies Stored));
  } catch {
    /* ignore */
  }
}

/** Forget the scratchpad outright (admin playtest reset). */
export function clearStoredRuledOut(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
