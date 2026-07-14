import { useEffect, useState } from "react";
import type { DerivedStats } from "../data/stats";
import type { UsePlayer } from "../hooks/usePlayer";
import { fetchGameBadges, fetchGameStanding, type GameId, type GameStanding } from "../data/games";
import { competitiveBadges, lineageBadges, kinshipBadges, branchesBadges, nextPlayMilestone, type Badge, type PlayerBadges } from "../data/badges";

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
  // The champion badge whose winning dates are expanded (click to toggle).
  const [openId, setOpenId] = useState<string | null>(null);

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
  const open = badges.find((b) => b.id === openId && b.occurrences?.length);

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
        <div className="badge-grid">
          {badges.map((b) => {
            const clickable = !!b.occurrences?.length;
            const inner = (
              <>
                <span className="badge-medal"><span className="badge-ico" aria-hidden="true">{b.icon}</span></span>
                <span className="badge-label">{b.label}</span>
                {clickable && b.occurrences!.length > 1 && <span className="badge-count">×{b.occurrences!.length}</span>}
              </>
            );
            return clickable ? (
              <button
                type="button"
                className={`badge badge-${b.tier} is-clickable${openId === b.id ? " is-open" : ""}`}
                key={b.id}
                title={b.desc}
                aria-expanded={openId === b.id}
                onClick={() => setOpenId((id) => (id === b.id ? null : b.id))}
              >
                {inner}
              </button>
            ) : (
              <div className={`badge badge-${b.tier}`} key={b.id} title={b.desc}>{inner}</div>
            );
          })}
        </div>
      )}
      {open && (
        <div className="badge-dates">
          <span className="badge-dates-lbl">{open.label} · {open.occLabel ?? "won"}</span>
          {open.occurrences!.map((o) => <span className="badge-date" key={o}>{o}</span>)}
        </div>
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
