import { describe, it, expect } from "vitest";
import { hydrationToken, isLiveDailyState } from "./useGame";

// REGRESSION, reported 2026-08-03. A player set free play to the same scope as the
// daily, played it, then opened the daily and found it already "completed" with
// their free-play guesses — and still accepting more, because the carried-over
// status was "playing".
//
// Cause: the persist effect's guard compared a date+answer-only token. On the
// commit where the mode flips free → daily, `mode` is already "daily" while
// answerId/guesses/hydratedFor are still the free-play values from the closure, so
// the stale token matched its own stale answerId and free-play state was written to
// the daily's storage key. Including the mode in the token is what stops it.
//
// The hook itself has no test harness (no @testing-library in this project), so the
// guard is extracted and tested directly. These cases describe the leak, not the
// string format — the format is free to change as long as they still hold.

const DATE = "2026-08-03";
const ANSWER = "ott12345";

describe("isLiveDailyState", () => {
  it("accepts state hydrated for this daily", () => {
    expect(isLiveDailyState(hydrationToken("daily", DATE, ANSWER), DATE, ANSWER)).toBe(true);
  });

  it("REFUSES free-play state that happens to share the daily's answer", () => {
    // The exact collision from the report: same date, same answer, wrong mode.
    // A date+answer-only token could not tell these apart.
    expect(isLiveDailyState(hydrationToken("free", DATE, ANSWER), DATE, ANSWER)).toBe(false);
  });

  it("refuses free-play state generally", () => {
    expect(isLiveDailyState(hydrationToken("free", DATE, "ott999"), DATE, "ott999")).toBe(false);
  });

  it("refuses a stale answer under the right mode and date", () => {
    expect(isLiveDailyState(hydrationToken("daily", DATE, "ott999"), DATE, ANSWER)).toBe(false);
  });

  it("refuses yesterday's state, so a tab crossing the 09:00 rollover can't write it", () => {
    expect(isLiveDailyState(hydrationToken("daily", "2026-08-02", ANSWER), DATE, ANSWER)).toBe(false);
  });

  it("refuses state that has not been hydrated at all", () => {
    expect(isLiveDailyState(null, DATE, ANSWER)).toBe(false);
  });

  it("refuses when there is no answer yet, even if the token somehow matches", () => {
    expect(isLiveDailyState(hydrationToken("daily", DATE, ANSWER), DATE, null)).toBe(false);
  });
});

describe("hydrationToken", () => {
  it("distinguishes the two modes for the same day and answer", () => {
    expect(hydrationToken("daily", DATE, ANSWER)).not.toBe(hydrationToken("free", DATE, ANSWER));
  });
});
