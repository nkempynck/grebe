import { useEffect, useState } from "react";
import type { DerivedStats } from "../data/stats";
import type { UsePlayer } from "../hooks/usePlayer";
import { fetchGameBadges, fetchGameStanding, type GameId, type GameStanding } from "../data/games";
import { competitiveBadges, lineageBadges, kinshipBadges, branchesBadges, nextPlayMilestone, type Badge, type PlayerBadges } from "../data/badges";
import { BadgeGrid } from "./BadgeGrid";

interface Props {
  stats: DerivedStats;
  player: UsePlayer;
  /** Which game's badges to show — each game gets its own panel. */
  game: GameId;
}

const LABEL: Record<GameId, string> = { lineage: "Lineage", kinship: "Kinship", branches: "Branches" };
const NOUN: Record<GameId, string> = { lineage: "puzzle", kinship: "board", branches: "board" };

export function BadgesPanel({ stats, player, game }: Props) {
  const [server, setServer] = useState<PlayerBadges | null>(null);
  // This game's all-time competitive standing (rank + score), shown per game so
  // each panel carries its own — the profile header no longer singles out Lineage.
  const [standing, setStanding] = useState<GameStanding | null>(null);

  useEffect(() => {
    if (!player.session) { setServer(null); setStanding(null); return; }
    let live = true;
    fetchGameBadges(game).then((b) => { if (live) setServer(b); });
    fetchGameStanding(game, "all").then((s) => { if (live) setStanding(s); });
    return () => { live = false; };
  }, [game, player.session]);

  // Local (streak/play/flawless) milestones per game, plus the server-side
  // competitive badges shared by all games.
  const local = game === "lineage" ? lineageBadges(stats) : game === "kinship" ? kinshipBadges(stats) : branchesBadges(stats);
  const badges: Badge[] = [...competitiveBadges(server), ...local];
  const noun = NOUN[game];
  const played = game === "lineage" ? stats.daily.played : game === "kinship" ? stats.kinship.played : stats.branches.played;
  const nextUp = nextPlayMilestone(played, noun);

  return (
    <div className="stats badges">
      <div className="stats-sub">{LABEL[game]} badges</div>
      {player.session && (
        <div className="badges-standing">
          <span className="badges-standing-lbl">All-time standing</span>
          {standing && standing.my_rank != null ? (
            <span className="badges-standing-val">
              #{standing.my_rank} of {standing.total_players} · {standing.my_score} pts
            </span>
          ) : (
            <span className="badges-standing-val is-muted">No ranked {NOUN[game]}s yet.</span>
          )}
        </div>
      )}
      {badges.length === 0 ? (
        <p className="stats-empty">
          No badges yet. Play signed-in dailies, top the board, and go flawless to earn them.
        </p>
      ) : (
        <BadgeGrid badges={badges} />
      )}
      {nextUp && (
        <p className="badge-next">
          {nextUp.remaining} more {nextUp.remaining === 1 ? noun : `${noun}s`} → <b>{nextUp.label}</b>
        </p>
      )}
      {!player.session && (
        <p className="badge-note">Sign in to earn daily / weekly / monthly champion and ranking badges.</p>
      )}
    </div>
  );
}
