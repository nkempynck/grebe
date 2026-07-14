/** The day's difficulty weight (its leaderboard point base), shared by both
 *  games so scores are comparable: harder weekdays are worth more. */
export function tierWeight(tier: number): number {
  return 40 + 20 * (tier || 1);
}

/** Lineage per-game leaderboard points. MUST match public.game_points in
 *  schema.sql so the number a player sees/shares equals what the server ranks
 *  them on. */
export function gamePoints(won: boolean, tier: number, guesses: number, hints: number): number {
  if (!won) return 0;
  const weight = tierWeight(tier);
  const efficiency = 1 / (1 + 0.15 * Math.max(guesses - 1, 0));
  // Hints escalate: the marginal cost of hint n is 10n% (−10%, −20%, −30%, …),
  // so the first hint barely stings but leaning on them drops fast. Retained
  // value is 90/70/40/0% at 1/2/3/4 hints. Harsh, but softened at the first step.
  const hintFactor = Math.max(0, 1 - 0.05 * hints * (hints + 1));
  return Math.max(0, Math.round(weight * efficiency * hintFactor));
}

/** Kinship (grid) per-game points: the day's weight scaled down by mistakes,
 *  zero for a loss. Four mistakes ends the board (a loss), so a win carries 0–3
 *  mistakes → 100/75/50/25% of the weight. MUST match public.grid_game_points in
 *  supabase/kinship.sql. */
export function kinshipPoints(won: boolean, tier: number, mistakes: number): number {
  if (!won) return 0;
  const m = Math.min(Math.max(mistakes, 0), 4);
  return Math.max(0, Math.round(tierWeight(tier) * (1 - m / 4)));
}

/** Free Kinship picture reveals before any score penalty kicks in. */
export const KINSHIP_FREE_REVEALS = 3;

/** A picture peek is far gentler than a wrong guess: the first few are free, then
 *  every two further reveals cost one mistake's worth of score (never ending the
 *  board). Folded into the mistakes total that both the client and the server
 *  score on, so no separate leaderboard field is needed. */
export function kinshipRevealPenalty(reveals: number): number {
  return Math.floor(Math.max(0, reveals - KINSHIP_FREE_REVEALS) / 2);
}

/** Branches per-game points: partial credit for correctly-placed species, scaled
 *  by the day's weight. `penalty` is the help charged against the correct count —
 *  1 per hinted slot, ½ per peeked slot (a peek only hints, and the summary may
 *  not even name the family). MUST match public.branches_game_points in
 *  supabase/branches.sql. */
export function branchesPoints(tier: number, correct: number, total: number, penalty: number): number {
  if (total <= 0) return 0;
  const earned = Math.max(0, correct - Math.max(0, penalty));
  return Math.max(0, Math.round(tierWeight(tier) * (earned / total)));
}
