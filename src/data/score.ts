/** The day's difficulty weight (its leaderboard point base), shared by all three
 *  games so scores are comparable: harder weekdays are worth a little more, but the
 *  spread is deliberately gentle — round values 100 (Mon) → 160 (Sun) in steps of 10,
 *  ~1.6×. Difficulty is carried mostly by the play itself (e.g. Kinship's reveal mode),
 *  not the payout, so a hard day rewards more without making easy days feel pointless. */
export function tierWeight(tier: number): number {
  return 90 + 10 * (tier || 1);
}

/** Guess-efficiency denominator: score is weight/guessDenom(guesses), n = guesses-1.
 *  Was a plain `1 + 0.15n`, which charged MOST for your opening guess (13.0%) and
 *  least for your twentieth (3.7%) — backwards. Your first guess is made blind, with
 *  nothing on the board to reason from; a mistake once you know the direction is the
 *  culpable one. This is the same line with a discount that FADES as you go deeper:
 *
 *      1 + 0.15n - 0.15·n/(n+1)  ==  1 + 0.15·n²/(n+1)
 *
 *  The opening guess drops to 7.0% while everything from the third on costs a shade
 *  MORE than it used to (9.6% vs 9.4% at guess 4, 6.7% vs 6.4% at guess 9). No score
 *  is lower than the old curve's at any depth — the discount is always ≥ 0 — so this
 *  cost no player anything on the day it shipped.
 *
 *  WHY SO MILD: a curve that really punishes late mistakes has to take points off
 *  long boards, and the population average among SOLVED dailies was 9.1 guesses with
 *  hard days averaging 16-17 (leaderboard_standing, 2026-08-04, 13 days / 17 players).
 *  Those are days everyone found hard, not days everyone got sloppy, so the steeper
 *  variants were docking the wrong players. Solving in 10 when the field averages 15
 *  IS impressive, but no guess curve can know that — it only sees your count. Doing
 *  that properly needs the day's realised difficulty, which doesn't exist until the
 *  day closes, and points are frozen at submit time. Left as separate work.
 *
 *  MONOTONE BY CONSTRUCTION: using 0.15 for both the slope and the discount collapses
 *  to n²/(n+1), whose derivative (n²+2n)/(n+1)² is ≥ 0 everywhere and which is exactly
 *  1 at n=0. A 1-guess no-hint win therefore pays the day's weight and nothing pays
 *  more. Pick a discount ABOVE the slope (0.155 was tried) and D dips below 1 between
 *  n=0 and n=1, i.e. >100% of the day, saved only by n always being an integer. */
const GUESS_SLOPE = 0.15;
function guessDenom(guesses: number): number {
  const n = Math.max(guesses - 1, 0);
  return 1 + (GUESS_SLOPE * n * n) / (n + 1);
}

/** Lineage per-game leaderboard points. MUST match public.game_points in
 *  schema.sql so the number a player sees/shares equals what the server ranks
 *  them on. */
export function gamePoints(won: boolean, tier: number, guesses: number, hints: number): number {
  if (!won) return 0;
  const weight = tierWeight(tier);
  const efficiency = 1 / guessDenom(guesses);
  // Hints cost 20% of the day's base, then 30%: retained value 80/50% at 1/2.
  // Priced off a WRONG GUESS, which peaks at 10.8% around the seventh (see
  // guessDenom). A hint always reveals a strictly deeper named clade where a guess
  // can land nowhere new, so it has to cost more than the guesses it saves. 20%
  // is ~2 guesses through the informed middle and more at the opening. Note guesses
  // never stack linearly: two from a standing start cost 13.0% together, not the
  // 13.5% you get by adding their marginals, so count with guessDenom, not sums.
  //
  // LINEAGE_MAX_HINTS caps this at two. The curve deliberately KEEPS FALLING past
  // the cap (10% at three, 0 at four) rather than flattening: the cap lives in the
  // client, but submit_game() derives the count from the posted hint_ids array, so
  // a tampered client claiming a third hint scores itself down instead of paying
  // the same as the second. Don't "simplify" this to a two-entry table.
  const hintFactor = Math.max(0, 1 - 0.05 * hints * (hints + 3));
  return Math.max(0, Math.round(weight * efficiency * hintFactor));
}

/** Hints a Lineage board will hand out. Two, because a third would leave a player
 *  10% of the day — not a choice, just a slower way to concede. Hints only ever
 *  reveal ANCESTORS of the answer (see hintLineage in useGame), never the answer,
 *  so capping them needs no zero-score backstop: the winning guess is always the
 *  player's. */
export const LINEAGE_MAX_HINTS = 2;

/** What one more hint would cost RIGHT NOW, for the live note under the hint button:
 *  `now` is the best score still reachable (you win on your very next guess), `after`
 *  the same once the hint is spent. Routed through gamePoints so the number a player
 *  is shown before spending can't drift from the one they're scored on. */
