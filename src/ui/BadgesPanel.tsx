import { useEffect, useState } from "react";
import type { DerivedStats } from "../data/stats";
import type { UsePlayer } from "../hooks/usePlayer";
import { fetchPlayerBadges } from "../data/games";
import { competitiveBadges, localBadges, nextPlayMilestone, type Badge, type PlayerBadges } from "../data/badges";

interface Props {
  stats: DerivedStats;
  player: UsePlayer;
}

export function BadgesPanel({ stats, player }: Props) {
  const [server, setServer] = useState<PlayerBadges | null>(null);

  useEffect(() => {
    if (!player.session) { setServer(null); return; }
    let live = true;
    fetchPlayerBadges().then((b) => { if (live) setServer(b); });
    return () => { live = false; };
  }, [player.session]);

  const badges: Badge[] = [...competitiveBadges(server), ...localBadges(stats)];
  const nextUp = nextPlayMilestone(stats);

  return (
    <div className="stats badges">
      <div className="stats-sub">Badges</div>
      {badges.length === 0 ? (
        <p className="stats-empty">
          No badges yet. Complete puzzles, build a streak, and climb the leaderboard to earn them.
        </p>
      ) : (
        <div className="badge-grid">
          {badges.map((b) => (
            <div className={`badge badge-${b.tier}`} key={b.id} title={b.desc}>
              <span className="badge-ico" aria-hidden="true">{b.icon}</span>
              <span className="badge-label">{b.label}</span>
            </div>
          ))}
        </div>
      )}
      {nextUp && (
        <p className="badge-next">
          {nextUp.remaining} more {nextUp.remaining === 1 ? "puzzle" : "puzzles"} → <b>{nextUp.label}</b>
        </p>
      )}
      {!player.session && (
        <p className="badge-note">Sign in to also earn daily-winner and leaderboard-ranking badges.</p>
      )}
    </div>
  );
}
