import { describe, it, expect } from "vitest";
import { derive, STREAK_SAVE_MIN_GUESSES, type DailyEntry, type StatsStore } from "./stats";

const won = (): DailyEntry => ({ status: "won", guesses: 3, hints: 0, tier: 1 });
const gaveUp = (guesses: number): DailyEntry => ({ status: "gaveup", guesses, hints: 0, tier: 1 });

const store = (history: Record<string, DailyEntry>): StatsStore => ({ version: 3, history, clades: {} });

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
