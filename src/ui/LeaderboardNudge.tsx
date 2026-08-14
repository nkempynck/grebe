/** A neutral footer shown when the player is signed out (but a backend exists).
 *  One shared component so every game says the same thing the same way.
 *
 *  "record" sits under the post-game share block: an account is what puts a score
 *  on the leaderboard. "browse" stands in for the filterable board on the
 *  leaderboard tab, where a signed-out visitor gets today's board only. */
export function LeaderboardNudge({ show, kind = "record" }: { show: boolean; kind?: "record" | "browse" }) {
  if (!show) return null;
  return (
    <p className="lb-nudge">
      {kind === "browse"
        ? "Play with an account to browse past days, weeks and months."
        : "Play with an account to record your score on the leaderboard."}
    </p>
  );
}
