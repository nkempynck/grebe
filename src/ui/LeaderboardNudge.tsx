/** A neutral footer shown under the post-game share block when the player is
 *  signed out (but a backend exists). One shared component so every game says the
 *  same thing the same way: an account is what puts a score on the leaderboard. */
export function LeaderboardNudge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="lb-nudge">
      Play with an account to record your score on the leaderboard.
    </p>
  );
}
