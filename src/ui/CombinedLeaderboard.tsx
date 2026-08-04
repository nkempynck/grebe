import { useEffect, useMemo, useState } from "react";
import { fetchCombinedDaily, fetchOverallBadges, type CombinedEntry } from "../data/games";
import type { OverallBadges } from "../data/badges";
import { todayKey, dailyNumber, DAILY_EPOCH } from "../core/daily";

interface Props {
  /** Signed-in player's display name, to highlight their own row. */
  me: string | null;
  /** Whether the viewer has played at least one of today's games (signed in or
   *  not). When false, today's combined board is hidden behind a "play first"
   *  note; past days stay browsable. */
  playedToday?: boolean;
}

/** Podium medals for ranks 1–3; plain numbers below. */
const MEDALS = ["🥇", "🥈", "🥉"];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (d: string) => { const [, m, day] = d.split("-"); return `${MON[+m - 1]} ${+day}`; };

function stepDate(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** One combined daily board: each of the three games scored 0–100 (the player's
 *  score as a share of that game's top score on the day), summed for a single
 *  total out of 300. Browsable back to the epoch; defaults to today. */
export function CombinedLeaderboard({ me, playedToday = true }: Props) {
  const today = todayKey();
  const [dayDate, setDayDate] = useState<string>(today);
  const [rows, setRows] = useState<CombinedEntry[] | null>(null);
  const [overall, setOverall] = useState<OverallBadges | null>(null);
  // Today's board is earned by playing: hide it (and skip the fetch) until the
  // viewer has played at least one of today's games. Past days stay browsable.
  const locked = !playedToday && dayDate === today;

  useEffect(() => {
    let live = true;
    setRows(null);
    if (locked) return;
    fetchCombinedDaily(dayDate).then((r) => {
      if (live) setRows(r);
    });
    return () => { live = false; };
  }, [dayDate, locked]);

  // The signed-in player's own overall-champion record (how many past days they
  // topped the combined board), shown below the board.
  useEffect(() => {
    if (!me) { setOverall(null); return; }
    let live = true;
    fetchOverallBadges().then((o) => { if (live) setOverall(o); });
    return () => { live = false; };
  }, [me]);

  // Standard competition ranking: players level on score AND games played share a
  // rank, and the next one down skips (1, 1, 3). fetchCombinedDaily already sorts
  // by those two, so a tied block is contiguous and its first index is its rank.
  // Two identical results being printed #1 and #2 was the board deciding a tie by
  // the alphabet, which is also how a shared day used to cost somebody the 👑.
  const ranked = useMemo(
    () => rows?.map((r, _i, all) => ({
      ...r,
      rank: all.findIndex((o) => o.combined === r.combined && o.played === r.played) + 1,
    })) ?? null,
    [rows]
  );

  const myIdx = ranked && me ? ranked.findIndex((r) => r.display_name === me) : -1;

  return (
    <div className="lb">
      <div className="stats-sub">Combined · Daily №{dailyNumber(dayDate)}</div>

      <div className="lb-controls">
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
      </div>

      {locked ? (
        <p className="stats-empty">Play one of today’s games to see the leaderboard of the day.</p>
      ) : ranked === null ? (
        <p className="stats-empty">Loading…</p>
      ) : ranked.length === 0 ? (
        <p className="stats-empty">No ranked games on this day yet. Play a signed-in daily to appear.</p>
      ) : (
        <>
          <div className="lb-rows">
            <div className="lb-row lb-head">
              <span className="lb-rank">#</span>
              <span className="lb-name">Player</span>
              <span className="lb-meta">games</span>
              <span className="lb-score">/100</span>
            </div>
            {ranked.slice(0, 10).map((r) => {
              const isMe = r.display_name === me;
              const podium = r.rank <= 3;
              // Everyone at rank 1 wears the crown, however many that is.
              const crowned = r.rank === 1 && r.combined > 0;
              return (
                <div className={`lb-row${isMe ? " is-me" : ""}${podium ? " is-podium" : ""}`} key={r.display_name}>
                  <span className={`lb-rank${podium ? " is-medal" : ""}`}>{podium ? MEDALS[r.rank - 1] : r.rank}</span>
                  <span className="lb-name">
                    {crowned && <span className="lb-crown" title={`Overall ${dayDate === today ? "leader" : "winner"} of the day`}>👑</span>}
                    {r.display_name}{isMe && <span className="lb-youtag">you</span>}
                  </span>
                  <span className="lb-meta" title="games played today">{r.played}/3</span>
                  <span className="lb-score">{r.combined}</span>
                </div>
              );
            })}
          </div>

          <div className="lb-foot">
            <span>{ranked.length} player{ranked.length === 1 ? "" : "s"}</span>
            {me && (
              myIdx >= 0 ? (
                <span className="lb-you">You · #{ranked[myIdx].rank} of {ranked.length} · {ranked[myIdx].combined} pts</span>
              ) : (
                <span className="lb-you is-unranked">You · not ranked here yet</span>
              )
            )}
          </div>
        </>
      )}

      {overall && overall.daily_wins > 0 && (
        <div className="lb-champ" title={`Overall daily wins: ${overall.win_dates.map(fmtDay).join(", ")}`}>
          👑 Overall daily champion ×{overall.daily_wins}
          {overall.win_dates[0] && <span className="lb-champ-latest"> · latest {fmtDay(overall.win_dates[0])}</span>}
        </div>
      )}

      <p className="lb-note">
        Each game scored 0–100 (your score as a share of the day’s best in that game), then averaged
        across Lineage, Kinship and Branches for one daily total out of 100. Play all three to top it.
        Top it on a finished day (with ≥3 players) to earn the 👑. Match the leader exactly and you
        both keep it.
      </p>
    </div>
  );
}
