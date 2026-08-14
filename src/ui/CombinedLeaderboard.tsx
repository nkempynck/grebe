import { useEffect, useState } from "react";
import {
  fetchCombinedDaily,
  fetchCombinedPeriod,
  fetchOverallBadges,
  type CombinedEntry,
  type CombinedPeriodEntry,
  type LeaderboardPeriod,
} from "../data/games";
import type { OverallBadges } from "../data/badges";
import { todayKey, dailyNumber } from "../core/daily";
import { periodLabel, periodStart } from "../core/period";
import { PeriodNav, windowNoun } from "./PeriodNav";

interface Props {
  /** Signed-in player's display name, to highlight their own row. */
  me: string | null;
  /** Whether the viewer has played at least one of today's games (signed in or
   *  not). When false, today's combined board is hidden behind a "play first"
   *  note; past days stay browsable. */
  playedToday?: boolean;
  /** "today" = the fixed daily board, no controls; "config" = filterable. Mirrors
   *  the per-game boards, which the leaderboard tab stacks the same way. */
  variant?: "today" | "config";
}

/** Podium medals for ranks 1–3; plain numbers below. */
const MEDALS = ["🥇", "🥈", "🥉"];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (d: string) => { const [, m, day] = d.split("-"); return `${MON[+m - 1]} ${+day}`; };

const PERIODS: { k: LeaderboardPeriod; label: string }[] = [
  { k: "all", label: "All time" },
  { k: "month", label: "Month" },
  { k: "week", label: "Week" },
  { k: "day", label: "By day" },
];

/** One row of either board, normalised for rendering: a day shows games out of
 *  three, a period shows how many days were played. */
interface Row {
  display_name: string;
  score: number;
  /** "2/3" on a day, "5 days" over a period. */
  meta: string;
  /** The tie-break the rank shares: games on a day, days over a period. */
  tie: number;
  rank: number;
}

/** The combined board: each of the three games scored 0–100 (the player's score
 *  as a share of that game's top score on the DAY), averaged for a daily total
 *  out of 100. A week, month or all-time board is the SUM of those daily scores.
 *
 *  Summing daily scores rather than ranking raw points is deliberate: a day where
 *  everyone maxed would otherwise dominate a week, and a brutal day you won with
 *  a low score would count for almost nothing. Normalising per day keeps a won
 *  day worth its full 100 whatever the scores looked like.
 *
 *  The day view combines the per-game boards client-side (fetchCombinedDaily);
 *  the period views come from combined_leaderboard(), which walks the same days
 *  server-side rather than making the client fetch ~90 boards for a month. */
