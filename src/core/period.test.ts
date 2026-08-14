import { describe, it, expect } from "vitest";
import { weekStart, monthStart, periodStart, stepPeriod, periodLabel, canStepBack, canStepForward } from "./period";

// These have to agree with public.in_period() in the SQL patch: a week is Monday
// to Sunday (Postgres date_trunc('week')), a month is a calendar month.

const EPOCH = "2026-07-22"; // a Wednesday

describe("weekStart", () => {
  it("takes a midweek day back to its Monday", () => {
    expect(weekStart("2026-08-11")).toBe("2026-08-10"); // Tue -> Mon
  });

  it("leaves a Monday where it is", () => {
    expect(weekStart("2026-08-10")).toBe("2026-08-10");
  });

  it("keeps Sunday in the week that started six days earlier, not the next one", () => {
    // The off-by-one that a Sunday-first week would introduce.
    expect(weekStart("2026-08-16")).toBe("2026-08-10");
    expect(weekStart("2026-08-17")).toBe("2026-08-17"); // the following Monday
  });

  it("crosses a month boundary", () => {
    expect(weekStart("2026-08-02")).toBe("2026-07-27"); // Sun -> previous Mon
  });
});

describe("monthStart", () => {
  it("takes any day to the first", () => {
    expect(monthStart("2026-08-11")).toBe("2026-08-01");
    expect(monthStart("2026-08-01")).toBe("2026-08-01");
  });
});

describe("periodStart", () => {
  it("passes the date through for day and all", () => {
    expect(periodStart("day", "2026-08-11")).toBe("2026-08-11");
    expect(periodStart("all", "2026-08-11")).toBe("2026-08-11");
  });
});

describe("stepPeriod", () => {
  it("steps whole weeks from the bucket start, not from where you were", () => {
    // Started midweek: back one week lands on a Monday, not on a Tuesday.
    expect(stepPeriod("week", "2026-08-11", -1)).toBe("2026-08-03");
    expect(stepPeriod("week", "2026-08-11", 1)).toBe("2026-08-17");
  });

  it("steps whole months, including across a year", () => {
    expect(stepPeriod("month", "2026-08-11", -1)).toBe("2026-07-01");
    expect(stepPeriod("month", "2026-01-15", -1)).toBe("2025-12-01");
    expect(stepPeriod("month", "2026-12-15", 1)).toBe("2027-01-01");
  });

  it("steps single days", () => {
    expect(stepPeriod("day", "2026-08-01", -1)).toBe("2026-07-31");
  });
});

describe("periodLabel", () => {
  it("labels each window", () => {
    expect(periodLabel("day", "2026-08-11")).toBe("Aug 11");
    expect(periodLabel("week", "2026-08-11")).toBe("Wk of Aug 10");
    expect(periodLabel("month", "2026-08-11")).toBe("Aug 2026");
  });
});

describe("canStepBack", () => {
  it("stops the day nav at the epoch", () => {
    expect(canStepBack("day", "2026-07-23", EPOCH)).toBe(true);
    expect(canStepBack("day", EPOCH, EPOCH)).toBe(false);
  });

  it("stops the week nav at the epoch's week, not at the epoch date", () => {
    // The epoch is a Wednesday, so its week started 2026-07-20. Browsing that
    // week must be allowed; stepping off it must not.
    expect(canStepBack("week", "2026-07-27", EPOCH)).toBe(true);
    expect(canStepBack("week", "2026-07-20", EPOCH)).toBe(false);
  });

  it("stops the month nav at the epoch's month", () => {
    expect(canStepBack("month", "2026-08-11", EPOCH)).toBe(true);
    expect(canStepBack("month", "2026-07-05", EPOCH)).toBe(false);
  });

  it("is never available on all time", () => {
    expect(canStepBack("all", "2026-08-11", EPOCH)).toBe(false);
  });
});

describe("canStepForward", () => {
  const TODAY = "2026-08-11";

  it("allows the current, unfinished week and month but not the next one", () => {
    expect(canStepForward("week", "2026-08-03", TODAY)).toBe(true);
    expect(canStepForward("week", TODAY, TODAY)).toBe(false);
    expect(canStepForward("month", "2026-07-15", TODAY)).toBe(true);
    expect(canStepForward("month", TODAY, TODAY)).toBe(false);
  });

  it("stops the day nav at today", () => {
    expect(canStepForward("day", "2026-08-10", TODAY)).toBe(true);
    expect(canStepForward("day", TODAY, TODAY)).toBe(false);
  });
});
