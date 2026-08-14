import type { Tree } from "../core";
import { generateGridBoard, type GridBoard } from "../core";
import { todayKey } from "../core/daily";
import { resolveDailyRules } from "./dailySchedule";

/** How far ahead the bench may sample before wrapping. Every board it deals replays the
 *  anti-repeat history from the anchor up to its date, at roughly 140ms per replayed day, so
 *  an unbounded walk is an unbounded stall.
 *
 *  A FULL year of same-weekday boards, because the wrap is visible: at 26 the 27th press
 *  dealt the byte-identical board to the first, and pressing "New board" a few dozen times
 *  reads as the generator cycling through a small set when it is only the bench running out
 *  of dates. A year is the natural unit to judge variety over anyway, since that is what the
 *  anti-repeat windows are tuned against. */
const BENCH_HORIZON_WEEKS = 52;

/** Weekday tier for a date, Mon=1 … Sun=7 — the same mapping generateGridBoard replays. */
const tierOfDate = (dateKey: string): number => {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // Sun=0 … Sat=6
  return ((day + 6) % 7) + 1;
};

const shiftDate = (dateKey: string, delta: number): string => {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

/** Today's (or any date's) grid board. The board's difficulty tier reuses the
 *  species daily's weekday ramp, so the grid gets harder Monday → Sunday in
 *  lock-step — Monday's four groups sit far apart on the tree, Sunday's are
 *  sibling clades that all look alike. Pure function of the date. */
export function gridBoardFor(
  tree: Tree,
  dateKey: string = todayKey(),
  opts?: { tier?: number; reshuffle?: number }
): GridBoard | null {
  // `opts` is an admin playtest override: force a tier and/or reshuffle. Left
  // undefined for real dailies, so today's board never changes shape.
  const forced = opts?.tier && opts.tier > 0 ? opts.tier : 0;
  const offset = opts?.reshuffle && opts.reshuffle > 0 ? opts.reshuffle : 0;

  // Reshuffle walks the REAL daily sequence rather than dealing a stateless one-off, so the
  // bench previews genuine day-to-day variety — the true class mix, and the no-repeat rules
  // actually applied. The offset lands on a real date, so the anti-repeat replay terminates.
  //
  // A FORCED tier steps a WEEK at a time from the next date that really is that weekday,
  // so every sample is a real day's board at its natural tier. Stepping one day at a time
  // instead looked equivalent and was not: the anti-repeat history records only each date's
  // natural-tier board, so a forced-tier sample was checked against boards the bench never
  // showed, and consecutive reshuffles repeated. Measured at tier 1, six of twenty
  // consecutive pairs shared three of four groups; walking the weekday takes that to zero.
  if (forced) {
    let d = dateKey;
    for (let i = 0; i < 7 && tierOfDate(d) !== forced; i++) d = shiftDate(d, 1);
    return generateGridBoard(tree, shiftDate(d, (offset % BENCH_HORIZON_WEEKS) * 7), forced);
  }
  // Each day at its OWN tier. Resolving the tier from the UNSHIFTED date was a quiet bug:
  // reshuffling dealt day+N's board at today's tier, which is an off-tier board for that
  // date and so is not the one committed to the anti-repeat history — so consecutive
  // reshuffles could repeat, the very thing the bench exists to check.
  const target = offset > 0 ? shiftDate(dateKey, offset % (BENCH_HORIZON_WEEKS * 7)) : dateKey;
  return generateGridBoard(tree, target, resolveDailyRules(target).tier);
}
