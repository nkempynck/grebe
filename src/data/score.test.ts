import { describe, it, expect } from "vitest";
import { gamePoints, kinshipPoints, branchesPoints } from "./score";

// GOLDEN scoring values. gamePoints() MUST stay byte-identical to
// public.game_points in supabase/schema.sql — if you change the formula here,
// change it THERE too (and update these expectations). This suite is the
// tripwire that catches a silent client/SQL scoring drift.
// Day weight = 100 + 12·tier (tier 1 = 112 … tier 7 = 184), a deliberately gentle
// ~1.5× spread — difficulty lives in the play, not the payout.
describe("gamePoints", () => {
  it("is zero for a loss, regardless of other inputs", () => {
    expect(gamePoints(false, 7, 1, 0)).toBe(0);
    expect(gamePoints(false, 1, 10, 3)).toBe(0);
  });

  it("weights by difficulty tier — a 1-guess, no-hint win equals the tier weight", () => {
    expect(gamePoints(true, 1, 1, 0)).toBe(112);
    expect(gamePoints(true, 5, 1, 0)).toBe(160);
    expect(gamePoints(true, 7, 1, 0)).toBe(184); // theoretical max
  });

  it("decays with guesses (tier 5, no hints)", () => {
    expect(gamePoints(true, 5, 1, 0)).toBe(160);
    expect(gamePoints(true, 5, 2, 0)).toBe(139);
    expect(gamePoints(true, 5, 3, 0)).toBe(123);
    expect(gamePoints(true, 5, 6, 0)).toBe(91);
  });

  it("escalates the hint penalty — retains 90/70/40/0% at 1/2/3/4 hints (tier 5, 1 guess)", () => {
    expect(gamePoints(true, 5, 1, 0)).toBe(160);
    expect(gamePoints(true, 5, 1, 1)).toBe(144);
    expect(gamePoints(true, 5, 1, 2)).toBe(112);
    expect(gamePoints(true, 5, 1, 3)).toBe(64);
    expect(gamePoints(true, 5, 1, 4)).toBe(0);
  });

  it("never returns a negative score", () => {
    for (let h = 0; h < 8; h++) expect(gamePoints(true, 7, 1, h)).toBeGreaterThanOrEqual(0);
    for (let g = 1; g < 40; g++) expect(gamePoints(true, 7, g, 0)).toBeGreaterThanOrEqual(0);
  });
});

// Kinship (grid) scoring. MUST stay identical to public.grid_game_points in
// supabase/kinship.sql.
describe("kinshipPoints", () => {
  it("is zero for a loss", () => {
    expect(kinshipPoints(false, 7, 0)).toBe(0);
    expect(kinshipPoints(false, 1, 3)).toBe(0);
  });

  it("is the full tier weight for a clean (0-mistake) win", () => {
    expect(kinshipPoints(true, 1, 0)).toBe(112);
    expect(kinshipPoints(true, 5, 0)).toBe(160);
    expect(kinshipPoints(true, 7, 0)).toBe(184);
  });

  it("scales down 100/75/50/25% by mistakes (tier 7)", () => {
    expect(kinshipPoints(true, 7, 0)).toBe(184);
    expect(kinshipPoints(true, 7, 1)).toBe(138);
    expect(kinshipPoints(true, 7, 2)).toBe(92);
    expect(kinshipPoints(true, 7, 3)).toBe(46);
  });

  it("the first three reveals are free", () => {
    expect(kinshipPoints(true, 7, 0, 0)).toBe(184);
    expect(kinshipPoints(true, 7, 0, 3)).toBe(184);
  });

  it("each reveal past the free three deducts a flat 15% of the day's weight", () => {
    // tier 7 weight = 184; 15% = 27.6 per paid reveal.
    expect(kinshipPoints(true, 7, 0, 4)).toBe(156); // 184 − 27.6
    expect(kinshipPoints(true, 7, 0, 5)).toBe(129); // 184 − 55.2
    expect(kinshipPoints(true, 7, 0, 6)).toBe(101); // 184 − 82.8
  });

  it("reveal penalty stacks with mistakes", () => {
    expect(kinshipPoints(true, 7, 2, 4)).toBe(64); // 92 − 27.6
  });

  it("a win never scores zero — reveals floor at 10% of the day's weight", () => {
    // tier 1 weight = 112; the raw score (112 − 9×15%×112) goes negative, so a win
    // floors at 112×0.1 ≈ 11 instead of collapsing to zero.
    expect(kinshipPoints(true, 1, 0, 12)).toBe(11);
    // Worst case still positive: max mistakes for a win (3) plus every tile flipped.
    expect(kinshipPoints(true, 7, 3, 16)).toBe(18); // floor 184×0.1 ≈ 18
    // A loss is still a flat zero, floor or not.
    expect(kinshipPoints(false, 7, 3, 16)).toBe(0);
  });
});

// branchesPoints() MUST stay byte-identical to public.branches_game_points in
// supabase/branches.sql: weight * max(0, correct - penalty) / total, rounded,
// floored at 0, where the client folds the SQL's (hinted + 0.5*peeked) into the
// single `penalty` argument at the call sites (BranchesGame.tsx, stats.ts).
describe("branchesPoints", () => {
  it("is zero for a blank/empty board (total <= 0)", () => {
    expect(branchesPoints(7, 0, 0, 0)).toBe(0);
    expect(branchesPoints(1, 0, 0, 0)).toBe(0);
  });

  it("is the full tier weight for a perfect, penalty-free board", () => {
    expect(branchesPoints(1, 8, 8, 0)).toBe(112);
    expect(branchesPoints(7, 10, 10, 0)).toBe(184);
  });

  it("scales by the fraction placed correctly", () => {
    expect(branchesPoints(5, 3, 6, 0)).toBe(80); // 160 * 3/6
    expect(branchesPoints(5, 1, 3, 0)).toBe(53); // 160 * 1/3 = 53.3 -> 53
  });

  it("docks a full point per hint and half per species peek", () => {
    expect(branchesPoints(5, 6, 6, 1)).toBe(133);   // 160 * 5/6  = 133.3 -> 133
    expect(branchesPoints(5, 6, 6, 0.5)).toBe(147);  // 160 * 5.5/6 = 146.7 -> 147
  });

  it("floors at zero when penalties exceed correct placements", () => {
    expect(branchesPoints(3, 2, 4, 3)).toBe(0);
  });
});
