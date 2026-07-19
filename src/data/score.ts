/** The day's difficulty weight (its leaderboard point base), shared by all three
 *  games so scores are comparable: harder weekdays are worth a little more, but the
 *  spread is deliberately gentle — round values 100 (Mon) → 160 (Sun) in steps of 10,
 *  ~1.6×. Difficulty is carried mostly by the play itself (e.g. Kinship's reveal mode),
 *  not the payout, so a hard day rewards more without making easy days feel pointless. */
export function tierWeight(tier: number): number {
  return 90 + 10 * (tier || 1);
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

/** Free Kinship picture/name reveals before any score penalty kicks in. */
export const KINSHIP_FREE_REVEALS = 3;

/** Each reveal past the free ones deducts this fraction of the day's weight — a
 *  flat, consistent cost (never ends the board). Scored SEPARATELY from mistakes
 *  (they're a whole 25% step; reveals are gentler), so grid_games carries its own
 *  `reveals` column and public.grid_game_points takes it as a 4th argument. */
export const KINSHIP_REVEAL_PENALTY = 0.15;

/** A win never scores zero: solving all four groups floors at this fraction of the
 *  day's weight, however many reveals were burned. (Reveals can otherwise deduct
 *  more than the whole board — flipping all sixteen tiles used to leave nothing.) */
export const KINSHIP_WIN_FLOOR = 0.1;

/** Kinship (grid) per-game points: the day's weight scaled down by mistakes, minus
 *  a flat penalty per reveal past the free three, zero for a loss. Four mistakes
 *  ends the board (a loss), so a win carries 0–3 mistakes → 100/75/50/25% of the
 *  weight; each paid reveal then shaves another 15% of the weight, down to a small
 *  floor a win always keeps. MUST match public.grid_game_points(won, tier, mistakes,
 *  reveals) in supabase/kinship.sql. */
export function kinshipPoints(won: boolean, tier: number, mistakes: number, reveals = 0): number {
  if (!won) return 0;
  const w = tierWeight(tier);
  const m = Math.min(Math.max(mistakes, 0), 4);
  const paid = Math.max(0, reveals - KINSHIP_FREE_REVEALS);
  const raw = w * (1 - m / 4) - w * KINSHIP_REVEAL_PENALTY * paid;
  return Math.max(Math.round(w * KINSHIP_WIN_FLOOR), Math.round(raw));
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
