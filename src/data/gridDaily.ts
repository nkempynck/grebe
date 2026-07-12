import type { Tree } from "../core";
import { generateGridBoard, type GridBoard } from "../core";
import { todayKey } from "../core/daily";
import { resolveDailyRules } from "./dailySchedule";

/** Today's (or any date's) grid board. The board's difficulty tier reuses the
 *  species daily's weekday ramp, so the grid gets harder Monday → Sunday in
 *  lock-step — Monday's four groups sit far apart on the tree, Sunday's are
 *  sibling clades that all look alike. Pure function of the date. */
export function gridBoardFor(tree: Tree, dateKey: string = todayKey()): GridBoard | null {
  const tier = resolveDailyRules(dateKey).tier;
  return generateGridBoard(tree, dateKey, tier);
}
