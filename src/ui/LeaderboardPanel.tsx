import { useEffect, useState } from "react";
import {
  fetchLeaderboard,
  fetchStanding,
  fetchGameStreaks,
  type LeaderboardEntry,
  type LeaderboardPeriod,
  type Standing,
} from "../data/games";
import { demoBoard } from "../data/demoLeaderboard";
import { CLADE_GROUPS, OTHER_GROUP } from "../data/clades";
import { todayKey, dailyNumber, DAILY_EPOCH } from "../core/daily";

interface Props {
  /** Signed-in player's display name, to highlight their own row. */
  me: string | null;
  /** "today" = the fixed daily board (no controls); "config" = filterable. */
  variant: "today" | "config";
  /** Admin-only: expose the demo-data preview toggle (a layout preview tool). */
  canPreview?: boolean;
  /** Bump to force a refetch (e.g. after a just-finished game is submitted). */
  reloadKey?: number;
  /** The viewer's current daily streak, shown in the footer (their own only —
   *  other players' streaks aren't exposed by the server). */
  streak?: number | null;
  /** Resolve a past day's answer species (for the day-browsing view). Only ever
   *  called for finished days, so it never reveals today's puzzle. */
  answerForDate?: (dateKey: string) => { name: string; sci: string } | null;
  onClose?: () => void;
}

const PERIODS: { k: LeaderboardPeriod; label: string }[] = [
  { k: "all", label: "All time" },
  { k: "month", label: "Month" },
  { k: "week", label: "Week" },
  { k: "day", label: "By day" },
];

/** Shift a YYYY-MM-DD key by whole days (UTC), for the day navigator. */
function stepDate(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Podium medals for ranks 1–3; plain numbers below. */
const MEDALS = ["🥇", "🥈", "🥉"];

const GROUPS: { id: string | null; label: string; icon: string }[] = [
  { id: null, label: "Overall", icon: "🏆" },
  ...CLADE_GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon })),
  { id: OTHER_GROUP.id, label: OTHER_GROUP.label, icon: OTHER_GROUP.icon },
];

