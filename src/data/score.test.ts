import { describe, it, expect } from "vitest";
import { gamePoints, kinshipPoints, branchesPoints, branchesAllowance, tierWeight, mosaicPoints, BRANCHES_MAX_HINTS, kinshipFreeReveals } from "./score";

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
    expect(gamePoints(true, 5, 2, 0)).toBe(130);
    expect(gamePoints(true, 5, 3, 0)).toBe(117);
    expect(gamePoints(true, 5, 6, 0)).toBe(86);
    // Never rises. Only STRICTLY falls out to 20 guesses: past there the curve
    // decays by under a point per guess, so rounding makes neighbours tie.
    for (let g = 2; g < 40; g++) {
      expect(gamePoints(true, 5, g, 0)).toBeLessThanOrEqual(gamePoints(true, 5, g - 1, 0));
    }
    for (let g = 2; g <= 20; g++) {
      expect(gamePoints(true, 5, g, 0)).toBeLessThan(gamePoints(true, 5, g - 1, 0));
    }
  });

  // The defect this curve exists to fix: the OPENING guess used to be the single
  // most expensive one on the board (13%), despite being the only one made blind.
  // It must now be the cheapest, and the cost must peak after it, not at it.
  it("makes the blind opening guess the cheapest on the board", () => {
    const cost = (g: number) => 1 - gamePoints(true, 7, g + 1, 0) / gamePoints(true, 7, g, 0);
    for (let g = 2; g <= 6; g++) expect(cost(1)).toBeLessThan(cost(g));
  });

  // No player may score LESS than the pre-2026-08-04 curve at any depth: the change
  // shipped mid-life, and the whole reason this shape was chosen over the steeper
  // candidates is that it takes nothing away from anyone. Equality only at 1 guess.
  it("never pays less than the original 1 + 0.15n curve", () => {
    const legacy = (g: number) => Math.round(140 / (1 + 0.15 * (g - 1)));
    expect(gamePoints(true, 5, 1, 0)).toBe(legacy(1));
    for (let g = 2; g < 40; g++) {
      expect(gamePoints(true, 5, g, 0)).toBeGreaterThanOrEqual(legacy(g));
    }
  });

  // A 1-guess no-hint win pays the day's weight EXACTLY — never more. Holds by
  // construction because n²/(n+1) is 0 at n=0 and rises from there; a discount
  // coefficient above GUESS_SLOPE would break it (see guessDenom).
  it("caps a perfect win at exactly the day's weight", () => {
    for (let t = 1; t <= 7; t++) {
      expect(gamePoints(true, t, 1, 0)).toBe(tierWeight(t));
      for (let g = 1; g < 30; g++) expect(gamePoints(true, t, g, 0)).toBeLessThanOrEqual(tierWeight(t));
    }
  });

  it("charges 20% then 30% for hints — retains 80/50% at 1/2 (tier 5, 1 guess)", () => {
    expect(gamePoints(true, 5, 1, 0)).toBe(140);
    expect(gamePoints(true, 5, 1, 1)).toBe(112);
    expect(gamePoints(true, 5, 1, 2)).toBe(70);
  });

  // The two-hint cap is CLIENT-side (LINEAGE_MAX_HINTS), while submit_game() derives
  // the count from the posted hint_ids array. So the curve has to keep falling past
  // the cap, or a tampered client claiming a third hint would pay the second's price.
  it("keeps falling past the two-hint cap, so extra hints can't be free", () => {
    expect(gamePoints(true, 5, 1, 3)).toBe(14);
    expect(gamePoints(true, 5, 1, 4)).toBe(0);
    // Strictly down until it bottoms out at four, then pinned to zero — never back up.
    for (let h = 1; h <= 4; h++) {
      expect(gamePoints(true, 5, 1, h)).toBeLessThan(gamePoints(true, 5, 1, h - 1));
    }
    for (let h = 5; h < 12; h++) expect(gamePoints(true, 5, 1, h)).toBe(0);
  });

  // The change that motivated the retune: hinting used to be cheaper than an opening
  // wrong guess despite revealing strictly better information, so the point-optimal
  // first move was to hint. A hint must now cost more than the guess it replaces.
  it("prices a hint above a wrong guess at the opening", () => {
    const perfect = gamePoints(true, 5, 1, 0);            // win first guess, no help
    const afterOneWrongGuess = gamePoints(true, 5, 2, 0); // win second guess
    const afterOneHint = gamePoints(true, 5, 1, 1);       // win first guess, one hint
    expect(afterOneHint).toBeLessThan(afterOneWrongGuess);
    expect(perfect - afterOneHint).toBeGreaterThan(perfect - afterOneWrongGuess);
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

  it("each PAID reveal deducts a flat 10% of the day's weight", () => {
    // tier 7 weight = 160; 10% = 16 per paid reveal.
    expect(kinshipPoints(true, 7, 0, 1)).toBe(144); // 160 − 16
    expect(kinshipPoints(true, 7, 0, 2)).toBe(128); // 160 − 32
    expect(kinshipPoints(true, 7, 0, 3)).toBe(112); // 160 − 48
  });

  it("paid-reveal penalty stacks with mistakes", () => {
    expect(kinshipPoints(true, 7, 2, 1)).toBe(64); // 80 − 16
  });

  it("the picture-only weekend starts with one more free reveal", () => {
    // Names are hidden Sat/Sun, so a reveal is the only way into a species you cannot
    // recognise by sight — and those are also the highest-weight days.
    expect(kinshipFreeReveals(1)).toBe(3);
    expect(kinshipFreeReveals(5)).toBe(3);
    expect(kinshipFreeReveals(6)).toBe(4);
    expect(kinshipFreeReveals(7)).toBe(4);
  });

  it("revealing the whole board, solving as you go, clears the floor on Sat/Sun", () => {
    // 16 tiles, 4 free to start plus 4 earned one per solved group → 8 paid.
    expect(kinshipPoints(true, 7, 0, 8)).toBe(32); // 160 − 128, well clear of the 8 floor
    // Thu/Fri start with 3 free, so the same play lands 9 paid.
    expect(kinshipPoints(true, 4, 0, 9)).toBe(13); // 130 − 117, floor is 130×0.05 = 7
  });

  it("a win never scores zero — paid reveals floor at 5% of the day's weight", () => {
    // tier 1 weight = 100; the raw score goes negative, so a win floors at
    // 100×0.05 = 5 instead of collapsing to zero.
    expect(kinshipPoints(true, 1, 0, 12)).toBe(5);
    // Worst case still positive: max mistakes for a win (3) plus every peek paid.
    expect(kinshipPoints(true, 7, 3, 16)).toBe(8); // floor 160×0.05
    // A loss is still a flat zero, floor or not.
    expect(kinshipPoints(false, 7, 3, 16)).toBe(0);
    // The floor must sit BELOW the reveal price, or the last peeks are free: at
    // tier 7 a peek costs 16, so the score must still be moving at 9 paid reveals.
    expect(kinshipPoints(true, 7, 0, 9)).toBeGreaterThan(kinshipPoints(true, 7, 0, 10));
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
  // These guard RELATIONSHIPS rather than values, so a future tweak to a penalty can't
  // quietly invert the incentives the way a changed constant would.
  //
  // Slot count is min(eligible groups, MIN_GROUPS + round((tier-1)/6*3)) — see
  // slotCount() in core/branches.ts — so the tier sets a CEILING of 4 (Mon) to 7
  // (Sat/Sun), and a thin container legitimately gives fewer, never below MIN_GROUPS.
  // A tier-5 Friday board of 4 slots is a real board. So every invariant is checked
  // across the whole range a day can produce, not just its ceiling.
  const CEILING = [4, 5, 5, 6, 6, 7, 7];
  const TIERS = [1, 2, 3, 4, 5, 6, 7];
  const boards = () =>
    TIERS.flatMap((tier) => {
      const sizes: number[] = [];
      for (let n = 4; n <= CEILING[tier - 1]; n++) sizes.push(n);
      return sizes.map((n) => ({ tier, n }));
    });

  it("one honest mistake always out-scores looking the whole board up", () => {
    // Lookups saturate (`peeked` is clamped to the slot count), so peeking every slot
    // is a guaranteed win worth exactly half the weight, with no streak risk. A mistake
    // costing more than that would make reading the answers off Wikipedia the better
    // play than committing to a placement, which is the opposite of the game.
    for (const { tier, n } of boards()) {
      const lookEverythingUp = branchesPoints(tier, true, n, n, 0, 0, n);
      const oneMistake = branchesPoints(tier, true, n, n, 1, 0, 0);
      expect(oneMistake).toBeGreaterThan(lookEverythingUp);
    }
  });

  it("a max loss never out-scores the worst win, on every day", () => {
    // A loser locks at most slots-2: with slots-1 locked, the last tile is forced
    // correct by elimination, so it can't be got wrong.
    for (const { tier, n } of boards()) {
      const budget = branchesAllowance(tier);
      const worstWin = branchesPoints(tier, true, n, n, budget, 0, 0);
      const maxLoss = branchesPoints(tier, false, n, n - 2, budget + 1, 0, 0);
      expect(maxLoss).toBeLessThan(worstWin);
    }
  });

  it("a fully hinted win scores nothing", () => {
    for (const { tier, n } of boards()) {
      expect(branchesPoints(tier, true, n, n, 0, n, 0)).toBe(0);
    }
  });

  it("the hint cap, not the score, is what stops a hinted-out streak save", () => {
    // Zero points doesn't protect a streak from anything: a streak counts days WON
    // and never reads the score. Only the per-board cap makes hinting the whole
    // board impossible, so it has to stay below the smallest board.
    const smallestBoard = Math.min(...boards().map((b) => b.n));
    expect(BRANCHES_MAX_HINTS).toBeLessThan(smallestBoard);
    for (const { tier, n } of boards()) {
      // The most a capped board can be helped still leaves real credit to score on.
      expect(branchesPoints(tier, true, n, n, 0, BRANCHES_MAX_HINTS, 0)).toBeGreaterThan(0);
    }
  });
});

describe("mosaicPoints", () => {
  const MON = 1, SUN = 7;

  it("pays the whole day for a first-guess win and a tenth for the last", () => {
    expect(mosaicPoints(MON, true, 1, 8)).toBe(100);
    expect(mosaicPoints(MON, true, 8, 8)).toBe(10);
    expect(mosaicPoints(SUN, true, 1, 8)).toBe(160);
    expect(mosaicPoints(SUN, true, 8, 8)).toBe(16);
  });

  it("is the agreed Monday curve", () => {
    const row = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => mosaicPoints(MON, true, k, 8));
    expect(row).toEqual([100, 97, 90, 81, 68, 52, 32, 10]);
  });

  // The whole point of the shape: being wrong against 400 shuffled tiles is the game, being
  // wrong once the picture is nearly back is careless, so the cost has to grow.
  it("charges less early than late, strictly", () => {
    const row = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => mosaicPoints(MON, true, k, 8));
    const costs = row.slice(1).map((v, i) => row[i] - v);
    for (let i = 1; i < costs.length; i++) expect(costs[i]).toBeGreaterThan(costs[i - 1]);
  });

  it("never rises with an extra guess", () => {
    for (const G of [8, 10, 12]) {
      for (let k = 2; k <= G; k++) {
        expect(mosaicPoints(MON, true, k, G)).toBeLessThanOrEqual(mosaicPoints(MON, true, k - 1, G));
      }
    }
  });

  // A longer ladder is a harder picture, so the same guess number has to be worth MORE there,
  // otherwise dealing more guesses would just be a bigger stick.
  it("pays the same guess better on a day that deals more of them", () => {
    for (let k = 2; k <= 8; k++) {
      expect(mosaicPoints(MON, true, k, 12)).toBeGreaterThan(mosaicPoints(MON, true, k, 8));
    }
  });

  it("scores a loss at nothing, and a tampered guess count at nothing", () => {
    expect(mosaicPoints(MON, false, 1, 8)).toBe(0);
    expect(mosaicPoints(MON, true, 99, 8)).toBe(0);
  });
});
