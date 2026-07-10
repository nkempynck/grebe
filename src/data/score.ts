/** Per-game leaderboard points. MUST match public.game_points in schema.sql so
 *  the number a player sees/shares equals what the server ranks them on. */
export function gamePoints(won: boolean, tier: number, guesses: number, hints: number): number {
  if (!won) return 0;
  const weight = 40 + 20 * (tier || 1);
  const efficiency = 1 / (1 + 0.15 * Math.max(guesses - 1, 0));
  const hintFactor = Math.max(0, 1 - 0.34 * hints);
  return Math.max(0, Math.round(weight * efficiency * hintFactor));
}