export function LeaderboardPanel({ me, variant, canPreview = false, reloadKey = 0, streak, answerForDate, onClose }: Props) {
  const isToday = variant === "today";
  const [period, setPeriod] = useState<LeaderboardPeriod>(isToday ? "day" : "all");
  const [group, setGroup] = useState<string | null>(null);
  const [dayDate, setDayDate] = useState<string>(() => todayKey());
  const [demo, setDemo] = useState(false);
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [standing, setStanding] = useState<Standing | null>(null);
  // Each player's current daily-win streak (name → streak), shown as a flame.
  const [streaks, setStreaks] = useState<Record<string, number>>({});

  const groupLabel = GROUPS.find((g) => g.id === group)?.label ?? null;
  const groupLabelForDemo = group === null ? null : groupLabel;
  // Demo preview is an admin-only layout tool; never active for regular players
  // even if state somehow flips (the toggle that sets it is admin-gated below).
  const previewing = demo && canPreview;
  // When browsing a specific past day, pin the board to that date (period ignored).
  const today = todayKey();
  const browsingDay = !isToday && period === "day";
  // A single-day board: everyone has one game, so per-row wins/games is noise —
  // drop that column and surface the viewer's streak in the footer instead.
  const oneDay = isToday || browsingDay;
  const forDate = browsingDay ? dayDate : null;
  // The answer is revealed only for a finished day (never today's live puzzle).
  const dayAnswer = browsingDay && dayDate < today && answerForDate ? answerForDate(dayDate) : null;

  useEffect(() => {
    let live = true;
    if (previewing) {
      const b = demoBoard(period, groupLabelForDemo);
      setRows(b.rows);
      setTotal(b.totalPlayers);
      setStanding(b.standing);
      return;
    }
    setRows(null);
    Promise.all([fetchLeaderboard(period, group, 10, forDate), fetchStanding(period, group, forDate)]).then(([r, s]) => {
      if (!live) return;
      setRows(r);
      setStanding(s);
      setTotal(s?.total_players ?? r.length);
    });
    return () => { live = false; };
  }, [period, group, previewing, groupLabelForDemo, reloadKey, forDate]);

  // Live per-player daily-win streaks (name → streak), shown as a flame. Skipped in
  // the admin demo preview (its names are synthetic).
  useEffect(() => {
    if (previewing) { setStreaks({}); return; }
    let live = true;
    fetchGameStreaks("lineage").then((s) => { if (live) setStreaks(s); });
    return () => { live = false; };
  }, [previewing, reloadKey]);

  const highlight = previewing ? "you" : me;
  const canShowYou = previewing || !!me;

  return (
    <div className="lb">
      {onClose && <button className="stats-close" onClick={onClose} aria-label="Close leaderboard">×</button>}
      <div className="stats-sub">
        {isToday
          ? "Today’s leaderboard"
          : browsingDay
            ? `Daily №${dailyNumber(dayDate)} · ${groupLabel ?? "Overall"}`
            : `Rankings · ${groupLabel ?? "Overall"}`}
        {previewing && " · demo"}
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
          <div className="lb-segs">
            {GROUPS.map((g) => (
              <button key={g.label} className={`lb-seg${group === g.id ? " is-on" : ""}`} onClick={() => setGroup(g.id)}>
                {g.icon} {g.label}
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
          {browsingDay && (
            dayAnswer ? (
              <div className="lb-dayanswer">Answer · <b>{dayAnswer.name}</b> <i>{dayAnswer.sci}</i></div>
            ) : dayDate === today ? (
              <div className="lb-dayanswer is-muted">Today’s answer is hidden until the day ends.</div>
            ) : null
          )}
        </div>
      )}

      {rows === null ? (
        <p className="stats-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="stats-empty">No ranked games {isToday ? "today" : browsingDay ? "on this day" : "here yet"}. Play a signed-in daily to appear.</p>
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
              const isMe = r.display_name === highlight;
              return (
                <div className={`lb-row${isMe ? " is-me" : ""}${i < 3 ? " is-podium" : ""}`} key={`${r.display_name}-${i}`}>
                  <span className={`lb-rank${i < 3 ? " is-medal" : ""}`}>{i < 3 ? MEDALS[i] : i + 1}</span>
                  <span className="lb-name">
                    {r.display_name}{isMe && <span className="lb-youtag">you</span>}
                    {streaks[r.display_name] >= 2 && (
                      <span className="lb-rowstreak" title={`${streaks[r.display_name]}-day win streak`}>🔥{streaks[r.display_name]}</span>
                    )}
                  </span>
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
              {standing?.avg_guesses != null && <> · ⌀{standing.avg_guesses} guesses</>}
            </span>
            {canShowYou && standing && (
              standing.my_rank != null ? (
                <span className="lb-you">
                  You · #{standing.my_rank}{total ? ` of ${total}` : ""} · {standing.my_score} pts
                  {streak != null && streak > 0 && <span className="lb-streak"> · 🔥 {streak}</span>}
                  {standing.avg_score != null && standing.my_score != null && (
                    <span className={`lb-delta ${standing.my_score >= standing.avg_score ? "is-up" : "is-down"}`}>
                      {" "}{standing.my_score >= standing.avg_score ? "▲" : "▼"} {standing.my_score >= standing.avg_score ? "+" : ""}
                      {standing.my_score - standing.avg_score} vs avg
                    </span>
                  )}
                </span>
              ) : (
                <span className="lb-you is-unranked">You · not ranked here yet</span>
              )
            )}
          </div>
        </>
      )}

      <p className="lb-note">
        Score rewards harder days, fewer guesses, and no hints. Daily games only.{canPreview && " "}
        {canPreview && (
          <button className="lb-demo-toggle" onClick={() => setDemo((d) => !d)}>
            {demo ? "show live" : "preview demo data"}
          </button>
        )}
      </p>
    </div>
  );
}
