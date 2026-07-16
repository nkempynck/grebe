// Grafting out-of-set organisms into the tree at runtime.
//
// The playable/answer set is a curated slice of the tree. But a player should be
// able to GUESS any organism — even one we don't ship — and learn where it sits.
// A guess for such an organism grafts it (and any ancestor clades we're missing)
// into the tree in place, so the cladogram shows its true position and the guess
// scores against the answer normally.
//
// Correctness: every grafted node hangs BELOW the deepest ancestor that already
// exists in the tree (the "connection point"). The daily answer is always an
// in-set species, so no grafted node can be an ancestor of the answer — which
// means the most-recent-common-ancestor of a grafted guess and the answer is
// exactly the connection point. Grafting therefore enriches the DISPLAY without
// changing any warmth/MRCA a snap-to-nearest-ancestor would have produced.

import type { TaxonNode, Tree } from "./types";

/** A minimal ancestor descriptor: enough to materialise a node when grafting. */
export interface GraftAncestor {
  id: string;
  sciName: string;
  common?: string;
  rank: string;
}

/** An out-of-set organism plus the lineage needed to attach it. `lineage` runs
 *  from the species' DIRECT parent (index 0) outward toward the root; at least
 *  one entry must already exist in the tree (the connection point). Ancestors
 *  nearer than that are materialised; the rest are ignored (already present). */
export interface GraftTaxon extends GraftAncestor {
  lineage: GraftAncestor[];
}

/** Graft `t` (and any missing ancestors) into `tree` IN PLACE, marking every
 *  added node `virtual`. Returns the species id, or null if the lineage doesn't
 *  reach the existing tree. Idempotent — re-grafting a present organism is a
 *  no-op that returns its id, so replaying a guess is safe. */
export function graftTaxon(tree: Tree, t: GraftTaxon): string | null {
  if (tree.byId.has(t.id)) return t.id; // already grafted (or shipped)

  // The deepest ancestor we already have: everything nearer the species than
  // this is missing and must be materialised, parent-before-child.
  const connectIdx = t.lineage.findIndex((n) => tree.byId.has(n.id));
  if (connectIdx === -1) return null; // orphan — nothing to hang it from

  const add = (n: GraftAncestor, parentId: string) => {
    if (tree.byId.has(n.id)) return;
    const node: TaxonNode = {
      id: n.id, sciName: n.sciName, common: n.common, rank: n.rank,
      parentId, virtual: true,
    };
    tree.byId.set(n.id, node);
    if (!tree.childrenOf.has(n.id)) tree.childrenOf.set(n.id, []);
    tree.childrenOf.get(parentId)!.push(n.id);
    tree.depthOf.set(n.id, (tree.depthOf.get(parentId) ?? 0) + 1);
  };

  // Missing ancestors, from just inside the connection point down to the species'
  // direct parent (so each node's parent exists before it's added).
  for (let i = connectIdx - 1; i >= 0; i--) add(t.lineage[i], t.lineage[i + 1].id);
  // The species leaf itself.
  add(t, t.lineage[0]?.id ?? t.lineage[connectIdx].id);
  return t.id;
}
