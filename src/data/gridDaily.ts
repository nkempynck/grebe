import type { Tree } from "../core";
import { generateGridBoard, type GridBoard } from "../core";
import { todayKey } from "../core/daily";
import { resolveDailyRules } from "./dailySchedule";

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
  const tier = opts?.tier && opts.tier > 0 ? opts.tier : resolveDailyRules(dateKey).tier;
  // Reshuffle walks the REAL daily sequence: reshuffle N shows the anti-repeated board
  // from N days later at the chosen tier. So the bench previews genuine day-to-day
  // variety (full class mix, no short repeats) and the true difficulty — not a stateless,
  // class-skewed one-off. The offset is a real date, so the anti-repeat replay terminates.
  const offset = opts?.reshuffle && opts.reshuffle > 0 ? opts.reshuffle : 0;
  return generateGridBoard(tree, offset > 0 ? shiftDate(dateKey, offset) : dateKey, tier);
}
