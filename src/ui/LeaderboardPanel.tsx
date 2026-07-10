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

interface Props {
  /** Signed-in player's display name, to highlight their own row. */
  me: string | null;
  /** "today" = the fixed daily board (no controls); "config" = filterable. */
  variant: "today" | "config";
  onClose?: () => void;
}

const PERIODS: { k: LeaderboardPeriod; label: string }[] = [
  { k: "all", label: "All time" },
  { k: "month", label: "Month" },
  { k: "week", label: "Week" },
];

const GROUPS: { id: string | null; label: string; icon: string }[] = [
  { id: null, label: "Overall", icon: "🏆" },
  ...CLADE_GROUPS.map((g) => ({ id: g.id, label: g.label, icon: g.icon })),
  { id: OTHER_GROUP.id, label: OTHER_GROUP.label, icon: OTHER_GROUP.icon },
];

export function LeaderboardPanel({ me, variant, onClose }: Props) {
  const isToday = variant === "today";
  const [period, setPeriod] = useState<LeaderboardPeriod>(isToday ? "day" : "all");
  const [group, setGroup] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [standing, setStanding] = useState<Standing | null>(null);

  const groupLabel = GROUPS.find((g) => g.id === group)?.label ?? null;
  const groupLabelForDemo = group === null ? null : groupLabel;

  useEffect(() => {
    let live = true;
    if (demo) {
      const b = demoBoard(period, groupLabelForDemo);
      setRows(b.rows);
      setTotal(b.totalPlayers);
      setStanding(b.standing);
      return;
    }
    setRows(null);
    Promise.all([fetchLeaderboard(period, group, 10), fetchStanding(period, group)]).then(([r, s]) => {
      if (!live) return;
      setRows(r);
      setStanding(s);
      setTotal(s?.total_players ?? r.length);
    });
    return () => { live = false; };
  }, [period, group, demo, groupLabelForDemo]);

  const highlight = demo ? "you" : me;
  const maxScore = rows && rows.length ? Math.max(...rows.map((r) => r.total_score), 1) : 1;
  const canShowYou = demo || !!me;

  return (
    <div className="lb">
      {onClose && <button className="stats-close" onClick={onClose} aria-label="Close leaderboard">×</button>}
      <div className="stats-sub">
        {isToday ? "Today’s leaderboard" : `Rankings — ${groupLabel ?? "Overall"}`}{demo && " · demo"}
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
        </div>
      )}

      {rows === null ? (
        <p className="stats-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="stats-empty">No ranked games {isToday ? "today" : "here yet"}. Play a signed-in daily to appear.</p>
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
        Score rewards harder days, fewer guesses, and no hints. Daily games only.{" "}
        <button className="lb-demo-toggle" onClick={() => setDemo((d) => !d)}>
          {demo ? "show live" : "preview demo data"}
        </button>
      </p>
    </div>
  );
}
