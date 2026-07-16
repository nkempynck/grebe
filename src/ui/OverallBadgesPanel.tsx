import { useEffect, useState } from "react";
import type { UsePlayer } from "../hooks/usePlayer";
import { fetchOverallBadges } from "../data/games";
import { overallBadges, type Badge } from "../data/badges";

interface Props {
  player: UsePlayer;
}

/** Overall (combined-board) badges: the 👑 daily-champion badge for topping the
 *  day's combined leaderboard across all three games. Its own Account panel so it
 *  isn't tied to any single game. */
export function OverallBadgesPanel({ player }: Props) {
  const [server, setServer] = useState<{ daily_wins: number; win_dates: string[] } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!player.session) { setServer(null); return; }
    let live = true;
    fetchOverallBadges().then((b) => { if (live) setServer(b); });
    return () => { live = false; };
  }, [player.session]);

  const badges: Badge[] = overallBadges(server);
  const open = badges.find((b) => b.id === openId && b.occurrences?.length);

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
    </div>
  );
}
