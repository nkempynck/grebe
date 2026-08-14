// Leaderboard time windows: the day / ISO week / calendar month a puzzle date
// falls in, and how to step from one bucket to the next.
//
// Every board (per game and combined) browses the same four periods, so the
// bucket maths lives here once rather than in each panel. MUST agree with
// public.in_period() in supabase/leaderboard-periods-2026-08-11.sql: a week runs
// Monday to Sunday (Postgres date_trunc('week')) and a month is a calendar
// month, never a rolling 7 or 30 days.
//
// Pure string arithmetic on YYYY-MM-DD keys held in UTC. Deliberately not local
// Date maths: a puzzle date is a label, not an instant, and stepping it through
// local time would slip an hour either side of a DST change.

/** The windows a board can be filtered to. Mirrors LeaderboardPeriod in
 *  src/data/games.ts, which is the wire value the RPCs receive. */
export type Period = "all" | "month" | "week" | "day";

const key = (d: Date) => d.toISOString().slice(0, 10);
const parse = (k: string) => new Date(`${k}T00:00:00Z`);

/** The Monday of the ISO week containing `k`. */
export function weekStart(k: string): string {
  const d = parse(k);
  // getUTCDay is 0 on Sunday, so shift into a Monday-first week before stepping
  // back to its start.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return key(d);
}

/** The first of the calendar month containing `k`. */
export function monthStart(k: string): string {
  return `${k.slice(0, 7)}-01`;
}

/** The first date of the period containing `k` — the bucket's identity. Two dates
 *  in the same window share it, which is what makes it safe to compare and to
 *  hand to an RPC as `for_date`. "all" has no bucket, so it passes `k` through. */
export function periodStart(period: Period, k: string): string {
  if (period === "week") return weekStart(k);
  if (period === "month") return monthStart(k);
  return k;
}

/** Step `delta` whole periods from the bucket containing `k` (negative goes back).
 *  Always lands on a bucket start, so stepping is stable wherever in the window
 *  you started from. */
export function stepPeriod(period: Period, k: string, delta: number): string {
  const d = parse(periodStart(period, k));
  if (period === "month") d.setUTCMonth(d.getUTCMonth() + delta);
  else d.setUTCDate(d.getUTCDate() + delta * (period === "week" ? 7 : 1));
  return key(d);
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human label for the bucket containing `k`: "Aug 11", "Wk of Aug 10",
 *  "August 2026". The day form is bare on purpose — the panels print the puzzle
 *  number beside it. */
export function periodLabel(period: Period, k: string): string {
  const [y, m, d] = k.split("-");
  if (period === "month") return `${MON[+m - 1]} ${y}`;
  if (period === "week") {
    const [, wm, wd] = weekStart(k).split("-");
    return `Wk of ${MON[+wm - 1]} ${+wd}`;
  }
  return `${MON[+m - 1]} ${+d}`;
}

/** Can the board step back from `k` without leaving the puzzle series? True while
 *  the PREVIOUS bucket still holds a puzzle date, so a week nav stops at the week
 *  the game launched in rather than at the epoch date itself. */
export function canStepBack(period: Period, k: string, epoch: string): boolean {
  if (period === "all") return false;
  return stepPeriod(period, k, -1) >= periodStart(period, epoch);
}

/** Can the board step forward? True while the NEXT bucket has already started, so
 *  the current (unfinished) week or month is browsable but the future is not. */
export function canStepForward(period: Period, k: string, today: string): boolean {
  if (period === "all") return false;
  return stepPeriod(period, k, 1) <= today;
}
