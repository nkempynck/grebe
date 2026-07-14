import type { Tree } from "../core";
import { generateBranchesBoard, type BranchesBoard } from "../core";
import { todayKey } from "../core/daily";
import { resolveDailyRules } from "./dailySchedule";

/** Today's (or any date's) Branches board. Reuses the shared weekday difficulty
 *  ramp, so Branches gets harder Monday → Sunday in lock-step with the other
 *  games — Monday's clades sit far apart and mostly anchored, Sunday's are tight
 *  siblings with many empty slots. Pure function of the date. */
export function branchesBoardFor(
  tree: Tree,
  dateKey: string = todayKey(),
  opts?: { tier?: number; seed?: string }
): BranchesBoard | null {
  // `opts` is an admin playtest override: force a tier and/or reshuffle by
  // salting the seed. Left undefined for real dailies, so today's board is fixed.
  const tier = opts?.tier && opts.tier > 0 ? opts.tier : resolveDailyRules(dateKey).tier;
  const seedKey = opts?.seed ? `${dateKey}#${opts.seed}` : dateKey;
  return generateBranchesBoard(tree, seedKey, tier);
}
