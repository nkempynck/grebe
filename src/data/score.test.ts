import { describe, it, expect } from "vitest";
import { gamePoints, kinshipPoints, branchesPoints } from "./score";

// GOLDEN scoring values. gamePoints() MUST stay byte-identical to
// public.game_points in supabase/schema.sql — if you change the formula here,
// change it THERE too (and update these expectations). This suite is the
// tripwire that catches a silent client/SQL scoring drift.
// Day weight = 90 + 10·tier → round values 100 (tier 1) … 160 (tier 7), a gentle
// ~1.6× spread; difficulty lives in the play, not the payout.
describe("gamePoints", () => {
  it("is zero for a loss, regardless of other inputs", () => {
    expect(gamePoints(false, 7, 1, 0)).toBe(0);
    expect(gamePoints(false, 1, 10, 3)).toBe(0);
  });

  it("weights by difficulty tier — a 1-guess, no-hint win equals the tier weight", () => {
    expect(gamePoints(true, 1, 1, 0)).toBe(100);
    expect(gamePoints(true, 5, 1, 0)).toBe(140);
    expect(gamePoints(true, 7, 1, 0)).toBe(160); // theoretical max
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

// Kinship (grid) scoring. MUST stay identical to public.grid_game_points in
// supabase/kinship.sql.
describe("kinshipPoints", () => {
  it("is zero for a loss", () => {
    expect(kinshipPoints(false, 7, 0)).toBe(0);
    expect(kinshipPoints(false, 1, 3)).toBe(0);
  });

  it("is the full tier weight for a clean (0-mistake) win", () => {
    expect(kinshipPoints(true, 1, 0)).toBe(100);
    expect(kinshipPoints(true, 5, 0)).toBe(140);
    expect(kinshipPoints(true, 7, 0)).toBe(160);
  });

  it("scales down 100/75/50/25% by mistakes (tier 7)", () => {
    expect(kinshipPoints(true, 7, 0)).toBe(160);
    expect(kinshipPoints(true, 7, 1)).toBe(120);
    expect(kinshipPoints(true, 7, 2)).toBe(80);
    expect(kinshipPoints(true, 7, 3)).toBe(40);
  });

  it("the first three reveals are free", () => {
    expect(kinshipPoints(true, 7, 0, 0)).toBe(160);
    expect(kinshipPoints(true, 7, 0, 3)).toBe(160);
  });

  it("each reveal past the free three deducts a flat 15% of the day's weight", () => {
    // tier 7 weight = 160; 15% = 24 per paid reveal.
    expect(kinshipPoints(true, 7, 0, 4)).toBe(136); // 160 − 24
    expect(kinshipPoints(true, 7, 0, 5)).toBe(112); // 160 − 48
    expect(kinshipPoints(true, 7, 0, 6)).toBe(88);  // 160 − 72
  });

  it("reveal penalty stacks with mistakes", () => {
    expect(kinshipPoints(true, 7, 2, 4)).toBe(56); // 80 − 24
  });

  it("a win never scores zero — reveals floor at 10% of the day's weight", () => {
    // tier 1 weight = 100; the raw score goes negative, so a win floors at
    // 100×0.1 = 10 instead of collapsing to zero.
    expect(kinshipPoints(true, 1, 0, 12)).toBe(10);
    // Worst case still positive: max mistakes for a win (3) plus every tile flipped.
    expect(kinshipPoints(true, 7, 3, 16)).toBe(16); // floor 160×0.1
    // A loss is still a flat zero, floor or not.
    expect(kinshipPoints(false, 7, 3, 16)).toBe(0);
  });
});

// branchesPoints(tier, won, total, correct, mistakes, hinted, peeked) MUST stay
// byte-identical to public.branches_game_points in supabase/branches.sql:
//   base = max(0, correct - hinted - 0.5*peeked) / total
//   win  = max(0.1*w, w * base * max(0, 1 - 0.35*mistakes))
//   loss = w * base * 0.5   (no floor)
describe("branchesPoints", () => {
  it("is zero for a blank/empty board (total <= 0)", () => {
    expect(branchesPoints(7, true, 0, 0, 0, 0, 0)).toBe(0);
    expect(branchesPoints(1, false, 0, 0, 0, 0, 0)).toBe(0);
  });

  it("is the full tier weight for a clean, mistake-free win", () => {
    expect(branchesPoints(1, true, 8, 8, 0, 0, 0)).toBe(100);
    expect(branchesPoints(7, true, 10, 10, 0, 0, 0)).toBe(160);
  });

  it("docks 35% of the weight per surviving mistake on a win", () => {
    expect(branchesPoints(5, true, 6, 6, 1, 0, 0)).toBe(91); // 140 * 1 * 0.65
    expect(branchesPoints(5, true, 6, 6, 2, 0, 0)).toBe(42); // 140 * 1 * 0.30
  });

  it("docks a full point per hint and half per species peek", () => {
    expect(branchesPoints(5, true, 6, 6, 0, 1, 0)).toBe(117);  // 140 * 5/6   = 116.7 -> 117
    expect(branchesPoints(5, true, 6, 6, 0, 0, 1)).toBe(128);  // 140 * 5.5/6 = 128.3 -> 128
  });

  it("floors a win at 10% of the weight, never zero", () => {
    expect(branchesPoints(1, true, 8, 8, 0, 8, 0)).toBe(10); // base 0 -> win floor 100*0.1
  });

  it("pays a losing (over-budget) board partial credit at 0.35, no floor", () => {
    expect(branchesPoints(1, false, 4, 3, 2, 0, 0)).toBe(26); // 100 * 0.75 * 0.35 = 26.25 -> 26
    expect(branchesPoints(1, false, 4, 0, 2, 0, 0)).toBe(0);  // nothing locked -> 0
    expect(branchesPoints(5, false, 6, 4, 3, 0, 0)).toBe(33); // 140 * (4/6) * 0.35 = 32.7 -> 33
  });

  it("a loss never out-scores the worst (2-mistake) win at the same weight", () => {
    // Winner has base 1; a loser locks at most (slots-2)/slots. Check the tightest
    // days (7 slots, budget 2): max loss must stay under the 2-mistake win.
    for (const tier of [4, 5, 6, 7]) {
      const worstWin = branchesPoints(tier, true, 7, 7, 2, 0, 0);   // all correct, 2 mistakes
      const maxLoss = branchesPoints(tier, false, 7, 5, 3, 0, 0);   // locked 5/7, busted
      expect(maxLoss).toBeLessThan(worstWin);
    }
  });
});