export function hintCost(tier: number, guesses: number, hints: number): { now: number; after: number; cost: number } {
  const now = gamePoints(true, tier, guesses + 1, hints);
  const after = gamePoints(true, tier, guesses + 1, hints + 1);
  return { now, after, cost: now - after };
}

/** Free Kinship picture/name reveals to START with. The free budget then grows by
 *  one for every group solved (earned as you play, spent in order).
 *
 *  The picture-only weekend gets one more. Difficulty there IS the hidden information —
 *  a name is the only way to reason about a species you cannot recognise on sight — so the
 *  days that need reveals most were the days they cost most (the day's weight is highest
 *  too). Not sent to the server: the client nets the free budget into `paid`, so this can
 *  change without a migration. */
export const KINSHIP_FREE_REVEALS = 3;
export const KINSHIP_FREE_REVEALS_PICTURE = 4;
export const kinshipFreeReveals = (tier: number): number =>
  tier >= 6 ? KINSHIP_FREE_REVEALS_PICTURE : KINSHIP_FREE_REVEALS;

/** Each reveal past the free ones deducts this fraction of the day's weight — a
 *  flat, consistent cost (never ends the board). Scored SEPARATELY from mistakes
 *  (they're a whole 25% step; reveals are gentler), so grid_games carries its own
 *  `reveals` column and public.grid_game_points takes it as a 4th argument.
 *
 *  Was 0.15, which made reveals unaffordable exactly where they are the point: six paid
 *  peeks on a Sunday took 160 points to the 16-point floor, so a player who could not
 *  recognise the species had no usable way in. At 0.10, four peeks keep 96 of 160 rather
 *  than 64. Revealing the WHOLE board while solving as you go still floors on Thu/Fri
 *  (nine paid × 10% is the entire day) but stays above it on Sat/Sun, which is where the
 *  fourth free peek goes.
 *  MUST match public.grid_game_points() — see supabase/kinship-reveals-2026-08-14.sql. */
export const KINSHIP_REVEAL_PENALTY = 0.1;

/** A win never scores zero: solving all four groups floors at this fraction of the
 *  day's weight, however many reveals were burned. (Reveals can otherwise deduct
 *  more than the whole board — flipping all sixteen tiles used to leave nothing.)
 *
 *  Lowered 0.10 -> 0.05 alongside the cheaper reveals: with a peek at 10% of the
 *  weight, a floor at 10% meant the last few peeks were free, since the score had
 *  already bottomed out. A lower floor keeps every reveal costing something while
 *  still refusing to score a solved board at zero. */
export const KINSHIP_WIN_FLOOR = 0.05;

/** Kinship (grid) per-game points: the day's weight scaled down by mistakes, minus
 *  a flat penalty per PAID reveal, zero for a loss. Four mistakes ends the board (a
 *  loss), so a win carries 0–3 mistakes → 100/75/50/25% of the weight; each paid
 *  reveal then shaves another 10% of the weight, down to a small floor a win always
 *  keeps. The 4th arg is the count of PAID reveals — the caller decides which reveals
 *  were free: KINSHIP_FREE_REVEALS to start plus one earned per group solved, spent
 *  in order (a peek already paid for stays paid; see useGridGame). MUST match the
 *  scoring in public.submit_grid_game() in supabase/kinship.sql. */
export function kinshipPoints(won: boolean, tier: number, mistakes: number, paidReveals = 0): number {
  if (!won) return 0;
  const w = tierWeight(tier);
  const m = Math.min(Math.max(mistakes, 0), 4);
  const paid = Math.max(0, paidReveals);
  const raw = w * (1 - m / 4) - w * KINSHIP_REVEAL_PENALTY * paid;
  return Math.max(Math.round(w * KINSHIP_WIN_FLOOR), Math.round(raw));
}

/** Wrong placements Branches forgives before the board is lost: one on the gentle
 *  half (Mon/Tue/Wed, tier ≤ 3), two on the hard half (Thu–Sun). Finishing WITHIN
 *  this budget still wins — just for far fewer points; going over ends the board as
 *  a loss. Keyed on the weekday tier so it matches the difficulty ramp. */
export function branchesAllowance(tier: number): number {
  return (tier || 1) <= 3 ? 1 : 2;
}

/** Fraction of the day's weight each surviving mistake burns off a Branches WIN.
 *  Steepish on purpose (a mistake-board should sting) but a shade gentler than a
 *  hard wipe: 1 mistake → 65% of the weight, 2 → 30%. */
export const BRANCHES_MISTAKE_PENALTY = 0.35;

/** A Branches WIN that earned SOMETHING unaided floors at this fraction of the day's
 *  weight, however many mistakes or hints were spent.
 *
 *  A win with NO unaided credit at all (every slot hinted) gets no floor and scores
 *  zero. With one, hinting the board out was the safe play on a day you couldn't
 *  crack: a guaranteed win, a guaranteed 10–16 points, and above all a preserved
 *  streak, against the risk of nothing and a broken streak for playing it honestly. */
