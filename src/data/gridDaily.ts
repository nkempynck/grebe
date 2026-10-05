import type { Tree } from "../core";
import { generateGridBoard, gridBenchBoard, type GridBoard } from "../core";
import { todayKey } from "../core/daily";
import { resolveDailyRules } from "./dailySchedule";

/** Today's (or any date's) grid board. The board's difficulty tier reuses the
 *  species daily's weekday ramp, so the grid gets harder Monday → Sunday in
 *  lock-step — Monday's four groups sit far apart on the tree, Sunday's are
 *  sibling clades that all look alike. Pure function of the date. */
export function gridBoardFor(
  tree: Tree,
  dateKey: string = todayKey(),
  opts?: { tier?: number; reshuffle?: number }
): GridBoard | null {
  // `opts` is the admin test bench: a forced tier (0 = today's) and a press counter. Left
  // undefined for real dailies, so today's board never changes shape.
  //
  // The bench deals a random board per press against its own session history (gridBenchBoard),
  // never the real daily sequence. It used to walk real dates a week at a time, which meant
  // the bench showed the admin the coming dailies.
  if (opts) {
    const tier = opts.tier && opts.tier > 0 ? opts.tier : resolveDailyRules(dateKey).tier;
    return gridBenchBoard(tree, tier, `${tier}:${opts.reshuffle ?? 0}`);
  }
  return generateGridBoard(tree, dateKey, resolveDailyRules(dateKey).tier);
}
