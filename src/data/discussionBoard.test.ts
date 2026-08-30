import { describe, it, expect } from "vitest";
import { MOSAIC_FEEDBACK_BOARD, OPEN_BOARD_DATE } from "./discussion";

// The client and the server both have to name the open board the same way, and neither can see
// the other. These pin the two constants that have to agree with supabase/is_open_board() and
// open_board_date(); if either moves, the board silently splits in two.
describe("open discussion board", () => {
  it("does not take the name the daily board will want", () => {
    // When Mosaic is pinned it gets an ordinary per-day board under "mosaic". The standing
    // feedback thread must not already be sitting there.
    expect(MOSAIC_FEEDBACK_BOARD).not.toBe("mosaic");
    expect(MOSAIC_FEEDBACK_BOARD).toBe("mosaic-feedback");
  });

  it("pins one date, far from any real puzzle date", () => {
    expect(OPEN_BOARD_DATE).toBe("1970-01-01");
    // A sentinel that could ever BE a puzzle date would collide with a real board.
    expect(new Date(`${OPEN_BOARD_DATE}T00:00:00Z`).getTime())
      .toBeLessThan(new Date("2020-01-01T00:00:00Z").getTime());
  });
});
