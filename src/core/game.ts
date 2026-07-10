import type { GameConfig, GuessResult, TaxonNode, Tree } from "./types";
import { ancestryChain, edgeDistance, isAncestor, mrca } from "./tree";

/** Resolution ladder: winWithin is an INDEX into this list of real taxonomic
 *  ranks (0 = exact species, 1 = genus, 2 = family, 3 = order). We win by SHARED
 *  RANK, not by counting edges in the drawn tree — the tree collapses single-child
 *  links, so an edge count doesn't map cleanly onto a rank. */
export const WIN_RANK_LADDER = ["species", "genus", "family", "order"] as const;

/** The answer's ancestor a guess must fall inside to win at the given resolution.
 *  Broadens up the answer's lineage only as far as that rank actually EXISTS in
 *  the data — so "same family" never invents a family the tree doesn't have; it
 *  tightens to the nearest real grouping (genus, or exact) instead. */
export function winTargetId(tree: Tree, answerId: string, winWithin: number): string {
  const maxIdx = Math.max(0, Math.min(winWithin, WIN_RANK_LADDER.length - 1));
  const chain = ancestryChain(tree, answerId); // answer → root
  let target = answerId; // exact species by default
  for (let i = 1; i <= maxIdx; i++) {
    const hit = chain.find((id) => tree.byId.get(id)?.rank === WIN_RANK_LADDER[i]);
    if (hit) target = hit;
  }
  return target;
}

/**
 * Score a single guess against the hidden answer, under the current scope.
 *
 * The important subtlety (see README "why narrowing scope weakens the signal"):
 * warmth is rescaled RELATIVE TO THE SCOPE ROOT, not the whole tree. In a
 * birds-only game every guess already shares Aves, so a global warmth score
 * would flatten to "all hot" and feel dead. Here, warmth 0 means the guess
 * only shares the scope root with the answer (coldest possible *within scope*)
 * and warmth 1 means an exact hit.
 */
export function evaluateGuess(
  tree: Tree,
  answerId: string,
  guessId: string,
  config: GameConfig
): GuessResult {
  const guess = tree.byId.get(guessId);
  const answer = tree.byId.get(answerId);
  if (!guess) throw new Error(`Unknown guess id: ${guessId}`);
  if (!answer) throw new Error(`Unknown answer id: ${answerId}`);

  const shared = mrca(tree, guessId, answerId);

  // Edges from the answer leaf up to the shared ancestor. 0 == exact match.
  const stepsFromAnswer = edgeDistance(tree, answerId, shared);

  // Rescale to scope: how far down the scopeRoot -> answer path did we land?
  const answerPathLen = edgeDistance(tree, config.scopeRootId, answerId);
  const mrcaDepthFromScope = edgeDistance(tree, config.scopeRootId, shared);
  const warmth = answerPathLen === 0 ? 1 : mrcaDepthFromScope / answerPathLen;

  // Only a species (a leaf) can win — guessing a whole clade ("snakes") is a
  // scouting probe that narrows the tree but never counts as finding the answer,
  // even under a loose resolution. A win = the guess shares the answer's clade at
  // the resolution's rank (its genus/family/order, or the exact species).
  const guessIsSpecies = (tree.childrenOf.get(guessId) ?? []).length === 0;
  const targetId = winTargetId(tree, answerId, config.winWithin);
  const isWin = guessIsSpecies && isAncestor(tree, targetId, guessId);

  return { guess, mrca: tree.byId.get(shared)!, stepsFromAnswer, warmth, isWin };
}

/** Whether a node id is a legal guess for the current scope: it must be a
 *  descendant of the scope root (the scope root itself is not guessable). */
export function isInScope(tree: Tree, config: GameConfig, id: string): boolean {
  if (id === config.scopeRootId) return false;
  return isAncestor(tree, config.scopeRootId, id);
}

/** A short human label for how close a guess landed, given its result. */
export function closenessLabel(result: GuessResult): string {
  if (result.isWin && result.stepsFromAnswer === 0) return "Exact match";
  if (result.isWin) return `Close enough — shares ${result.mrca.rank} ${displayName(result.mrca)}`;
  return `Branches apart at ${result.mrca.rank}: ${displayName(result.mrca)}`;
}

/** Full label: "Common name (Scientific name)" when a common name exists,
 *  otherwise just the scientific name (clades rarely have a common one). */
export function displayName(n: TaxonNode): string {
  return n.common ? `${n.common} (${n.sciName})` : n.sciName;
}
