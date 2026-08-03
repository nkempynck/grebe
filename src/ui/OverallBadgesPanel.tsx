import { useEffect, useState } from "react";
import type { UsePlayer } from "../hooks/usePlayer";
import { fetchOverallBadges } from "../data/games";
import { overallBadges, type Badge } from "../data/badges";
import { BadgeGrid } from "./BadgeGrid";

interface Props {
  player: UsePlayer;
}

/** Overall (combined-board) badges: the 👑 daily-champion badge for topping the
 *  day's combined leaderboard across all three games. Its own Account panel so it
 *  isn't tied to any single game. */
export function OverallBadgesPanel({ player }: Props) {
  const [server, setServer] = useState<{ daily_wins: number; win_dates: string[] } | null>(null);

  useEffect(() => {
    if (!player.session) { setServer(null); return; }
    let live = true;
    fetchOverallBadges().then((b) => { if (live) setServer(b); });
    return () => { live = false; };
  }, [player.session]);

  const badges: Badge[] = overallBadges(server);

  return (
    <div className="stats badges">
      <div className="stats-sub">Overall badges</div>
      {badges.length === 0 ? (
        <p className="stats-empty">
          {player.session
            ? "No overall badge yet. Top the combined daily leaderboard (a finished day with ≥3 players) to earn the 👑."
            : "Sign in and top the combined daily leaderboard to earn the overall champion badge."}
        </p>
      ) : (
        <BadgeGrid badges={badges} />
      )}
    </div>
  );
}
