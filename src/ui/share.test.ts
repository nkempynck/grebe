import { describe, it, expect } from "vitest";
import { branchesShareRows } from "./share";

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
