import { useEffect, useState } from "react";
import type { DerivedStats } from "../data/stats";
import type { UsePlayer } from "../hooks/usePlayer";
import { fetchPlayerBadges, fetchGridPlayerBadges } from "../data/games";
import { competitiveBadges, lineageBadges, kinshipBadges, nextPlayMilestone, type Badge, type PlayerBadges } from "../data/badges";

interface Props {
  stats: DerivedStats;
  player: UsePlayer;
  /** Which game's badges to show — each game gets its own panel. */
  game: "lineage" | "kinship";
}

export function BadgesPanel({ stats, player, game }: Props) {
  const isLineage = game === "lineage";
  const [server, setServer] = useState<PlayerBadges | null>(null);
  // The champion badge whose winning dates are expanded (click to toggle).
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!player.session) { setServer(null); return; }
    let live = true;
    const fetch = isLineage ? fetchPlayerBadges() : fetchGridPlayerBadges();
    fetch.then((b) => { if (live) setServer(b); });
    return () => { live = false; };
  }, [isLineage, player.session]);

  const local = isLineage ? lineageBadges(stats) : kinshipBadges(stats);
  const badges: Badge[] = [...competitiveBadges(server), ...local];
  const played = isLineage ? stats.daily.played : stats.kinship.played;
  const nextUp = nextPlayMilestone(played, isLineage ? "puzzle" : "board");
  const noun = isLineage ? "puzzle" : "board";
  const open = badges.find((b) => b.id === openId && b.occurrences?.length);

  return (
    <div className="stats badges">
      <div className="stats-sub">{isLineage ? "Lineage badges" : "Kinship badges"}</div>
      {badges.length === 0 ? (
        <p className="stats-empty">
          {isLineage
            ? "No badges yet. Complete puzzles, build a streak, and climb the leaderboard to earn them."
            : "No badges yet. Solve boards, go flawless, and top the board to earn them."}
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
