import type { Tree } from "./types";
import { leavesUnder } from "./tree";

/** Small deterministic string hash (xmur3) -> 32-bit seed. */
function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** YYYY-MM-DD in local time. */
export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Day #1 of the daily series. Set this to the public launch date — it only
 *  shifts the displayed puzzle number, never which puzzle a date resolves to. */
export const DAILY_EPOCH = "2026-07-09";

/** The daily's sequence number (#1, #2, …) for a date — days since DAILY_EPOCH,
 *  1-based, computed in UTC so it flips at the same instant everywhere. */
export function dailyNumber(dateKey = todayKey()): number {
  const day = Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000);
  const epoch = Math.floor(Date.parse(`${DAILY_EPOCH}T00:00:00Z`) / 86_400_000);
  return day - epoch + 1;
}

/**
 * Pick the daily answer deterministically from the leaves under `scopeRootId`.
 *
 * DESIGN NOTE: the seed includes the scope, so each scope has its own daily
 * puzzle. That means a shared, everyone-solves-the-same-thing leaderboard only
 * works if you fix the scope. With user-defined scope you get a *personal*
 * daily instead. Swap `seedKey` to just `dateKey` if you later lock the scope.
 */
export function dailyAnswerId(
  tree: Tree,
  scopeRootId: string,
  dateKey = todayKey()
): string {
  const leaves = leavesUnder(tree, scopeRootId);
  if (leaves.length === 0) throw new Error(`No leaves under scope ${scopeRootId}`);
  const seed = xmur3(`${dateKey}::${scopeRootId}`);
  return leaves[seed % leaves.length];
}

/** A random leaf under scope — handy for a "practice" / dev button. */
export function randomAnswerId(tree: Tree, scopeRootId: string): string {
  const leaves = leavesUnder(tree, scopeRootId);
  return leaves[Math.floor(Math.random() * leaves.length)];
}
