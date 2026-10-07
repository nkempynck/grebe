import type { Tree } from "./types";
import { mrca, separationTierOf } from "./tree";

// How alike the groups under a clade LOOK, relative to what its rank suggests. Kinship reads
// difficulty from the rank of the clade two groups share, and ranks are not comparable across
// the tree: a snake family is one body plan with variations, while Bovidae holds cattle,
// sheep, antelopes and gazelles. On 2026-10-04 a Sunday board of yak, red deer, sheep and
// gazelles scored as tight (they share Bovidae) and played as trivial.
//
// +1: the groups look more alike than the rank says, so a pair under this clade counts one
// tier closer (harder). -1: they look more different, so the pair counts one tier further.
// The NEAREST listed clade above a pair's shared ancestor wins, so an entry deeper in the
// tree overrides one above it. Read by Kinship (pairSeparation in grid.ts) and Branches.
//
// This is a JUDGEMENT table, kept deliberately coarse (-1, 0, +1). It is checked against play
// data per class (normalised daily scores after allowing for weekday and separation): at the
// first check, 2026-10-04, fish and insects played harder than the ruler predicted and mammals
// easier, in both Kinship and Branches. Revisit it as data accumulates. Turtles, songbirds,
// gamebirds, beetles, orthopterans and mantises were added on 2026-10-05 from boards the user judged on the test bench.
//
// OPEN: perch-like fish. Their pairs meet at Percomorphaceae (unranked) and read their
// closeness from the rank above. That was Acanthomorphata, wrongly ranked an order, which read
// them one step tighter; since 2026-10-07 it is a superorder (patch-seprank-homonyms.mjs).
// Check perch-like boards on the bench before the next repin and decide whether an entry here
// should make up the step.
export const LOOKALIKE: Record<string, { adj: number; why: string }> = {
  // Mammals
  Bovidae: { adj: -1, why: "cattle, sheep and goats, antelopes, gazelles: different builds" },
  Caniformia: { adj: -1, why: "dogs, bears, seals, raccoons, weasels: different body plans" },
  Mustelidae: { adj: -1, why: "weasels, badgers, otters, martens look distinct" },
  Cetacea: { adj: 1, why: "whales, dolphins and porpoises look alike to most players" },
  Chiroptera: { adj: 1, why: "bats look alike" },
  Muroidea: { adj: 1, why: "mice, rats, voles and hamsters look alike" },
  // Birds
  Strigiformes: { adj: 1, why: "owls all look like owls" },
  Columbiformes: { adj: 1, why: "pigeons and doves share one shape" },
  Passeriformes: { adj: 1, why: "songbird families look alike to most players" },
  Galliformes: { adj: 1, why: "gamebirds (grouse, quail, curassows, megapodes) share one build" },
  // Fish
  Actinopterygii: { adj: 1, why: "to most players a fish is a fish" },
  Selachii: { adj: 1, why: "sharks look alike" },
  // Reptiles
  Serpentes: { adj: 1, why: "snakes are one body plan" },
  Testudines: { adj: 1, why: "to most players a turtle is a turtle" },
  // Amphibians
  Anura: { adj: 1, why: "frogs look alike" },
  // Insects
  Lepidoptera: { adj: 1, why: "moth families look alike" },
  Apoidea: { adj: 1, why: "bees and wasps look alike" },
  Blattodea: { adj: 1, why: "cockroaches and termites look alike" },
  Coleoptera: { adj: 1, why: "beetle families look alike to most players" },
  Orthoptera: { adj: 1, why: "grasshoppers, katydids and crickets look alike" },
  Mantodea: { adj: 1, why: "mantis families look alike" },
  // Spiders
  Araneae: { adj: 1, why: "spiders look alike" },
};

const MAX_SEPARATION = 7;

/** The LOOKALIKE adjustment of the nearest listed clade at or above `id`, else 0. */
function lookalikeAdjust(tree: Tree, id: string): number {
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    const n = tree.byId.get(c);
    const hit = n && !n.synthetic ? LOOKALIKE[n.sciName] : undefined;
    if (hit) return hit.adj;
  }
  return 0;
}

/** separationTierOf(mrca) corrected by the table, kept on the 1..7 scale. */
export function lookalikeSeparation(tree: Tree, a: string, b: string): number {
  const m = mrca(tree, a, b);
  return Math.max(1, Math.min(MAX_SEPARATION, separationTierOf(tree, m) + lookalikeAdjust(tree, m)));
}

/** The median over all pairs of `ids` of lookalikeSeparation (medianSeparationTier, corrected). */
export function medianLookalikeSeparation(tree: Tree, ids: string[]): number {
  const pairs: number[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push(lookalikeSeparation(tree, ids[i], ids[j]));
  if (pairs.length === 0) return 1;
  pairs.sort((a, b) => a - b);
  const m = Math.floor(pairs.length / 2);
  return pairs.length % 2 ? pairs[m] : (pairs[m - 1] + pairs[m]) / 2;
}
