import { useEffect, useState } from "react";
import { fetchCombinedDaily, type CombinedEntry } from "../data/games";
import { todayKey, dailyNumber, DAILY_EPOCH } from "../core/daily";

interface Props {
  /** Signed-in player's display name, to highlight their own row. */
  me: string | null;
}

/** Podium medals for ranks 1–3; plain numbers below. */
const MEDALS = ["🥇", "🥈", "🥉"];

function stepDate(key: string, delta: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** One combined daily board: each of the three games scored 0–100 (the player's
 *  score as a share of that game's top score on the day), summed for a single
 *  total out of 300. Browsable back to the epoch; defaults to today. */
export function CombinedLeaderboard({ me }: Props) {
  const today = todayKey();
  const [dayDate, setDayDate] = useState<string>(today);
  const [rows, setRows] = useState<CombinedEntry[] | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    fetchCombinedDaily(dayDate).then((r) => {
      if (live) setRows(r);
    });
    return () => { live = false; };
  }, [dayDate]);

  const myIdx = rows && me ? rows.findIndex((r) => r.display_name === me) : -1;

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

      {rows === null ? (
        <p className="stats-empty">Loading…</p>
      ) : rows.length === 0 ? (
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
            {rows.slice(0, 10).map((r, i) => {
              const isMe = r.display_name === me;
              return (
                <div className={`lb-row${isMe ? " is-me" : ""}${i < 3 ? " is-podium" : ""}`} key={r.display_name}>
                  <span className={`lb-rank${i < 3 ? " is-medal" : ""}`}>{i < 3 ? MEDALS[i] : i + 1}</span>
                  <span className="lb-name">{r.display_name}{isMe && <span className="lb-youtag">you</span>}</span>
                  <span className="lb-meta" title="games played today">{r.played}/3</span>
                  <span className="lb-score">{r.combined}</span>
                </div>
              );
            })}
          </div>

          <div className="lb-foot">
            <span>{rows.length} player{rows.length === 1 ? "" : "s"}</span>
            {me && (
              myIdx >= 0 ? (
                <span className="lb-you">You · #{myIdx + 1} of {rows.length} · {rows[myIdx].combined} pts</span>
              ) : (
                <span className="lb-you is-unranked">You · not ranked here yet</span>
              )
            )}
          </div>
        </>
      )}

      <p className="lb-note">
        Each game scored 0–100 (your score as a share of the day’s best in that game), then averaged
        across Lineage, Kinship and Branches for one daily total out of 100. Play all three to top it.
      </p>
    </div>
  );
}
