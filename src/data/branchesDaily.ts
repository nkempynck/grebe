import type { Tree } from "../core";
import { generateBranchesBoard, branchesBoardForSeed, type BranchesBoard } from "../core";
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
  // A reshuffle seed is NOT a real date, so it must skip the date-based replay in
  // generateBranchesBoard (which would loop forever on a non-date). Use the
  // seed-only single-board path. Real dailies keep the anti-repeat generator.
  if (opts?.seed) return branchesBoardForSeed(tree, `${dateKey}#${opts.seed}`, tier);
  return generateBranchesBoard(tree, dateKey, tier);
}
