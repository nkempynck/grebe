import type { GameRow } from "./games";

/** A finished daily's leaderboard submit that was made while SIGNED OUT (so it
 *  never reached the server). We stash the exact RPC payload — captured at finish,
 *  no reconstruction — and replay it the moment the player signs in, so a first-time
 *  player who plays before making an account still lands on the boards. The submit
 *  RPCs are idempotent (daily-once unique index) and reject future dates, so a
 *  replay is always safe. Personal stats/streaks carry over separately, via the
 *  stats cloud-seed on first sign-in. */
export type PendingSubmit =
  | { game: "lineage"; args: GameRow }
  | { game: "kinship"; args: { puzzleDate: string; won: boolean; mistakes: number; reveals: number } }
  | { game: "branches"; args: { puzzleDate: string; won: boolean; correct: number; total: number; hinted: number; peeked: number } };

const KEY = "cladensis.pendingSubmits";

export function loadPendingSubmits(): PendingSubmit[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as PendingSubmit[];
  } catch {
    /* ignore */
  }
  return [];
}

/** Queue a signed-out finish, replacing any existing entry for the same game+date
 *  (a daily is played at most once, and a reload restores it locked without
 *  re-finishing, so this mostly guards against odd states). */
export function enqueuePendingSubmit(p: PendingSubmit): void {
  const list = loadPendingSubmits().filter((x) => !(x.game === p.game && x.args.puzzleDate === p.args.puzzleDate));
  list.push(p);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

export function clearPendingSubmits(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
