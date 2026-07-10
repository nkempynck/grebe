import { useEffect, useState } from "react";
import {
  fetchLeaderboard,
  fetchStanding,
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

const GROUPS: { id: string | null; label: string; icon: string }[] = [
  { id: null, label: "Overall", icon: "🏆" },
  ...CLADE_GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon })),
  { id: OTHER_GROUP.id, label: OTHER_GROUP.label, icon: OTHER_GROUP.icon },
];

export function LeaderboardPanel({ me, variant, canPreview = false, reloadKey = 0, answerForDate, onClose }: Props) {
  const isToday = variant === "today";
  const [period, setPeriod] = useState<LeaderboardPeriod>(isToday ? "day" : "all");
  const [group, setGroup] = useState<string | null>(null);
  const [dayDate, setDayDate] = useState<string>(() => todayKey());
  const [demo, setDemo] = useState(false);
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [standing, setStanding] = useState<Standing | null>(null);

  const groupLabel = GROUPS.find((g) => g.id === group)?.label ?? null;
  const groupLabelForDemo = group === null ? null : groupLabel;
  // Demo preview is an admin-only layout tool; never active for regular players
  // even if state somehow flips (the toggle that sets it is admin-gated below).
  const previewing = demo && canPreview;
  // When browsing a specific past day, pin the board to that date (period ignored).
  const today = todayKey();
  const browsingDay = !isToday && period === "day";
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

  const highlight = previewing ? "you" : me;
  const maxScore = rows && rows.length ? Math.max(...rows.map((r) => r.total_score), 1) : 1;
  const canShowYou = previewing || !!me;

  return (
    <div className="lb">
      {onClose && <button className="stats-close" onClick={onClose} aria-label="Close leaderboard">×</button>}
      <div className="stats-sub">
        {isToday
          ? "Today’s leaderboard"
          : browsingDay
            ? `Daily №${dailyNumber(dayDate)} — ${groupLabel ?? "Overall"}`
            : `Rankings — ${groupLabel ?? "Overall"}`}
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
          <div className="lb-rows">
            <div className="lb-row lb-head">
              <span className="lb-rank">#</span>
              <span className="lb-name">Player</span>
              <span className="lb-meta">won</span>
              <span className="lb-score">pts</span>
            </div>
            {rows.map((r, i) => (
              <div className={`lb-row${r.display_name === highlight ? " is-me" : ""}`} key={`${r.display_name}-${i}`}>
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
              {standing?.avg_guesses != null && <> · ⌀{standing.avg_guesses} guesses</>}
            </span>
            {canShowYou && standing && (
              standing.my_rank != null ? (
                <span className="lb-you">
                  You · #{standing.my_rank}{total ? ` of ${total}` : ""} · {standing.my_score} pts
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
