import { describe, it, expect, beforeEach, vi } from "vitest";

// Tests run in node, where localStorage doesn't exist.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

const { newDailyWins, overallBadges } = await import("./badges");

// One celebration banner per source (three games + the combined board), each
// tracked under its own key so winning two games on one day says so twice, and
// so a source's first sighting baselines instead of dumping every past win.
describe("newDailyWins", () => {
  beforeEach(() => store.clear());

  it("baselines on first sight and celebrates only what arrives later", () => {
    expect(newDailyWins("kinship", ["2026-07-20", "2026-07-19"])).toEqual([]);
    expect(newDailyWins("kinship", ["2026-07-21", "2026-07-20", "2026-07-19"])).toEqual(["2026-07-21"]);
    // Already celebrated — not again on the next load.
    expect(newDailyWins("kinship", ["2026-07-21", "2026-07-20"])).toEqual([]);
  });

  it("tracks each source separately", () => {
    newDailyWins("kinship", []);   // baseline both, no wins yet
    newDailyWins("branches", []);
    expect(newDailyWins("kinship", ["2026-07-21"])).toEqual(["2026-07-21"]);
    // The same date won in another game is its own, still-uncelebrated win.
    expect(newDailyWins("branches", ["2026-07-21"])).toEqual(["2026-07-21"]);
    expect(newDailyWins("overall", ["2026-07-21"])).toEqual([]); // first sight → baseline
  });

  it("keeps Lineage on the original key, so old devices don't re-celebrate", () => {
    store.set("grebe.seenWins", JSON.stringify(["2026-07-20"]));
    expect(newDailyWins("lineage", ["2026-07-20"])).toEqual([]);
    expect(newDailyWins("lineage", ["2026-07-21", "2026-07-20"])).toEqual(["2026-07-21"]);
  });
});

// The combined board's crown is SHARED on an exact tie (see supabase/streaks.sql),
// so a day can appear in both win_dates and shared_dates: it still counts as a win,
// and it also earns the 🤝.
describe("overallBadges", () => {
  const ids = (b: { id: string }[]) => b.map((x) => x.id);

  it("gives only the crown when every win was solo", () => {
    const b = overallBadges({ daily_wins: 2, win_dates: ["2026-08-01", "2026-07-24"], shared_dates: [] });
    expect(ids(b)).toEqual(["champ-overall"]);
  });

  it("adds joint custody for a shared day, without costing the win", () => {
    const b = overallBadges({ daily_wins: 2, win_dates: ["2026-07-30", "2026-07-24"], shared_dates: ["2026-07-30"] });
    expect(ids(b)).toEqual(["champ-overall", "joint-custody"]);
    // The shared day is still one of the two wins behind the crown.
    expect(b[0].occurrences).toEqual(["Jul 30", "Jul 24"]);
    expect(b[1].label).toBe("joint custody");
    expect(b[1].occurrences).toEqual(["Jul 30"]);
    expect(b[1].occLabel).toBe("shared");
  });

  it("counts repeat shares in the label", () => {
    const b = overallBadges({ daily_wins: 3, win_dates: ["2026-08-02", "2026-07-30", "2026-07-24"], shared_dates: ["2026-08-02", "2026-07-30"] });
    expect(b[1].label).toBe("2× joint custody");
  });

  it("survives a backend still running the pre-shared-crown streaks.sql", () => {
    // shared_dates absent from the RPC payload — no badge, no crash.
    const b = overallBadges({ daily_wins: 1, win_dates: ["2026-07-24"] } as never);
    expect(ids(b)).toEqual(["champ-overall"]);
  });

  it("has nothing to show before the first overall win", () => {
    expect(overallBadges(null)).toEqual([]);
    expect(overallBadges({ daily_wins: 0, win_dates: [], shared_dates: [] })).toEqual([]);
  });
});
