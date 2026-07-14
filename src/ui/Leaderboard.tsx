import { useEffect, useState } from "react";
import {
  fetchGameLeaderboard,
  fetchGameStanding,
  gameParLabel,
  type GameId,
  type GameStanding,
  type LeaderboardEntry,
  type LeaderboardPeriod,
} from "../data/games";
import { todayKey, dailyNumber, DAILY_EPOCH } from "../core/daily";

interface Props {
  /** Which game's board to show. */
  game: GameId;
  /** Display name of the game (for headings/empty state). */
  label: string;
  /** Signed-in player's display name, to highlight their own row. */
  me: string | null;
  /** "today" = the fixed daily board (no controls); "config" = filterable. */
  variant: "today" | "config";
  /** Bump to force a refetch (e.g. after a just-finished game is submitted). */
  reloadKey?: number;
  /** The viewer's current streak for this game, shown in the footer. */
  streak?: number | null;
  /** One-line explanation of how the score works. */
  note?: string;
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

/** Podium medals for ranks 1–3; plain numbers below. */
const MEDALS = ["🥇", "🥈", "🥉"];

/** One ranked daily board, shared by every game that has no persistent group
 *  filter (Kinship, Branches — and any future game). Lineage keeps its own richer
 *  panel because it filters by clade group. Reads through the game-parameterised
 *  fetchers in data/games.ts, so a new game is one registry entry away. */
export function Leaderboard({ game, label, me, variant, reloadKey = 0, streak, note, onClose }: Props) {
  const isToday = variant === "today";
  const [period, setPeriod] = useState<LeaderboardPeriod>(isToday ? "day" : "all");
  const [dayDate, setDayDate] = useState<string>(() => todayKey());
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [standing, setStanding] = useState<GameStanding | null>(null);

  const today = todayKey();
  const browsingDay = !isToday && period === "day";
  const oneDay = isToday || browsingDay;
  const forDate = isToday ? today : browsingDay ? dayDate : null;

  useEffect(() => {
    let live = true;
    setRows(null);
    Promise.all([
      fetchGameLeaderboard(game, period, { limit: 10, forDate }),
      fetchGameStanding(game, period, { forDate }),
    ]).then(([r, s]) => {
      if (!live) return;
      setRows(r);
      setStanding(s);
      setTotal(s?.total_players ?? r.length);
    });
    return () => { live = false; };
  }, [game, period, reloadKey, forDate]);

  return (
    <div className="lb">
      {onClose && <button className="stats-close" onClick={onClose} aria-label="Close leaderboard">×</button>}
      <div className="stats-sub">
        {isToday
          ? `Today’s ${label} board`
          : browsingDay
            ? `${label} №${dailyNumber(dayDate)}`
            : `${label} rankings`}
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
        <p className="stats-empty">No ranked {label} games {isToday ? "today" : browsingDay ? "on this day" : "here yet"}. Play a signed-in daily to appear.</p>
      ) : (
        <>
          <div className={`lb-rows${oneDay ? " is-slim" : ""}`}>
            <div className="lb-row lb-head">
              <span className="lb-rank">#</span>
              <span className="lb-name">Player</span>
              {!oneDay && <span className="lb-meta">won</span>}
              <span className="lb-score">pts</span>
            </div>
            {rows.map((r, i) => {
              const isMe = r.display_name === me;
              return (
                <div className={`lb-row${isMe ? " is-me" : ""}${i < 3 ? " is-podium" : ""}`} key={`${r.display_name}-${i}`}>
                  <span className={`lb-rank${i < 3 ? " is-medal" : ""}`}>{i < 3 ? MEDALS[i] : i + 1}</span>
                  <span className="lb-name">{r.display_name}{isMe && <span className="lb-youtag">you</span>}</span>
                  {!oneDay && <span className="lb-meta" title="wins / games played">{r.wins}/{r.games}</span>}
                  <span className="lb-score">{r.total_score}</span>
                </div>
              );
            })}
          </div>

          <div className="lb-foot">
            <span>
              {total} player{total === 1 ? "" : "s"}
              {standing?.avg_score != null && <> · avg {standing.avg_score} pts</>}
              {standing?.par != null && <> · ⌀{standing.par} {gameParLabel(game)}</>}
            </span>
            {me && standing && (
              standing.my_rank != null ? (
                <span className="lb-you">
                  You · #{standing.my_rank}{total ? ` of ${total}` : ""} · {standing.my_score} pts
                  {streak != null && streak > 0 && <span className="lb-streak"> · 🔥 {streak}</span>}
                </span>
              ) : (
                <span className="lb-you is-unranked">You · not ranked here yet</span>
              )
            )}
          </div>
        </>
      )}

      {note && <p className="lb-note">{note}</p>}
    </div>
  );
}
