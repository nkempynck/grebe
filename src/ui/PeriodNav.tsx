import { dailyNumber, todayKey, DAILY_EPOCH } from "../core/daily";
import { canStepBack, canStepForward, periodLabel, periodStart, stepPeriod, type Period } from "../core/period";

/** How a locked board names the window it is withholding. Shared so the three
 *  panels word the play wall the same way. */
export function windowNoun(period: Period): string {
  if (period === "week") return "this week’s leaderboard";
  if (period === "month") return "this month’s leaderboard";
  return "the leaderboard of the day";
}

interface Props {
  /** Which window is being browsed. "all" renders nothing (it has no buckets). */
  period: Period;
  /** Any date inside the bucket currently shown. */
  date: string;
  /** Called with a date inside the neighbouring bucket. */
  onChange: (date: string) => void;
}

/** The ‹ › nav under a leaderboard's period tabs, shared by every board (the two
 *  per-game panels and the combined one, which each used to carry their own copy
 *  of the day-only version).
 *
 *  Steps whole buckets: a day at a time on "By day", a Monday at a time on Week,
 *  a first-of-month at a time on Month. Bounded by the epoch's bucket at one end
 *  and today's at the other, so the current unfinished week is browsable but the
 *  future is not. */
export function PeriodNav({ period, date, onChange }: Props) {
  if (period === "all") return null;
  const today = todayKey();
  const isDay = period === "day";
  // A week/month shows its bucket; a day shows the puzzle number it is.
  const label = isDay
    ? `№${dailyNumber(date)} · ${date}${date === today ? " · today" : ""}`
    : `${periodLabel(period, date)}${periodStart(period, date) === periodStart(period, today) ? " · so far" : ""}`;

  return (
    <div className="lb-daynav">
      <button
        className="lb-daynav-btn"
        onClick={() => onChange(stepPeriod(period, date, -1))}
        disabled={!canStepBack(period, date, DAILY_EPOCH)}
        aria-label={`Previous ${period}`}
      >‹</button>
      <span className="lb-daynav-lbl">{label}</span>
      <button
        className="lb-daynav-btn"
        onClick={() => onChange(stepPeriod(period, date, 1))}
        disabled={!canStepForward(period, date, today)}
        aria-label={`Next ${period}`}
      >›</button>
    </div>
  );
}
