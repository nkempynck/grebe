import { supabase } from "./supabase";
import { loadDailyProgress } from "./dailyProgress";
import { loadGridProgress } from "./gridProgress";
import { loadBranchesProgress } from "./branchesProgress";
import { loadStore } from "./stats";

/** The three daily games, as bump_play() names them (see supabase/plays.sql). */
export type CountedGame = "lineage" | "kinship" | "branches";

/** The day counting started. Earlier dates have no anonymous data at all (the
 *  counter didn't exist), which is NOT the same as nobody playing — the admin
 *  chart marks the boundary instead of drawing zeros. */
export const PLAY_COUNT_SINCE = "2026-07-28";

/**
 * Anonymous daily play counter.
 *
 * What is sent when you finish a daily: the game name, its puzzle date, and
 * whether you won. Nothing else. No id, no device id, no session, no cookie, no
 * guesses — the server just adds 1 to a per-(game, date) counter, so there is no
 * row about any individual play and nothing that can be tied back to a person.
 * See supabase/plays.sql for the whole story, and the Privacy section of the
 * About panel for the same promise in the players' own words.
 *
 * Because the server has NO identifier, it cannot tell a reload from a new play —
 * so the once-per-day check lives here, in a localStorage flag that never leaves
 * the device. Best-effort throughout: a failure is swallowed, never surfaced, and
 * never blocks the game.
 */
const key = (game: CountedGame, date: string) => `grebe.counted.${game}.${date}`;

/** True once this device has counted this game+date. */
function alreadyCounted(game: CountedGame, date: string): boolean {
  try {
    return localStorage.getItem(key(game, date)) === "1";
  } catch {
    // Storage blocked (private mode, hardened settings) — treat as not counted.
    // The count may then run a little high for that browser, which is preferable
    // to silently dropping every play from it.
    return false;
  }
}

function markCounted(game: CountedGame, date: string): void {
  try {
    localStorage.setItem(key(game, date), "1");
  } catch {
    /* ignore */
  }
}

/**
 * Count one finished DAILY puzzle. Call sites are the finish paths in App.tsx;
 * free-play rounds are deliberately not counted.
 *
 * Only flags the day as counted once the server has actually accepted it, so a
 * finish that happens offline is retried on a later visit rather than lost.
 * Returns whether it counted, for tests.
 */
export async function countPlay(game: CountedGame, date: string, won: boolean): Promise<boolean> {
  if (!supabase) return false;
  if (alreadyCounted(game, date)) return false;
  try {
    const { error } = await supabase.rpc("bump_play", { p_game: game, p_date: date, p_won: won });
    if (error) return false; // e.g. plays.sql not run yet — stay quiet, retry later
    markCounted(game, date);
    return true;
  } catch {
    return false;
  }
}

/**
 * Count any of today's finishes this device didn't manage to count at the time —
 * a tab still running a bundle from before the counter shipped, a failed call, or
 * being offline. Without this a missed count is permanent: the finish effect skips
 * an already-finished daily on reload, so it never gets a second chance.
 *
 * Gated on THIS device's saved progress (which never syncs), so a daily finished
 * on another device and restored from the cloud is not counted a second time.
 * countPlay's own flag makes it a no-op once a day is counted.
 */
export async function catchUpCounts(today: string): Promise<void> {
  const daily = loadDailyProgress();
  if (daily?.date === today && daily.status !== "playing") {
    await countPlay("lineage", today, daily.status === "won");
  }
  const grid = loadGridProgress();
  if (grid?.date === today && grid.status !== "playing") {
    await countPlay("kinship", today, grid.status === "won");
  }
  const branches = loadBranchesProgress();
  if (branches?.date === today && branches.status === "done") {
    // Branches progress stores no win flag (it's derived from the board), so take it
    // from the stats entry this device wrote when the round finished.
    await countPlay("branches", today, loadStore().branches?.[today]?.won ?? false);
  }
}
