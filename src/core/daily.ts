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

/** The active puzzle date (YYYY-MM-DD). The daily rolls over at 09:00
 *  Europe/Brussels — a single GLOBAL instant for everyone (DST-aware, so it stays
 *  9am local year-round), mirroring LinkedIn/Ponder (midnight Pacific ≈ 09:00
 *  CET). It is deliberately NOT per-user local time; every player flips at the
 *  same moment, which keeps the shared board and its earliest-first tie-break
 *  fair. MUST stay in lockstep with public.grebe_today() in supabase/schema.sql. */
export const RESET_TZ = "Europe/Brussels";
export const RESET_HOUR = 9; // local hour in RESET_TZ at which the puzzle flips
export function todayKey(d = new Date()): string {
  // Read the wall-clock in the reset zone (DST included), then step back the
  // reset hour so the calendar date only advances once it's past 09:00 there.
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: RESET_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => Number(p.find((x) => x.type === t)!.value);
  const wall = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return new Date(wall - RESET_HOUR * 3_600_000).toISOString().slice(0, 10);
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
/** Pick a leaf from a PRECOMPUTED leaf list. Split out so the anti-repeat layer
 *  can cache `leavesUnder` once and replay many days cheaply. */
export function dailyAnswerFromLeaves(
  leaves: string[],
  dateKey: string,
  scopeRootId: string,
  /** Re-roll index. 0 is the canonical pick; the anti-repeat layer bumps this to
   *  draw an alternative when the canonical pick was used too recently. */
  attempt = 0
): string {
  if (leaves.length === 0) throw new Error(`No leaves under scope ${scopeRootId}`);
  // attempt 0 keeps the original seed key, so it stays a stable canonical pick.
  const seedKey = attempt === 0 ? `${dateKey}::${scopeRootId}` : `${dateKey}::${scopeRootId}::${attempt}`;
  return leaves[xmur3(seedKey) % leaves.length];
}

export function dailyAnswerId(
  tree: Tree,
  scopeRootId: string,
  dateKey = todayKey(),
  attempt = 0
): string {
  return dailyAnswerFromLeaves(leavesUnder(tree, scopeRootId), dateKey, scopeRootId, attempt);
}

/** A random leaf under scope — handy for a "practice" / dev button. */
export function randomAnswerId(tree: Tree, scopeRootId: string): string {
  const leaves = leavesUnder(tree, scopeRootId);
  return leaves[Math.floor(Math.random() * leaves.length)];
}
