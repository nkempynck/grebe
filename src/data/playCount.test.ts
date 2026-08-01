import { describe, it, expect, beforeEach, vi } from "vitest";

// The counter talks to Supabase; stub the client so the test exercises the
// once-per-day logic (the whole point of the module, since the server has no
// identifier to dedupe on) without a network.
const rpc = vi.fn();
vi.mock("./supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

// Tests run in node, where localStorage doesn't exist.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

// Saved progress + stats, stubbed so the catch-up sweep can be driven directly.
const progress = { daily: null as unknown, grid: null as unknown, branches: null as unknown, stats: {} as Record<string, unknown> };
vi.mock("./dailyProgress", () => ({ loadDailyProgress: () => progress.daily }));
vi.mock("./gridProgress", () => ({ loadGridProgress: () => progress.grid }));
vi.mock("./branchesProgress", () => ({ loadBranchesProgress: () => progress.branches }));
vi.mock("./stats", () => ({ loadStore: () => progress.stats }));

const { countPlay, catchUpCounts, markCountedElsewhere } = await import("./playCount");

describe("countPlay", () => {
  beforeEach(() => {
    store.clear();
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
  });

  it("sends the game, date and result, and nothing else", async () => {
    await countPlay("lineage", "2026-07-28", true);
    expect(rpc).toHaveBeenCalledWith("bump_play", { p_game: "lineage", p_date: "2026-07-28", p_won: true });
  });

  it("counts a given game+date only once per device", async () => {
    expect(await countPlay("lineage", "2026-07-28", true)).toBe(true);
    expect(await countPlay("lineage", "2026-07-28", true)).toBe(false); // reload
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("counts each game and each day separately", async () => {
    await countPlay("lineage", "2026-07-28", true);
    await countPlay("kinship", "2026-07-28", false);
    await countPlay("lineage", "2026-07-29", false);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("retries on a later visit when the server didn't accept it", async () => {
    rpc.mockResolvedValue({ error: { message: "plays.sql not run" } });
    expect(await countPlay("branches", "2026-07-28", true)).toBe(false);
    rpc.mockResolvedValue({ error: null });
    expect(await countPlay("branches", "2026-07-28", true)).toBe(true);
  });

  it("never throws when the call blows up", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    await expect(countPlay("lineage", "2026-07-28", true)).resolves.toBe(false);
  });

  it("skips a day a cloud restore has claimed", async () => {
    markCountedElsewhere("kinship", "2026-07-28");
    expect(await countPlay("kinship", "2026-07-28", true)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("catchUpCounts", () => {
  // A fixed date, not the real clock: catchUpCounts takes the day as an argument
  // (App passes todayKey()), so pinning it keeps these deterministic.
  const TODAY = "2026-07-29";
  beforeEach(() => {
    store.clear();
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
    progress.daily = null; progress.grid = null; progress.branches = null; progress.stats = {};
  });

  it("counts a finish this device made but never counted", async () => {
    progress.daily = { date: TODAY, status: "won" };
    await catchUpCounts(TODAY);
    expect(rpc).toHaveBeenCalledWith("bump_play", { p_game: "lineage", p_date: TODAY, p_won: true });
  });

  it("carries the result through, including a give-up", async () => {
    progress.daily = { date: TODAY, status: "gaveup" };
    progress.grid = { date: TODAY, status: "lost" };
    await catchUpCounts(TODAY);
    expect(rpc).toHaveBeenCalledWith("bump_play", { p_game: "lineage", p_date: TODAY, p_won: false });
    expect(rpc).toHaveBeenCalledWith("bump_play", { p_game: "kinship", p_date: TODAY, p_won: false });
  });

  it("takes the Branches result from stats, since its progress has no win flag", async () => {
    progress.branches = { date: TODAY, status: "done" };
    progress.stats = { branches: { [TODAY]: { won: true } } };
    await catchUpCounts(TODAY);
    expect(rpc).toHaveBeenCalledWith("bump_play", { p_game: "branches", p_date: TODAY, p_won: true });
  });

  it("ignores a round still in progress, and an older day", async () => {
    progress.daily = { date: TODAY, status: "playing" };
    progress.grid = { date: "2026-07-28", status: "won" };
    await catchUpCounts(TODAY);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("doesn't double-count a day already counted at finish time", async () => {
    progress.daily = { date: TODAY, status: "won" };
    await countPlay("lineage", TODAY, true); // the finish effect
    await catchUpCounts(TODAY);             // then a reload
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("doesn't count a board restored from the cloud — the device that played it did", async () => {
    // The regression this exists for: a cloud restore calls markCountedElsewhere, and
    // then the game's own persist effect writes that finished board into THIS device's
    // progress. From that point it is indistinguishable from a board played here, which
    // is what used to earn the day a second count on the next mount.
    markCountedElsewhere("branches", TODAY);
    progress.branches = { date: TODAY, status: "done" };
    progress.stats = { branches: { [TODAY]: { won: true } } };
    await catchUpCounts(TODAY);
    expect(rpc).not.toHaveBeenCalled();
  });
});
