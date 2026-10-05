import type { Tree } from "../core";
import { generateBranchesBoard, branchesBenchBoard, type BranchesBoard } from "../core";
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
  // `opts` is the admin test bench: a forced tier (0 = today's) and a press counter in `seed`.
  // Left undefined for real dailies, so today's board is fixed.
  const tier = opts?.tier && opts.tier > 0 ? opts.tier : resolveDailyRules(dateKey).tier;
  // The bench deals a random board per press against its own session history, never the real
  // daily sequence, so it neither repeats itself nor shows the coming dailies.
  if (opts) return branchesBenchBoard(tree, tier, `${tier}:${opts.seed || "0"}`);
  return generateBranchesBoard(tree, dateKey, tier);
}
