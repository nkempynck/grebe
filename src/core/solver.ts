import type { GameConfig, Tree } from "./types";
import { isAncestor, leavesUnder, mrca } from "./tree";
import { winTargetId } from "./game";

/**
 * "Par" — how many guesses an INFORMED solver needs for this puzzle. It plays
 * with only the feedback the game itself gives (the shared clade / MRCA of each
 * guess), always probing the densest branch of the still-possible species, then
 * pruning to what's consistent with the answer's response. Deterministic, so the
 * same puzzle always yields the same par. Pure — no React, no DOM.
 *
 * `assist` mirrors the game's assist toggle, so par reflects the toolset the
 * player actually had. Both modes use the same shared-clade feedback to rule
 * candidates out (the cladogram shows it either way); assist only changes probe
 * quality:
 *   • assist on  — the UI narrows the guess box to the consistent clade, so the
 *     player naturally probes the optimal (mass-center) split.
 *   • assist off — the player reads the same feedback but names a member of the
 *     likely branch rather than the mathematically optimal split, so par comes
 *     out realistically higher (~1.5–2×) — a fair yardstick for unassisted play.
 */
export function informedPar(
  tree: Tree,
  config: GameConfig,
  answerId: string,
  assist = true
): number {
  const winSet = new Set(leavesUnder(tree, winTargetId(tree, answerId, config.winWithin)));
  let candidates = leavesUnder(tree, config.scopeRootId); // still-possible answers
  const depthOf = (id: string) => tree.depthOf.get(id) ?? 0;

  let guesses = 0;
  const maxSteps = candidates.length + 1; // safety against a pathological loop
  while (guesses < maxSteps && candidates.length > 0) {
    // Root of the region the candidates still span.
    let root = candidates[0];
    for (const c of candidates) root = mrca(tree, root, c);
    const rootDepth = depthOf(root);

    // Candidate mass on every node from each candidate up to the region root.
    const mass = new Map<string, number>();
    for (const c of candidates) {
      let cur: string | null = c;
      while (cur && depthOf(cur) >= rootDepth) {
        mass.set(cur, (mass.get(cur) ?? 0) + 1);
        if (cur === root) break;
        cur = tree.byId.get(cur)?.parentId ?? null;
      }
    }

    // Choose the probe by walking into the heaviest child. Assisted play (the UI
    // narrows the guess box to the consistent clade) descends all the way to the
    // mass-center leaf — an optimal split. Unassisted, the player reads the same
    // feedback but doesn't compute the optimal split: they commit after the first
    // confident narrowing and just name a member of that branch — a good but
    // non-optimal probe, so it takes more guesses.
    const heaviestChild = (id: string): string | null => {
      const kids = (tree.childrenOf.get(id) ?? []).filter((k) => mass.has(k));
      if (kids.length === 0) return null;
      let best = kids[0];
      for (const k of kids) if ((mass.get(k) ?? 0) > (mass.get(best) ?? 0)) best = k;
      return best;
    };
    let guess: string;
    if (assist) {
      guess = root;
      for (let next = heaviestChild(guess); next; next = heaviestChild(guess)) guess = next;
    } else {
      const branch = heaviestChild(root) ?? root;
      guess = leavesUnder(tree, branch)[0];
    }

    guesses++;
    if (winSet.has(guess)) return guesses;

    // Feedback (available in both modes — the cladogram shows it): the answer
    // shares clade m with the probe and sits OUTSIDE the child of m holding the
    // probe. Keep only candidates consistent with that.
    const m = mrca(tree, guess, answerId);
    let cg = guess;
    for (let p = tree.byId.get(cg)?.parentId ?? null; p && p !== m; p = tree.byId.get(cg)?.parentId ?? null) {
      cg = p;
    }
    candidates = candidates.filter((c) => c !== guess && isAncestor(tree, m, c) && !isAncestor(tree, cg, c));
  }
  return guesses;
}
