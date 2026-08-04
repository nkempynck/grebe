import { describe, it, expect } from "vitest";
import {
  derive,
  localStoreTrusted,
  mergeMissingDailies,
  type BranchesEntry,
  type DailyEntry,
  type KinshipEntry,
  type StatsStore,
} from "./stats";
import { kinshipBadges, branchesBadges, lineageBadges } from "./badges";

const won = (): DailyEntry => ({ status: "won", guesses: 3, hints: 0, tier: 1 });
const gaveUp = (guesses: number): DailyEntry => ({ status: "gaveup", guesses, hints: 0, tier: 1 });

const store = (history: Record<string, DailyEntry>): StatsStore => ({ version: 6, history, clades: {}, kinship: {}, branches: {} });
const kinStore = (kinship: Record<string, KinshipEntry>): StatsStore => ({ version: 6, history: {}, clades: {}, kinship, branches: {} });
const brnStore = (branches: Record<string, BranchesEntry>): StatsStore => ({ version: 6, history: {}, clades: {}, kinship: {}, branches });

// Sign-in carryover: a daily finished while SIGNED OUT is saved locally, and its
// leaderboard row replays via pendingSubmits — but a returning account's authoritative
// cloud store would overwrite the device and drop the personal stat, leaving the
// "played today" gate (stats.daily.playedDates) closed while the board shows the row.
// mergeMissingDailies folds the local-only daily into the cloud store to close that gap.
describe("signed-out daily carries into the played-today gate on sign-in", () => {
  const TODAY = "2026-08-21";

  it("folds a local-only daily into a returning account's stats", () => {
    const cloud = store({ "2026-08-19": won(), "2026-08-20": won() }); // returning acct, no today yet
    const local = store({ "2026-08-20": won(), [TODAY]: won() });      // signed-out play today
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

// Whose stats may a signing-in account absorb? A deliberate sign-out wipes the
// device, but a session that merely vanishes leaves the store in place (losing a
// session shouldn't cost a player their stats), so the device can hold one
// player's dailies while somebody else signs in next.
describe("local store ownership", () => {
  const A = "user-a", B = "user-b";

  it("carries anonymous play into a first account", () => {
    expect(localStoreTrusted(null, A)).toBe(true);
  });

  it("gives a player their own store back after a dropped session", () => {
    expect(localStoreTrusted(A, A)).toBe(true);
  });

  it("refuses a store left behind by another account", () => {
    expect(localStoreTrusted(A, B)).toBe(false);
  });
});

// ONE rule for all three games: a streak is a run of consecutive days WON. Not
// winning ends it, however hard the player fought. These tests also pin the shared
// walk (today if played, else yesterday) that public.game_streaks() must match.
describe("daily streaks", () => {
  const TODAY = "2026-08-10";

  it("counts consecutive wins", () => {
    const s = store({ "2026-08-08": won(), "2026-08-09": won(), "2026-08-10": won() });
    expect(derive(s, TODAY).daily.currentStreak).toBe(3);
  });

  it("ends on a give-up, however long the attempt", () => {
    const s = store({ "2026-08-08": won(), "2026-08-09": won(), "2026-08-10": gaveUp(12) });
    expect(derive(s, TODAY).daily.currentStreak).toBe(0);
  });

  it("a give-up mid-run does not bridge it", () => {
    const s = store({ "2026-08-08": won(), "2026-08-09": gaveUp(9), "2026-08-10": won() });
    // Only today's win stands; the give-up severs it from Wednesday's.
    expect(derive(s, TODAY).daily.currentStreak).toBe(1);
  });

  it("keeps yesterday's run alive until today is played", () => {
    const s = store({ "2026-08-08": won(), "2026-08-09": won() }); // today untouched
    expect(derive(s, TODAY).daily.currentStreak).toBe(2);
  });

  it("breaks on a missed day (gap)", () => {
    const s = store({ "2026-08-07": won(), "2026-08-08": won(), "2026-08-10": won() });
    // Only today's win survives; the gap on 08-09 severs it from the earlier run.
    expect(derive(s, TODAY).daily.currentStreak).toBe(1);
  });

  it("tracks the best-ever run and the day each streak tier was reached", () => {
    const s = store({
      "2026-08-01": won(),
      "2026-08-02": won(),
      "2026-08-03": won(),
      "2026-08-04": won(),
      "2026-08-05": gaveUp(9), // ends the run
      "2026-08-06": won(),
    });
    const d = derive(s, TODAY).daily;
    expect(d.maxStreak).toBe(4);
    expect(d.bestStreakStart).toBe("2026-08-01");
    expect(d.bestStreakEnd).toBe("2026-08-04");
    // The 3-day badge was earned on the run's THIRD day, not the day it ended.
    const streak = lineageBadges(derive(s, TODAY)).find((b) => b.id === "lin-streak");
    expect(streak?.label).toBe("3-day streak");
    expect(streak?.occurrences).toEqual(["Aug 3, 2026"]);
  });
});

// Pre-launch days were a shakedown and their server rows were wiped at launch, so
// they must not count locally either — a pre-launch run would otherwise show a
// streak and a points total no board can corroborate.
describe("pre-launch results don't count", () => {
  const TODAY = "2026-08-10";
  const beforeLaunch = "2026-07-20"; // DAILY_EPOCH is 2026-07-22
  const atLaunch = "2026-07-22";

  it("drops days before the epoch from every game's stats", () => {
    const s: StatsStore = {
      version: 6,
      history: { [beforeLaunch]: won(), [atLaunch]: won() },
      clades: {},
      kinship: { [beforeLaunch]: { status: "won", mistakes: 0, tier: 1 } },
      branches: { [beforeLaunch]: { won: true, correct: 5, total: 5, hinted: 0, peeked: 0, tier: 1 } },
    };
    const d = derive(s, TODAY);
    expect(d.daily.played).toBe(1);                    // launch day only
    expect(d.daily.playedDates).toEqual([atLaunch]);
    expect(d.kinship.played).toBe(0);
    expect(d.branches.played).toBe(0);
  });

  it("does not let a pre-launch run feed a streak", () => {
    // Four straight wins, all before launch, ending the day before the epoch.
    const s = store({
      "2026-07-18": won(), "2026-07-19": won(), "2026-07-20": won(), "2026-07-21": won(),
    });
    const d = derive(s, "2026-07-22").daily;
    expect(d.currentStreak).toBe(0);
    expect(d.maxStreak).toBe(0);
  });
});

// Kinship and Branches run on the same rule, with their own notion of a win.
describe("kinship and branches streaks", () => {
  const TODAY = "2026-08-10";
  const kWon = (mistakes = 0): KinshipEntry => ({ status: "won", mistakes, tier: 1, paidReveals: 0 });
  const kLost = (): KinshipEntry => ({ status: "lost", mistakes: 4, tier: 1 });
  const bWon = (): BranchesEntry => ({ won: true, correct: 5, total: 5, hinted: 0, peeked: 0, mistakes: 0, tier: 1 });
  const bLost = (): BranchesEntry => ({ won: false, correct: 3, total: 5, hinted: 0, peeked: 0, mistakes: 2, tier: 1 });

  it("a lost grid ends the Kinship streak the day it happens", () => {
    const s = kinStore({ "2026-08-08": kWon(), "2026-08-09": kWon(), "2026-08-10": kLost() });
    expect(derive(s, TODAY).kinship.currentStreak).toBe(0);
    // Yesterday's two-day run is still the best ever.
    expect(derive(s, TODAY).kinship.maxStreak).toBe(2);
  });

  it("a blown Branches budget ends that streak too", () => {
    const s = brnStore({ "2026-08-08": bWon(), "2026-08-09": bWon(), "2026-08-10": bLost() });
    expect(derive(s, TODAY).branches.currentStreak).toBe(0);
  });

  it("an unplayed today leaves both runs standing", () => {
    expect(derive(kinStore({ "2026-08-09": kWon() }), TODAY).kinship.currentStreak).toBe(1);
    expect(derive(brnStore({ "2026-08-09": bWon() }), TODAY).branches.currentStreak).toBe(1);
  });
});

// The flawless count and the dates behind the ✨ badge must be the same set: they
// used to disagree, so a board bought with paid peeks earned a badge it wasn't
// counted for.
describe("flawless boards", () => {
  const TODAY = "2026-08-10";

  it("Kinship: a clean board counts, a paid peek disqualifies it", () => {
    const s = kinStore({
      "2026-08-08": { status: "won", mistakes: 0, tier: 1, reveals: 2, paidReveals: 0 },
      "2026-08-09": { status: "won", mistakes: 0, tier: 1, reveals: 6, paidReveals: 2 },
      "2026-08-10": { status: "won", mistakes: 1, tier: 1, paidReveals: 0 },
    });
    const k = derive(s, TODAY).kinship;
    expect(k.flawless).toBe(1);
    expect(k.flawlessDates).toEqual(["2026-08-08"]);
    expect(kinshipBadges(derive(s, TODAY)).find((b) => b.id === "kin-flawless")?.desc)
      .toBe("1 boards solved with no mistakes or paid peeks");
  });

  it("Branches: a hint or a peek disqualifies it", () => {
    const s = brnStore({
      "2026-08-08": { won: true, correct: 5, total: 5, hinted: 0, peeked: 0, mistakes: 0, tier: 1 },
      "2026-08-09": { won: true, correct: 5, total: 5, hinted: 1, peeked: 0, mistakes: 0, tier: 1 },
      "2026-08-10": { won: true, correct: 5, total: 5, hinted: 0, peeked: 1, mistakes: 0, tier: 1 },
    });
    const b = derive(s, TODAY).branches;
    expect(b.flawless).toBe(1);
    expect(b.flawlessDates).toEqual(["2026-08-08"]);
    expect(branchesBadges(derive(s, TODAY)).find((b2) => b2.id === "brn-flawless")).toBeTruthy();
  });
});
