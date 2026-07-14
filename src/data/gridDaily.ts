import type { Tree } from "../core";
import { generateGridBoard, gridBoardForSeed, type GridBoard } from "../core";
import { todayKey } from "../core/daily";
import { resolveDailyRules } from "./dailySchedule";

/** Today's (or any date's) grid board. The board's difficulty tier reuses the
 *  species daily's weekday ramp, so the grid gets harder Monday → Sunday in
 *  lock-step — Monday's four groups sit far apart on the tree, Sunday's are
 *  sibling clades that all look alike. Pure function of the date. */
export function gridBoardFor(
  tree: Tree,
  dateKey: string = todayKey(),
  opts?: { tier?: number; seed?: string }
): GridBoard | null {
  // `opts` is an admin playtest override: force a tier and/or reshuffle by
  // salting the seed. Left undefined for real dailies, so today's board never
  // changes shape.
  const tier = opts?.tier && opts.tier > 0 ? opts.tier : resolveDailyRules(dateKey).tier;
  // A reshuffle seed is NOT a real date, so it must skip the date-based replay in
  // generateGridBoard (which would loop forever on a non-date). Use the seed-only
  // single-board path instead. Real dailies keep the anti-repeat generator.
  if (opts?.seed) return gridBoardForSeed(tree, `${dateKey}#${opts.seed}`, tier);
  return generateGridBoard(tree, dateKey, tier);
}
