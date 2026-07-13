import { useEffect, useState } from "react";
import {
  fetchGridLeaderboard,
  fetchGridStanding,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type GridStanding,
} from "../data/games";
import { todayKey, dailyNumber, DAILY_EPOCH } from "../core/daily";

interface Props {
  /** Signed-in player's display name, to highlight their own row. */
  me: string | null;
  /** "today" = the fixed daily board (no controls); "config" = filterable. */
  variant: "today" | "config";
  /** Bump to force a refetch (e.g. after a just-finished game is submitted). */
  reloadKey?: number;
  onClose?: () => void;
}

const PERIODS: { k: LeaderboardPeriod; label: string }[] = [
  { k: "all", label: "All time" },
  { k: "month", label: "Month" },
  { k: "week", label: "Week" },
  { k: "day", label: "By day" },
];

function stepDate(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Kinship (grid) ranked board. Same shape as the Lineage board, but there's no
 *  clade-group filter (groups are per-board, not persistent categories) and the
 *  population "par" is average mistakes rather than guesses. */
export function KinshipLeaderboard({ me, variant, reloadKey = 0, onClose }: Props) {
  const isToday = variant === "today";
  const [period, setPeriod] = useState<LeaderboardPeriod>(isToday ? "day" : "all");
  const [dayDate, setDayDate] = useState<string>(() => todayKey());
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [standing, setStanding] = useState<GridStanding | null>(null);

  const today = todayKey();
  const browsingDay = !isToday && period === "day";
  const forDate = isToday ? today : browsingDay ? dayDate : null;

  useEffect(() => {
    let live = true;
    setRows(null);
    Promise.all([
      fetchGridLeaderboard(period, 10, forDate),
      fetchGridStanding(period, forDate),
    ]).then(([r, s]) => {
      if (!live) return;
      setRows(r);
      setStanding(s);
      setTotal(s?.total_players ?? r.length);
    });
    return () => { live = false; };
  }, [period, reloadKey, forDate]);

  const maxScore = rows && rows.length ? Math.max(...rows.map((r) => r.total_score), 1) : 1;

  return (
    <div className="lb">
      {onClose && <button className="stats-close" onClick={onClose} aria-label="Close leaderboard">×</button>}
      <div className="stats-sub">
        {isToday
          ? "Today’s Kinship board"
          : browsingDay
            ? `Kinship №${dailyNumber(dayDate)}`
            : "Kinship rankings"}
      </div>

      {!isToday && (
        <div className="lb-controls">
          <div className="lb-segs">
            {PERIODS.map((p) => (
              <button key={p.k} className={`lb-seg${period === p.k ? " is-on" : ""}`} onClick={() => setPeriod(p.k)}>
                {p.label}
              </button>
            ))}
          </div>
          {browsingDay && (
            <div className="lb-daynav">
              <button
                className="lb-daynav-btn"
                onClick={() => setDayDate((d) => stepDate(d, -1))}
                disabled={dayDate <= DAILY_EPOCH}
                aria-label="Previous day"
              >‹</button>
              <span className="lb-daynav-lbl">№{dailyNumber(dayDate)} · {dayDate}{dayDate === today && " · today"}</span>
              <button
                className="lb-daynav-btn"
                onClick={() => setDayDate((d) => stepDate(d, 1))}
                disabled={dayDate >= today}
                aria-label="Next day"
              >›</button>
            </div>
          )}
        </div>
      )}

      {rows === null ? (
        <p className="stats-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="stats-empty">No ranked Kinship games {isToday ? "today" : browsingDay ? "on this day" : "here yet"}. Play a signed-in daily to appear.</p>
      ) : (
        <>
          <div className="lb-rows">
            <div className="lb-row lb-head">
              <span className="lb-rank">#</span>
              <span className="lb-name">Player</span>
              <span className="lb-meta">won</span>
              <span className="lb-score">pts</span>
            </div>
            {rows.map((r, i) => (
              <div className={`lb-row${r.display_name === me ? " is-me" : ""}`} key={`${r.display_name}-${i}`}>
                <span className="lb-bar" style={{ width: `${(r.total_score / maxScore) * 100}%` }} aria-hidden="true" />
                <span className="lb-rank">{i + 1}</span>
                <span className="lb-name">{r.display_name}</span>
                <span className="lb-meta" title="wins / games played">{r.wins}/{r.games}</span>
                <span className="lb-score">{r.total_score}</span>
              </div>
            ))}
          </div>

          <div className="lb-foot">
            <span>
              {total} player{total === 1 ? "" : "s"}
              {standing?.avg_score != null && <> · avg {standing.avg_score} pts</>}
              {standing?.avg_mistakes != null && <> · ⌀{standing.avg_mistakes} mistakes</>}
            </span>
            {me && standing && (
              standing.my_rank != null ? (
                <span className="lb-you">
                  You · #{standing.my_rank}{total ? ` of ${total}` : ""} · {standing.my_score} pts
                </span>
              ) : (
                <span className="lb-you is-unranked">You · not ranked here yet</span>
              )
            )}
          </div>
        </>
      )}

      <p className="lb-note">Score rewards harder days and fewer mistakes. A clean board earns the full weight.</p>
    </div>
  );
}