export const BRANCHES_WIN_FLOOR = 0.1;

/** Hints a Branches board allows. ONE: enough to get past a slot you can't see, not
 *  enough to hint the board out. The scoring already pays nothing for an all-hinted
 *  win, but a streak counts days WON and never reads the points, so without a cap
 *  the hint doubles as a guaranteed streak-saver. A cap is the only thing that
 *  closes that; the score can't. */
export const BRANCHES_MAX_HINTS = 1;

/** Going OVER the mistake budget ends the board as a loss, but it isn't a hard 0:
 *  the slots you did lock still score, at this heavy discount. A blown board with
 *  nothing locked is still 0. A loser locks at most (slots−2)/slots (≤ 5/7 on the
 *  biggest boards), so at 0.35 a max loss pays under the worst (2-mistake) win for
 *  normal no-hint play — a winner always has base 1. */
export const BRANCHES_LOSS_FACTOR = 0.35;

/** Branches per-game points, scaled by the day's weight. Help is charged against
 *  the locked slots first — a hinted slot forfeits its whole share, a peeked slot
 *  half (the summary may not even name the family) — giving a help-adjusted
 *  fraction `base = max(0, correct − hinted − ½·peeked) / total`. Then:
 *   • a WIN (every slot placed within budget) pays `w · base · (1 − 0.35·mistakes)`,
 *     never below BRANCHES_WIN_FLOOR of the weight — unless `base` is 0, i.e. every
 *     slot was hinted, which pays nothing at all;
 *   • a LOSS (over budget) pays `w · base · BRANCHES_LOSS_FACTOR` for whatever was
 *     locked before the board ended — no floor, so locking nothing is 0.
 *  For normal no-hint play a win always out-scores a loss (a winner has base 1; a
 *  loser locks at most (slots−2)/slots, and 0.35 keeps that under the worst win).
 *  MUST match public.branches_game_points in supabase/branches.sql. */
export function branchesPoints(
  tier: number,
  won: boolean,
  total: number,
  correct: number,
  mistakes: number,
  hinted: number,
  peeked: number
): number {
  if (total <= 0) return 0;
  const w = tierWeight(tier);
  const help = Math.max(0, hinted + 0.5 * peeked);
  const base = Math.max(0, correct - help) / total;
  if (won) {
    const mistakeFactor = Math.max(0, 1 - BRANCHES_MISTAKE_PENALTY * Math.max(0, mistakes));
    const raw = Math.round(w * base * mistakeFactor);
    // The floor rewards a board that was actually played, so it needs something earned
    // unaided to stand on. With no such credit there is nothing to floor: an all-hinted
    // win pays zero rather than a free tenth of the weight.
    return base > 0 ? Math.max(Math.round(w * BRANCHES_WIN_FLOOR), raw) : raw;
  }
  return Math.round(w * base * BRANCHES_LOSS_FACTOR);
}

/** Share of the day a win at the very last guess still pays. */
export const MOSAIC_WIN_FLOOR = 0.1;

/** Mosaic per-game leaderboard points. MUST match public.game_points in schema.sql once Mosaic
 *  is scored server-side, so the number a player sees equals what the server ranks them on.
 *
 *  PENALTIES GROW. Guess k costs k-1 units, so the whole ladder is 1+2+…+(G-1) units and one
 *  unit is (1-floor)/that. On Monday's eight guesses the costs run 3, 6, 10, 13, 16, 19, 22 —
 *  a first guess pays the whole day, the last pays a tenth, and the pain is at the end.
 *
 *  WHY THAT WAY ROUND. The opening guess is made against four hundred shuffled tiles with
 *  nothing on the board to reason from, and the one after it barely less blind; being wrong
 *  there is not a mistake, it is the game. By the sixth the picture is most of the way back and
 *  a wrong answer is genuinely careless. Two shapes were tried and rejected: a uniform decay,
 *  which charged 28% for the second guess and so punished the blindest part of the board
 *  hardest; and a curve tracking the tile count, which was worse still (100 → 60 → 36) and left
 *  the whole back half of a board paying scraps.
 *
 *  It generalises over G, so a day that deals more guesses spreads the same 90% across more of
 *  them and every guess costs proportionally less — which is what makes a longer, slower ladder
 *  a REWARD for a harder picture rather than just more chances.
 *
 *  Past the cap it keeps falling to zero rather than flattening, the same way Lineage's hint
 *  curve does: the limit lives in the client, so a tampered count has to score itself down. */
export function mosaicPoints(
  tier: number,
  won: boolean,
  guesses: number,
  maxGuesses: number
): number {
  if (!won) return 0;
  const G = Math.max(2, Math.round(maxGuesses));
  const k = Math.max(1, Math.round(guesses));
  const spent = ((k - 1) * k) / ((G - 1) * G);
  return Math.max(0, Math.round(tierWeight(tier) * (1 - (1 - MOSAIC_WIN_FLOOR) * spent)));
}
