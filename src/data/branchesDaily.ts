import type { Tree } from "../core";
import { generateBranchesBoard, type BranchesBoard } from "../core";
import { todayKey } from "../core/daily";
import { resolveDailyRules } from "./dailySchedule";

/** Today's (or any date's) Branches board. Reuses the shared weekday difficulty
 *  ramp, so Branches gets harder Monday → Sunday in lock-step with the other
 *  games — Monday's clades sit far apart and mostly anchored, Sunday's are tight
 *  siblings with many empty slots. Pure function of the date. */
export function branchesBoardFor(tree: Tree, dateKey: string = todayKey()): BranchesBoard | null {
  const tier = resolveDailyRules(dateKey).tier;
  return generateBranchesBoard(tree, dateKey, tier);
}
