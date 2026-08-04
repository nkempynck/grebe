import { describe, it, expect } from "vitest";
import { deriveField, fmtFieldPct, MIN_FIELD_PLAYERS } from "./field";
import type { DayAverage } from "./games";
import type { StatsStore } from "./stats";

// Post-launch dates (DAILY_EPOCH is 2026-07-22); pre-launch days are filtered out
// of stats everywhere, so the comparison must ignore them too.
const D1 = "2026-08-01", D2 = "2026-08-02", D3 = "2026-08-03";

const store = (over: Partial<StatsStore> = {}): StatsStore => ({
  version: 6, history: {}, clades: {}, kinship: {}, branches: {}, ...over,
});
// A daily whose frozen points and clade group are set directly.
const day = (points: number, group = "birds") => ({ status: "won" as const, guesses: 3, hints: 0, tier: 1, group, points });
const avg = (game: DayAverage["game"], d: string, a: number, players = MIN_FIELD_PLAYERS + 1): DayAverage =>
  ({ day: d, game, avg: a, players });

describe("vs-field comparison", () => {
  it("averages the per-day ratios, not the totals", () => {
    // 120 vs a field of 100 (+20%), then 90 vs 100 (−10%) → mean ratio 1.05.
    const s = store({ history: { [D1]: day(120), [D2]: day(90) } });
    const f = deriveField(s, [avg("lineage", D1, 100), avg("lineage", D2, 100)]);
    expect(f.byGame.lineage).toEqual({ pct: 5, games: 2 });
    // A big day and a small day count the same, since the ratio divides the weight out.
    const s2 = store({ history: { [D1]: day(240), [D2]: day(45) } });
    const f2 = deriveField(s2, [avg("lineage", D1, 200), avg("lineage", D2, 50)]);
    expect(f2.byGame.lineage).toEqual({ pct: 5, games: 2 });
  });

  it("counts a day you failed as the zero it scored", () => {
    const s = store({
      history: {
        [D1]: day(150),                                    // +50%
        [D2]: { ...day(0), status: "gaveup", points: 0 },  // 0 ÷ field = −100%
      },
    });
    const f = deriveField(s, [avg("lineage", D1, 100), avg("lineage", D2, 100)]);
    // (1.5 + 0) / 2 = 0.75 → −25%. Both days counted.
    expect(f.byGame.lineage).toEqual({ pct: -25, games: 2 });
  });

  it("skips days with too thin a field to compare against", () => {
    const s = store({ history: { [D1]: day(100), [D2]: day(200) } });
    const f = deriveField(s, [
      avg("lineage", D1, 100),
      avg("lineage", D2, 200, MIN_FIELD_PLAYERS - 1), // one short of a field
    ]);
    expect(f.byGame.lineage).toEqual({ pct: 0, games: 1 });
  });

  it("pools every game into overall, weighted by days played", () => {
    const s = store({
      history: { [D1]: day(150), [D2]: day(150) },                     // +50%, +50%
      kinship: { [D1]: { status: "won", mistakes: 0, tier: 1, points: 50 } }, // −50%
    });
    const f = deriveField(s, [
      avg("lineage", D1, 100), avg("lineage", D2, 100), avg("kinship", D1, 100),
    ]);
    expect(f.byGame.lineage?.pct).toBe(50);
    expect(f.byGame.kinship?.pct).toBe(-50);
    // Three days pooled: (1.5 + 1.5 + 0.5) / 3 = 1.167 → +17%.
    expect(f.overall).toEqual({ pct: 17, games: 3 });
    expect(f.byGame.branches).toBeNull();
  });

  it("splits Lineage by the clade of each day and names the best", () => {
    const s = store({
      history: {
        [D1]: day(150, "birds"), [D2]: day(150, "birds"), [D3]: day(120, "birds"),
        "2026-08-04": day(90, "plants"), "2026-08-05": day(90, "plants"), "2026-08-06": day(90, "plants"),
      },
    });
    const f = deriveField(s, [
      avg("lineage", D1, 100), avg("lineage", D2, 100), avg("lineage", D3, 100),
      avg("lineage", "2026-08-04", 100), avg("lineage", "2026-08-05", 100), avg("lineage", "2026-08-06", 100),
    ]);
    expect(f.byClade.lineage.birds).toEqual({ pct: 40, games: 3 });
    expect(f.byClade.lineage.plants).toEqual({ pct: -10, games: 3 });
    expect(f.bestCladeId.lineage).toBe("birds");
  });

  it("won't call a barely-played clade your best", () => {
    const s = store({
      history: {
        [D1]: day(300, "fish"),                                         // one huge day
        [D2]: day(120, "birds"), [D3]: day(120, "birds"), "2026-08-04": day(120, "birds"),
      },
    });
    const f = deriveField(s, [
      avg("lineage", D1, 100), avg("lineage", D2, 100), avg("lineage", D3, 100), avg("lineage", "2026-08-04", 100),
    ]);
    expect(f.byClade.lineage.fish).toEqual({ pct: 200, games: 1 }); // still reported…
    expect(f.bestCladeId.lineage).toBe("birds");           // …but not the "best"
  });

  // Each game gets its own clade split: a Kinship bird board is compared against the
  // Kinship field on that day, and says nothing about Lineage birds.
  it("splits every game by clade, each against its own field", () => {
    const s = store({
      history: { [D1]: day(150, "birds") },                                                        // Lineage birds +50%
      kinship: { [D1]: { status: "won", mistakes: 0, tier: 1, points: 50, group: "birds" } },       // Kinship birds −50%
      branches: { [D2]: { won: true, correct: 5, total: 5, hinted: 0, peeked: 0, mistakes: 0, tier: 1, points: 200, group: "fish" } },
    });
    const f = deriveField(s, [
      avg("lineage", D1, 100), avg("kinship", D1, 100), avg("branches", D2, 100),
    ]);
    expect(f.byClade.lineage.birds).toEqual({ pct: 50, games: 1 });
    expect(f.byClade.kinship.birds).toEqual({ pct: -50, games: 1 });
    expect(f.byClade.branches.fish).toEqual({ pct: 100, games: 1 });
    expect(f.byClade.branches.birds).toBeUndefined();
  });

  it("resolves the clade of a day recorded before groups were tagged", () => {
    const s = store({
      kinship: { [D1]: { status: "won", mistakes: 0, tier: 1, points: 150 } }, // no group on the entry
    });
    const f = deriveField(s, [avg("kinship", D1, 100)], { kinship: () => "insects" });
    expect(f.byClade.kinship.insects).toEqual({ pct: 50, games: 1 });
    // Without a resolver the day still counts for the game, just not for any clade.
    const bare = deriveField(s, [avg("kinship", D1, 100)]);
    expect(bare.byGame.kinship).toEqual({ pct: 50, games: 1 });
    expect(bare.byClade.kinship).toEqual({});
  });

  it("drops pre-launch days", () => {
    const s = store({ history: { "2026-07-20": day(300), [D1]: day(100) } });
    const f = deriveField(s, [avg("lineage", "2026-07-20", 100), avg("lineage", D1, 100)]);
    expect(f.byGame.lineage).toEqual({ pct: 0, games: 1 });
  });

  it("is null with no field data at all", () => {
    const f = deriveField(store({ history: { [D1]: day(100) } }), []);
    expect(f.overall).toBeNull();
    expect(f.bestCladeId).toEqual({ lineage: null, kinship: null, branches: null });
  });

  it("formats with an explicit sign", () => {
    expect(fmtFieldPct(24)).toBe("+24%");
    expect(fmtFieldPct(-4)).toBe("−4%");
    expect(fmtFieldPct(0)).toBe("even");
  });
});
