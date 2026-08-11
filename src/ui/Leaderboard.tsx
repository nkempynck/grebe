import { useEffect, useState } from "react";
import {
  fetchGameLeaderboard,
  fetchGameStanding,
  fetchGameStreaks,
  fetchDailyCompletion,
  gameParLabel,
  type GameId,
  type GameStanding,
  type DailyCompletion,
  type LeaderboardEntry,
  type LeaderboardPeriod,
} from "../data/games";
import { todayKey, dailyNumber } from "../core/daily";
import { periodStart } from "../core/period";
import { PeriodNav, windowNoun } from "./PeriodNav";

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
  /** Whether the viewer has played today's board of this game (signed in or not).
   *  When false, today's board is hidden behind a "play first" note — applies to
   *  the fixed today view and to "By day" when it shows today. */
  playedToday?: boolean;
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

/** Podium medals for ranks 1–3; plain numbers below. */
const MEDALS = ["🥇", "🥈", "🥉"];

/** One ranked daily board, shared by every game that has no persistent group
 *  filter (Kinship, Branches — and any future game). Lineage keeps its own richer
 *  panel because it filters by clade group. Reads through the game-parameterised
 *  fetchers in data/games.ts, so a new game is one registry entry away. */
export function Leaderboard({ game, label, me, variant, reloadKey = 0, streak, playedToday = true, note, onClose }: Props) {
  const isToday = variant === "today";
  const [period, setPeriod] = useState<LeaderboardPeriod>(isToday ? "day" : "all");
  // The bucket being browsed: any date inside it. Reset to today when the period
  // changes, so each tab opens on the current window and steps back from there.
  const [anchor, setAnchor] = useState<string>(() => todayKey());
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [standing, setStanding] = useState<GameStanding | null>(null);
  // Played/solved for a single day (the board lists only solvers, so failures are
  // invisible without this). Only meaningful per-day, so null on week/all windows.
  const [completion, setCompletion] = useState<DailyCompletion | null>(null);
  // Each player's current daily-win streak (name → streak), shown as a flame.
  const [streaks, setStreaks] = useState<Record<string, number>>({});

  const today = todayKey();
  const browsingDay = !isToday && period === "day";
  const oneDay = isToday || browsingDay;
  // Pin the board to a past bucket only when one is being browsed. On the current
  // week/month, `for_date` stays null and the RPC uses its own current-window
  // branch, which is exactly what these tabs sent before periods became
  // browsable — so this board behaves identically on a database that hasn't had
  // the period migration applied yet.
  const pastBucket = !isToday && period !== "all" && periodStart(period, anchor) !== periodStart(period, today);
  const forDate = isToday ? today : browsingDay || pastBucket ? anchor : null;
  // Only the window CONTAINING today is earned by playing: hidden (and not
  // fetched) until the viewer has played today's board of this game. That gates
  // the current week every day of the week, not just the Monday when it happens
  // to BE today's board, since today's scores are folded into it throughout. Step
  // back one bucket and it opens; All time stays open too, being a window a
  // single day can't be read back out of.
  const currentBucket = !isToday && period !== "all" && !pastBucket;
  const locked = !playedToday && (isToday || currentBucket);

  useEffect(() => {
    let live = true;
    setRows(null);
    if (locked) return;
    setCompletion(null);
    Promise.all([
      fetchGameLeaderboard(game, period, { limit: 10, forDate }),
      fetchGameStanding(game, period, { forDate }),
      // Completion is a single-day stat (played/solved on that date); skip it on
      // multi-day windows, where it wouldn't have a clear meaning.
      oneDay && forDate ? fetchDailyCompletion(game, forDate) : Promise.resolve(null),
    ]).then(([r, s, c]) => {
      if (!live) return;
      setRows(r);
      setStanding(s);
      setTotal(s?.total_players ?? r.length);
      setCompletion(c);
    });
    return () => { live = false; };
  }, [game, period, reloadKey, forDate, locked, oneDay]);

  // Streaks are a live per-player property (not tied to the window), fetched once
  // per game and refreshed after a submit.
  useEffect(() => {
    let live = true;
    fetchGameStreaks(game).then((s) => { if (live) setStreaks(s); });
    return () => { live = false; };
  }, [game, reloadKey]);

  return (
    <div className="lb">
      {onClose && <button className="stats-close" onClick={onClose} aria-label="Close leaderboard">×</button>}
      <div className="stats-sub">
        {isToday
          ? `Today’s ${label} board`
          : browsingDay
            ? `${label} №${dailyNumber(anchor)}`
            : `${label} rankings`}
      </div>

      {!isToday && (
        <div className="lb-controls">
          <div className="lb-segs">
            {PERIODS.map((p) => (
              <button
                key={p.k}
                className={`lb-seg${period === p.k ? " is-on" : ""}`}
                onClick={() => { setPeriod(p.k); setAnchor(today); }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <PeriodNav period={period} date={anchor} onChange={setAnchor} />
        </div>
      )}

      {locked ? (
        <p className="stats-empty">Play today’s {label} to see {windowNoun(isToday ? "day" : period)}.</p>
      ) : rows === null ? (
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
                  <span className="lb-name">
                    {r.display_name}{isMe && <span className="lb-youtag">you</span>}
                    {streaks[r.display_name] >= 2 && (
                      <span className="lb-rowstreak" title={`${streaks[r.display_name]}-day win streak`}>🔥{streaks[r.display_name]}</span>
                    )}
                  </span>
                  {/* Wins only, no "of games played": the board drops 0-point rows,
                      and a Kinship/Lineage loss always scores 0, so the denominator
                      could only ever equal the wins (see grid_leaderboard). */}
                  {!oneDay && <span className="lb-meta" title="boards won">{r.wins}</span>}
                  <span className="lb-score">{r.total_score}</span>
                </div>
              );
            })}
          </div>

          <div className="lb-foot">
            <span>
              {oneDay && completion && completion.played > 0 ? (
                // Per-day: show turnout + solve rate (board rows are solvers only,
                // so this is where "how many played / failed" surfaces).
                <>{completion.played} played · {completion.solved} solved · {Math.round((completion.solved / completion.played) * 100)}%</>
              ) : (
                <>{total} player{total === 1 ? "" : "s"}</>
              )}
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
