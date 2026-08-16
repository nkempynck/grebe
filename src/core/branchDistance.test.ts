import { describe, it, expect } from "vitest";
import { branchDistance, medianBranchDistance, separationTierOf, mrca } from "./tree";
import type { Tree, TaxonNode } from "./types";

// REGRESSION, found 2026-08-16. Sunday — the day that asks for the tightest board of the
// week — served Pteroglossus / Buteo / Ninox / Alcedinidae: a toucan, a hawk, an owl and a
// kingfisher, four different bird ORDERS, and it played as a walkover.
//
// The gates that should have stopped it are all expressed in separation tiers, and every
// one of the six pairs scored 4, so the board cleared them outright. That is not a
// threshold set too low — it is separationTierOf being unable to see. It walks up from the
// MRCA to the first RANKED ancestor, and the flattened tree has no ranked node anywhere
// above these genera until Neognathae (infraclass), because whole order-level nodes are
// missing from it: Charadriiformes, Pelecaniformes and Coraciiformes are simply absent.
// Measured over two generated years, the MRCA resolves to infraclass for 88% of fish boards
// and 82% of bird ones against 1% of mammal boards, so separation is very nearly a constant
// across the two biggest classes in the game.
//
// Branch distance counts splits and needs no ranks, which is the whole point.

const node = (id: string, parentId: string | null, rank?: string): TaxonNode =>
  ({ id, parentId, sciName: id, rank: rank ?? "clade" }) as TaxonNode;

/** Build a Tree from a parent list, computing depthOf/childrenOf the way makeTree does. */
function treeOf(nodes: TaxonNode[]): Tree {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes)
    if (n.parentId) (childrenOf.get(n.parentId) ?? childrenOf.set(n.parentId, []).get(n.parentId)!).push(n.id);
  const depthOf = new Map<string, number>();
  const walk = (id: string, d: number) => {
    depthOf.set(id, d);
    for (const c of childrenOf.get(id) ?? []) walk(c, d + 1);
  };
  walk(nodes[0].id, 0);
  return { byId, childrenOf, depthOf, rootId: nodes[0].id };
}

// The shape that defeats the rank walk: ONE ranked node at the top, then unranked stretches,
// then the groups. tightA/tightB are siblings; farA and farB sit down their own long
// branches. Everything below `cls` is unranked, exactly as the bird tree is between a genus
// and Neognathae.
//
//   cls (class)
//    ├── p ─ q ─ r ─ s ─┬─ tightA        tightA–tightB  2
//    │                  └─ tightB        tightA–farA    9
//    ├── x1 ─ x2 ─ x3 ─── farA           farA–farB      8
//    └── y1 ─ y2 ─ y3 ─── farB
const tree = treeOf([
  node("cls", null, "class"),
  node("p", "cls"), node("q", "p"), node("r", "q"), node("s", "r"),
  node("tightA", "s"), node("tightB", "s"),
  node("x1", "cls"), node("x2", "x1"), node("x3", "x2"), node("farA", "x3"),
  node("y1", "cls"), node("y2", "y1"), node("y3", "y2"), node("farB", "y3"),
]);

describe("the rank walk this backstops", () => {
  // THE BUG, in miniature: both pairs walk up to the same ranked ancestor, so separation
  // cannot tell a sibling pair from one spanning the whole class.
  it("returns the same tier for a sibling pair and a class-spanning one", () => {
    const tight = separationTierOf(tree, mrca(tree, "tightA", "tightB"));
    const far = separationTierOf(tree, mrca(tree, "tightA", "farA"));
    expect(tight).toBe(far);
  });
});

describe("branchDistance", () => {
  it("is 0 for a node against itself", () => {
    expect(branchDistance(tree, "tightA", "tightA")).toBe(0);
  });

  it("counts both legs up to the MRCA", () => {
    expect(branchDistance(tree, "tightA", "tightB")).toBe(2); // siblings
    expect(branchDistance(tree, "tightA", "farA")).toBe(9);   // 5 up, 4 down
    expect(branchDistance(tree, "farA", "farB")).toBe(8);
  });

  it("is symmetric", () => {
    expect(branchDistance(tree, "farA", "tightA")).toBe(branchDistance(tree, "tightA", "farA"));
  });

  // The property that makes it usable at all: it separates what the tier collapses.
  it("distinguishes the pair separationTierOf cannot", () => {
    expect(branchDistance(tree, "tightA", "tightB")).toBeLessThan(branchDistance(tree, "tightA", "farA"));
  });
});

describe("medianBranchDistance", () => {
  it("is 0 for fewer than two ids", () => {
    expect(medianBranchDistance(tree, [])).toBe(0);
    expect(medianBranchDistance(tree, ["tightA"])).toBe(0);
  });

  it("takes the median, so one distant group does not dominate", () => {
    // pairs [2, 8, 9, 9, 9, 9] → 9, not dragged down to the 2 nor up to the 9s alone
    expect(medianBranchDistance(tree, ["tightA", "tightB", "farA", "farB"])).toBe(9);
  });
});

// WHY THERE ARE TWO GATES, and why only one of them runs Mon-Fri. See
// MAX_TIGHTEST_PAIR_DISTANCE and MAX_WEEKEND_BRANCH_DISTANCE in ./grid.
//
// The Connections shape — a real trap plus a group you get for free — is WIDE by median and
// TIGHT by its closest pair. A board with nothing confusable on it is wide by BOTH. The two
// are indistinguishable on the median, so capping the median every day would have thrown
// the good shape away with the bad one. Measured over two generated years, every board of
// the Connections shape has a tightest pair 2 or 3 splits apart, while the Sunday walkover's
// tightest pair is 8.
describe("the two board shapes the gates must tell apart", () => {
  const minPair = (t: Tree, ids: string[]) => {
    const out: number[] = [];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) out.push(branchDistance(t, ids[i], ids[j]));
    return Math.min(...out);
  };
  const connections = ["tightA", "tightB", "farA", "farB"]; // trap + two riders
  const noTrap = ["tightA", "farA", "farB"];                // nothing close to anything

  it("gives both the same median, so the median alone cannot judge a weekday", () => {
    expect(medianBranchDistance(tree, connections)).toBe(9);
    expect(medianBranchDistance(tree, noTrap)).toBe(9);
  });

  it("separates them by the tightest pair, which is what the every-day gate reads", () => {
    expect(minPair(tree, connections)).toBe(2); // a genuinely confusable pair
    expect(minPair(tree, noTrap)).toBe(8);      // nothing to confuse — the walkover shape
  });
});