export function CombinedLeaderboard({ me, playedToday = true, variant = "config" }: Props) {
  const today = todayKey();
  const fixedToday = variant === "today";
  // The filterable panel opens on All time, as the per-game boards do; the fixed
  // panel renders no controls, so its state simply never moves off today — no
  // separate code path for it.
  const [period, setPeriod] = useState<LeaderboardPeriod>(fixedToday ? "day" : "all");
  const [anchor, setAnchor] = useState<string>(today);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [overall, setOverall] = useState<OverallBadges | null>(null);
  const oneDay = period === "day";
  // On the current week/month the RPC's own current-window branch applies, so
  // for_date is only sent when a past bucket is being browsed.
  const pastBucket = !oneDay && period !== "all" && periodStart(period, anchor) !== periodStart(period, today);
  // Any window CONTAINING today is earned by playing: hidden (and not fetched)
  // until the viewer has played at least one of today's games. Same rule as the
  // per-game boards, so the combined view can't become the way around their wall.
  // Past buckets and All time stay open.
  const locked = !playedToday && period !== "all" && !pastBucket;

  useEffect(() => {
    let live = true;
    setRows(null);
    if (locked) return;
    const load = oneDay
      ? fetchCombinedDaily(anchor).then((rs: CombinedEntry[]) =>
          rs.map((r) => ({ display_name: r.display_name, score: r.combined, meta: `${r.played}/3`, tie: r.played })))
      : fetchCombinedPeriod(period, pastBucket ? anchor : null).then((rs: CombinedPeriodEntry[]) =>
          rs.map((r) => ({
            display_name: r.display_name,
            score: r.combined,
            meta: `${r.days} day${r.days === 1 ? "" : "s"}`,
            tie: r.days,
          })));
    load.then((rs) => {
      if (!live) return;
      // Standard competition ranking: players level on score AND on the
      // tie-break share a rank, and the next one down skips (1, 1, 3). Both
      // sources arrive sorted by those two, so a tied block is contiguous and
      // its first index is its rank. Deciding a tie by the alphabet is what used
      // to cost somebody a shared 👑.
      setRows(rs.map((r, _i, all) => ({
        ...r,
        rank: all.findIndex((o) => o.score === r.score && o.tie === r.tie) + 1,
      })));
    });
    return () => { live = false; };
  }, [period, anchor, oneDay, pastBucket, locked]);

  // The signed-in player's own overall-champion record, shown below the board.
  useEffect(() => {
    if (!me) { setOverall(null); return; }
    let live = true;
    fetchOverallBadges().then((o) => { if (live) setOverall(o); });
    return () => { live = false; };
  }, [me]);

  const myIdx = rows && me ? rows.findIndex((r) => r.display_name === me) : -1;
  const heading = fixedToday
    ? "Today’s combined board"
    : oneDay
      ? `Combined · Daily №${dailyNumber(anchor)}`
      : period === "all"
        ? "Combined · All time"
        : `Combined · ${periodLabel(period, anchor)}`;

  return (
    <div className="lb">
      <div className="stats-sub">{heading}</div>

      {!fixedToday && (
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
        <p className="stats-empty">Play one of today’s games to see {windowNoun(period)}.</p>
      ) : rows === null ? (
        <p className="stats-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="stats-empty">No ranked games {oneDay ? "on this day" : "in this window"} yet. Play a signed-in daily to appear.</p>
      ) : (
        <>
          <div className="lb-rows">
            <div className="lb-row lb-head">
              <span className="lb-rank">#</span>
              <span className="lb-name">Player</span>
              <span className="lb-meta">{oneDay ? "games" : "played"}</span>
              <span className="lb-score">{oneDay ? "/100" : "pts"}</span>
            </div>
            {rows.slice(0, 10).map((r) => {
              const isMe = r.display_name === me;
              const podium = r.rank <= 3;
              // Everyone at rank 1 wears the crown, however many that is.
              const crowned = r.rank === 1 && r.score > 0;
              const crownTitle = oneDay
                ? `Overall ${anchor === today ? "leader" : "winner"} of the day`
                : `Overall ${pastBucket ? "winner" : "leader"} of the ${period === "all" ? "board" : period}`;
              return (
                <div className={`lb-row${isMe ? " is-me" : ""}${podium ? " is-podium" : ""}`} key={r.display_name}>
                  <span className={`lb-rank${podium ? " is-medal" : ""}`}>{podium ? MEDALS[r.rank - 1] : r.rank}</span>
                  <span className="lb-name">
                    {crowned && <span className="lb-crown" title={crownTitle}>👑</span>}
                    {r.display_name}{isMe && <span className="lb-youtag">you</span>}
                  </span>
                  <span className="lb-meta" title={oneDay ? "games played that day" : "days played in this window"}>{r.meta}</span>
                  <span className="lb-score">{r.score}</span>
                </div>
              );
            })}
          </div>

          <div className="lb-foot">
            <span>{rows.length} player{rows.length === 1 ? "" : "s"}</span>
            {me && (
              myIdx >= 0 ? (
                <span className="lb-you">You · #{rows[myIdx].rank} of {rows.length} · {rows[myIdx].score} pts</span>
              ) : (
                <span className="lb-you is-unranked">You · not ranked here yet</span>
              )
            )}
          </div>
        </>
      )}

      {/* The champion record and the how-it-works note live on the filterable
          panel only, so stacking the two boards doesn't print them twice. */}
      {!fixedToday && overall && overall.daily_wins > 0 && (
        <div className="lb-champ" title={`Overall daily wins: ${overall.win_dates.map(fmtDay).join(", ")}`}>
          👑 Overall daily champion ×{overall.daily_wins}
          {overall.win_dates[0] && <span className="lb-champ-latest"> · latest {fmtDay(overall.win_dates[0])}</span>}
        </div>
      )}

      {!fixedToday && <p className="lb-note">
        Each game scored 0–100 (your score as a share of the day’s best in that game), then averaged
        across Lineage, Kinship and Branches for one daily total out of 100. Play all three to top it.
        A week, month or all-time board adds up those daily totals, so a hard day you won still counts
        for the full 100. Top a finished day (with ≥3 players) to earn the 👑, a finished week for the
        🏆, a finished month for the 🎖️. Match the leader exactly and you both keep it.
      </p>}
    </div>
  );
}
