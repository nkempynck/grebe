import { describe, it, expect } from "vitest";
import { branchesShareRows, lineageShare } from "./share";
import { dailyNumber, type GuessResult, type TaxonNode } from "../core";
import { gamePoints } from "../data/score";
import { SCOPE_PRESETS } from "../data/presets";

// The Branches grid used to show a single row of the FINAL board, so a board won
// after a mistake shared as an unbroken run of green — the mistake was in the
// verdict line but nowhere in the squares. It now draws a row per submit.

const SLOTS = ["a", "b", "c", "d", "e"];
/** Every slot placed cleanly (the state a won board ends in). */
const clean = () => "🟩";

describe("branchesShareRows", () => {
  it("shows where the board went wrong, then the clean row", () => {
    expect(branchesShareRows(SLOTS, ["10110", "11111"], clean)).toEqual([
      "🟩⬛🟩🟩⬛",
      "🟩🟩🟩🟩🟩",
    ]);
  });

  it("keeps a clean solve to one row", () => {
    expect(branchesShareRows(SLOTS, ["11111"], clean)).toEqual(["🟩🟩🟩🟩🟩"]);
  });

  it("ends a loss on its last failed row — no green row is invented", () => {
    const square = (s: string) => (s === "a" || s === "c" ? "🟩" : "⬛");
    expect(branchesShareRows(SLOTS, ["10100", "10100"], square)).toEqual([
      "🟩⬛🟩⬛⬛",
      "🟩⬛🟩⬛⬛",
    ]);
  });

  it("marks a slot's help from the row it first came up correct on", () => {
    // Slot c was hinted: ⬛ while still wrong, 🟨 once it counts.
    const square = (s: string) => (s === "c" ? "🟨" : "🟩");
    expect(branchesShareRows(SLOTS, ["11011", "11111"], square)).toEqual([
      "🟩🟩⬛🟩🟩",
      "🟩🟩🟨🟩🟩",
    ]);
  });

  it("falls back to the final board when there is no history", () => {
    // A board restored from the server keeps only summary stats, so it has no
    // attempts — the old single-row grid is what it can honestly show.
    expect(branchesShareRows(SLOTS, [], clean)).toEqual(["🟩🟩🟩🟩🟩"]);
  });
});

// Lineage's shared result. This builder was lifted out of ShareCard so the
// post-round reveal could offer the identical copy; these pin the text it emits,
// which nothing covered while it lived inside the component.

// Only `warmth` and `isWin` reach the grid — the nodes are never read, so they
// are stubs rather than a slice of the real tree.
const NODE = { id: "x", sciName: "X" } as unknown as TaxonNode;
const guess = (warmth: number, isWin = false): GuessResult =>
  ({ guess: NODE, mrca: NODE, stepsFromAnswer: isWin ? 0 : 4, warmth, isWin });

// A real preset, read rather than hardcoded: the labels come from taxonomy.json,
// so spelling one here would tie the test to the current species set.
const SCOPE = SCOPE_PRESETS[0];
const CONFIG = { scopeRootId: SCOPE.id, winWithin: 0 };
const DATE = "2026-08-19";

describe("lineageShare", () => {
  it("writes a won daily: header, grid, verdict, score and streak", () => {
    const s = lineageShare({
      config: CONFIG,
      // Stored newest-first, so this is a win that came after a lukewarm guess —
      // and the grid has to read the other way round, cold to hot.
      guesses: [guess(1, true), guess(0.5)],
      status: "won",
      hintCount: 0,
      date: DATE,
      mode: "daily",
      tier: 3,
      difficulty: "Tricky",
      streak: 29,
    });
    expect(s.row).toBe("🟨🎯");
    expect(s.text).toBe(
      `🧬 Grebe Lineage · №${dailyNumber(DATE)} · Tricky\n` +
        `${SCOPE.label} · Exact species\n` +
        "🟨🎯\n" +
        `Solved in 2 · ${gamePoints(true, 3, 2, 0)} pts · 🔥29\n` +
        "https://grebegames.com"
    );
  });

  it("maps every warmth band to its own square", () => {
    const s = lineageShare({
      config: CONFIG,
      guesses: [guess(0.85), guess(0.7), guess(0.5), guess(0.3), guess(0.1)],
      status: "gaveup",
      hintCount: 0,
      date: DATE,
      mode: "daily",
      tier: 1,
    });
    expect(s.row).toBe("⬜🟦🟨🟧🟥");
  });

  it("counts hints, and a give-up scores zero rather than nothing", () => {
    const s = lineageShare({
      config: CONFIG,
      guesses: [guess(0.1)],
      status: "gaveup",
      hintCount: 1,
      date: DATE,
      mode: "daily",
      tier: 2,
      streak: 4, // a give-up ends the run, so it must not be shared
    });
    expect(s.verdict).toBe("Gave up · 1 guess");
    expect(s.showStreak).toBe(false);
    expect(s.text).toContain("Gave up · 1 guess · 1 hint · 0 pts");
  });

  it("leaves free play unscored and undated", () => {
    const s = lineageShare({
      config: CONFIG,
      guesses: [guess(1, true)],
      status: "won",
      hintCount: 0,
      date: DATE,
      mode: "free",
      tier: 3,
      streak: 29,
    });
    expect(s.label).toBe("free play");
    expect(s.score).toBe(null);
    expect(s.showStreak).toBe(false);
    expect(s.text).toContain("\nSolved in 1\n");
  });

  it("shows a dash for a round with no guesses at all", () => {
    const s = lineageShare({
      config: CONFIG,
      guesses: [],
      status: "gaveup",
      hintCount: 0,
      date: DATE,
      mode: "daily",
      tier: 1,
    });
    expect(s.row).toBe("—");
  });
});
