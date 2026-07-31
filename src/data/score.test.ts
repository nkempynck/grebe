import { describe, it, expect } from "vitest";
import { gamePoints, kinshipPoints, branchesPoints, branchesAllowance } from "./score";

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

  it("no penalty when zero reveals are paid (4th arg is the PAID count)", () => {
    expect(kinshipPoints(true, 7, 0, 0)).toBe(160);
  });

  it("each PAID reveal deducts a flat 15% of the day's weight", () => {
    // tier 7 weight = 160; 15% = 24 per paid reveal.
    expect(kinshipPoints(true, 7, 0, 1)).toBe(136); // 160 − 24
    expect(kinshipPoints(true, 7, 0, 2)).toBe(112); // 160 − 48
    expect(kinshipPoints(true, 7, 0, 3)).toBe(88);  // 160 − 72
  });

  it("paid-reveal penalty stacks with mistakes", () => {
    expect(kinshipPoints(true, 7, 2, 1)).toBe(56); // 80 − 24
  });

  it("a win never scores zero — paid reveals floor at 10% of the day's weight", () => {
    // tier 1 weight = 100; the raw score goes negative, so a win floors at
    // 100×0.1 = 10 instead of collapsing to zero.
    expect(kinshipPoints(true, 1, 0, 9)).toBe(10);
    // Worst case still positive: max mistakes for a win (3) plus every peek paid.
    expect(kinshipPoints(true, 7, 3, 16)).toBe(16); // floor 160×0.1
    // A loss is still a flat zero, floor or not.
    expect(kinshipPoints(false, 7, 3, 16)).toBe(0);
  });
});

// branchesPoints(tier, won, total, correct, mistakes, hinted, peeked) MUST stay
// byte-identical to public.branches_game_points in supabase/branches.sql:
//   base = max(0, correct - hinted - 0.5*peeked) / total
//   win  = w * base * max(0, 1 - 0.35*mistakes), floored at 0.1*w while base > 0
//   loss = w * base * 0.35   (no floor)
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

  it("floors a win at 10% of the weight, but only while something was earned unaided", () => {
    expect(branchesPoints(1, true, 8, 8, 0, 7, 0)).toBe(13); // 100 * 1/8 = 12.5 -> 13, above the floor
    expect(branchesPoints(1, true, 8, 8, 1, 7, 0)).toBe(10); // 100 * 1/8 * 0.65 = 8.1 -> floored to 10
    expect(branchesPoints(1, true, 8, 8, 0, 8, 0)).toBe(0);  // every slot hinted -> no floor, no points
  });

  it("pays a losing (over-budget) board partial credit at 0.35, no floor", () => {
    expect(branchesPoints(1, false, 4, 3, 2, 0, 0)).toBe(26); // 100 * 0.75 * 0.35 = 26.25 -> 26
    expect(branchesPoints(1, false, 4, 0, 2, 0, 0)).toBe(0);  // nothing locked -> 0
    expect(branchesPoints(5, false, 6, 4, 3, 0, 0)).toBe(33); // 140 * (4/6) * 0.35 = 32.7 -> 33
  });

  // ---- invariants, over the board shapes Branches actually deals ----
  // Slots run MIN_GROUPS + round((tier-1)/6*3) = 4 (Mon) to 7 (Sat/Sun); see
  // core/branches.ts. These guard RELATIONSHIPS rather than values, so a future tweak
  // to a penalty can't quietly invert the incentives the way a changed constant would.
  const SLOTS = [4, 5, 5, 6, 6, 7, 7];
  const TIERS = [1, 2, 3, 4, 5, 6, 7];

  it("one honest mistake always out-scores looking the whole board up", () => {
    // Lookups saturate (`peeked` is clamped to the slot count), so peeking every slot
    // is a guaranteed win worth exactly half the weight, with no streak risk. A mistake
    // costing more than that would make reading the answers off Wikipedia the better
    // play than committing to a placement, which is the opposite of the game.
    for (const tier of TIERS) {
      const n = SLOTS[tier - 1];
      const lookEverythingUp = branchesPoints(tier, true, n, n, 0, 0, n);
      const oneMistake = branchesPoints(tier, true, n, n, 1, 0, 0);
      expect(oneMistake).toBeGreaterThan(lookEverythingUp);
    }
  });

  it("a max loss never out-scores the worst win, on every day", () => {
    // A loser locks at most slots-2: with slots-1 locked, the last tile is forced
    // correct by elimination, so it can't be got wrong.
    for (const tier of TIERS) {
      const n = SLOTS[tier - 1];
      const budget = branchesAllowance(tier);
      const worstWin = branchesPoints(tier, true, n, n, budget, 0, 0);
      const maxLoss = branchesPoints(tier, false, n, n - 2, budget + 1, 0, 0);
      expect(maxLoss).toBeLessThan(worstWin);
    }
  });

  it("a fully hinted win scores nothing, so it can't be used to protect a streak", () => {
    for (const tier of TIERS) {
      const n = SLOTS[tier - 1];
      expect(branchesPoints(tier, true, n, n, 0, n, 0)).toBe(0);
    }
  });
});
