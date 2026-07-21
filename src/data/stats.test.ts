import { describe, it, expect } from "vitest";
import { derive, mergeMissingDailies, STREAK_SAVE_MIN_GUESSES, type DailyEntry, type StatsStore } from "./stats";

const won = (): DailyEntry => ({ status: "won", guesses: 3, hints: 0, tier: 1 });
const gaveUp = (guesses: number): DailyEntry => ({ status: "gaveup", guesses, hints: 0, tier: 1 });

const store = (history: Record<string, DailyEntry>): StatsStore => ({ version: 6, history, clades: {}, kinship: {}, branches: {} });

// Sign-in carryover: a daily finished while SIGNED OUT is saved locally, and its
// leaderboard row replays via pendingSubmits — but a returning account's authoritative
// cloud store would overwrite the device and drop the personal stat, leaving the
// "played today" gate (stats.daily.playedDates) closed while the board shows the row.
// mergeMissingDailies folds the local-only daily into the cloud store to close that gap.
describe("signed-out daily carries into the played-today gate on sign-in", () => {
  const TODAY = "2026-07-21";

  it("folds a local-only daily into a returning account's stats", () => {
    const cloud = store({ "2026-07-19": won(), "2026-07-20": won() }); // returning acct, no today yet
    const local = store({ "2026-07-20": won(), [TODAY]: won() });      // signed-out play today
    const carried = mergeMissingDailies(cloud, local);
    expect(carried).toBe(1);
    // The gate reads playedDates; today must now be in it.
    expect(derive(cloud, TODAY).daily.playedDates).toContain(TODAY);
  });

  it("never overwrites a date the cloud already has (cloud wins)", () => {
    const cloudToday = won();
    const cloud = store({ [TODAY]: cloudToday });
    const local = store({ [TODAY]: gaveUp(9) }); // a different local result for the same day
    expect(mergeMissingDailies(cloud, local)).toBe(0);
    expect(cloud.history[TODAY]).toBe(cloudToday); // untouched
  });
});

// A well-fought give-up (>= STREAK_SAVE_MIN_GUESSES) keeps the streak but doesn't
// add to it; a shorter give-up or a gap breaks it.
describe("daily streaks", () => {
  const TODAY = "2026-07-10";

  it("counts consecutive wins", () => {
    const s = store({ "2026-07-08": won(), "2026-07-09": won(), "2026-07-10": won() });
    expect(derive(s, TODAY).daily.currentStreak).toBe(3);
  });

  it("bridges a qualifying give-up without inflating the count", () => {
    const s = store({
      "2026-07-08": won(),
      "2026-07-09": gaveUp(STREAK_SAVE_MIN_GUESSES), // real attempt → keeps streak
      "2026-07-10": won(),
    });
    // Two wins, bridged by the give-up: streak survives but the give-up adds 0.
    expect(derive(s, TODAY).daily.currentStreak).toBe(2);
  });

  it("breaks on a short give-up", () => {
    const s = store({
      "2026-07-08": won(),
      "2026-07-09": won(),
      "2026-07-10": gaveUp(STREAK_SAVE_MIN_GUESSES - 1), // too few guesses
    });
    expect(derive(s, TODAY).daily.currentStreak).toBe(0);
  });

  it("breaks on a missed day (gap)", () => {
    const s = store({ "2026-07-07": won(), "2026-07-08": won(), "2026-07-10": won() });
    // Only today's win survives; the gap on 07-09 severs it from the earlier run.
    expect(derive(s, TODAY).daily.currentStreak).toBe(1);
  });

  it("tracks the best-ever streak, bridging qualifying give-ups", () => {
    const s = store({
      "2026-07-01": won(),
      "2026-07-02": won(),
      "2026-07-03": gaveUp(STREAK_SAVE_MIN_GUESSES), // bridge
      "2026-07-04": won(),
      "2026-07-05": gaveUp(1), // short give-up ends the run
      "2026-07-06": won(),
    });
    // Longest run of wins across bridges: 01,02,(03 bridge),04 = 3.
    expect(derive(s, TODAY).daily.maxStreak).toBe(3);
  });
});
