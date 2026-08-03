import { describe, it, expect, beforeEach, vi } from "vitest";

// Tests run in node, where localStorage doesn't exist.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

const { newDailyWins } = await import("./badges");

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
