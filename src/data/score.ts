/** Per-game leaderboard points. MUST match public.game_points in schema.sql so
 *  the number a player sees/shares equals what the server ranks them on. */
export function gamePoints(won: boolean, tier: number, guesses: number, hints: number): number {
  if (!won) return 0;
  const weight = 40 + 20 * (tier || 1);
  const efficiency = 1 / (1 + 0.15 * Math.max(guesses - 1, 0));
  // Hints escalate: the marginal cost of hint n is 10n% (−10%, −20%, −30%, …),
  // so the first hint barely stings but leaning on them drops fast. Retained
  // value is 90/70/40/0% at 1/2/3/4 hints. Harsh, but softened at the first step.
  const hintFactor = Math.max(0, 1 - 0.05 * hints * (hints + 1));
  return Math.max(0, Math.round(weight * efficiency * hintFactor));
}
