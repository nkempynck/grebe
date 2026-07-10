import { describe, it, expect } from "vitest";
import { gamePoints } from "./score";

// GOLDEN scoring values. gamePoints() MUST stay byte-identical to
// public.game_points in supabase/schema.sql — if you change the formula here,
// change it THERE too (and update these expectations). This suite is the
// tripwire that catches a silent client/SQL scoring drift.
describe("gamePoints", () => {
  it("is zero for a loss, regardless of other inputs", () => {
    expect(gamePoints(false, 7, 1, 0)).toBe(0);
    expect(gamePoints(false, 1, 10, 3)).toBe(0);
  });

  it("weights by difficulty tier — a 1-guess, no-hint win equals the tier weight", () => {
    expect(gamePoints(true, 1, 1, 0)).toBe(60);
    expect(gamePoints(true, 5, 1, 0)).toBe(140);
    expect(gamePoints(true, 7, 1, 0)).toBe(180); // theoretical max
  });

  it("decays with guesses (tier 5, no hints)", () => {
    expect(gamePoints(true, 5, 1, 0)).toBe(140);
    expect(gamePoints(true, 5, 2, 0)).toBe(122);
    expect(gamePoints(true, 5, 3, 0)).toBe(108);
    expect(gamePoints(true, 5, 6, 0)).toBe(80);
  });

  it("escalates the hint penalty — retains 90/70/40/0% at 1/2/3/4 hints (tier 5, 1 guess)", () => {
    expect(gamePoints(true, 5, 1, 0)).toBe(140);
    expect(gamePoints(true, 5, 1, 1)).toBe(126);
    expect(gamePoints(true, 5, 1, 2)).toBe(98);
    expect(gamePoints(true, 5, 1, 3)).toBe(56);
    expect(gamePoints(true, 5, 1, 4)).toBe(0);
  });

  it("never returns a negative score", () => {
    for (let h = 0; h < 8; h++) expect(gamePoints(true, 7, 1, h)).toBeGreaterThanOrEqual(0);
    for (let g = 1; g < 40; g++) expect(gamePoints(true, 7, g, 0)).toBeGreaterThanOrEqual(0);
  });
});
