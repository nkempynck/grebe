import type { TaxonNode, Tree } from "./types";

/** Build an indexed Tree from a flat list of nodes. Runs once at load. */
export function buildTree(nodes: TaxonNode[]): Tree {
  const byId = new Map<string, TaxonNode>();
  const childrenOf = new Map<string, string[]>();
  let rootId: string | null = null;

  for (const n of nodes) {
    if (byId.has(n.id)) throw new Error(`Duplicate node id: ${n.id}`);
    byId.set(n.id, n);
    if (!childrenOf.has(n.id)) childrenOf.set(n.id, []);
  }

  for (const n of nodes) {
    if (n.parentId === null) {
      if (rootId) throw new Error(`Multiple roots: ${rootId} and ${n.id}`);
      rootId = n.id;
    } else {
      const siblings = childrenOf.get(n.parentId);
      if (!siblings) throw new Error(`Node ${n.id} has unknown parent ${n.parentId}`);
      siblings.push(n.id);
    }
  }
  if (!rootId) throw new Error("Tree has no root (a node with parentId === null)");

  // BFS to record depth from root. Uses a head cursor rather than queue.shift(),
  // which is O(n) per call and would make this O(n^2) over the whole tree.
  const depthOf = new Map<string, number>();
  const queue: Array<[string, number]> = [[rootId, 0]];
  for (let head = 0; head < queue.length; head++) {
    const [id, d] = queue[head];
    depthOf.set(id, d);
    for (const c of childrenOf.get(id) ?? []) queue.push([c, d + 1]);
  }

  return { byId, childrenOf, depthOf, rootId };
}

/** Node ids from `id` up to the dataset root, inclusive of both ends.
 *  Index 0 is the node itself, last element is the root. */
export function ancestryChain(tree: Tree, id: string): string[] {
  const chain: string[] = [];
  let cur: string | null = id;
  while (cur !== null) {
    chain.push(cur);
    cur = tree.byId.get(cur)?.parentId ?? null;
  }
  return chain;
}

/** Most recent common ancestor of two nodes. */
export function mrca(tree: Tree, a: string, b: string): string {
  const aAncestors = new Set(ancestryChain(tree, a));
  for (const id of ancestryChain(tree, b)) {
    if (aAncestors.has(id)) return id;
  }
  // Guaranteed to meet at the root in a well-formed single-rooted tree.
  return tree.rootId;
}

// SEPARATION → difficulty tier (1 easy … 7 hard), shared by Kinship and Branches. What
// makes a set of groups hard is how closely related they are — read off the RANK of their
// most-recent common ancestor. Groups whose MRCA is a genus/family are near-siblings,
// temptingly confusable, hard; groups spanning an order are distinct and easy; groups
// spanning a whole class are trivially separable. Deeper (finer-ranked) MRCA = tighter =
// harder. Rank-based (not raw tree depth) so it reads consistently across taxa whose trees
// are resolved to different granularities.
export const MRCA_TIER: Record<string, number> = {
  subgenus: 7, "species group": 7, "species subgroup": 7, genus: 7,
  subtribe: 6, tribe: 6, subfamily: 6, family: 6, section: 6,
  superfamily: 5,
  infraorder: 4, parvorder: 4, suborder: 4, infraclass: 4,
  order: 3,
  magnorder: 2, superorder: 2, cohort: 2, subcohort: 2,
  subclass: 1, class: 1, subphylum: 1, phylum: 1, superclass: 1, subterclass: 1,
};

/** Separation tier of a node: its rank via MRCA_TIER, or — for the unranked junction
 *  nodes a flattened tree keeps — the nearest RANKED ancestor (a shallower node → an
 *  easier, conservative read; nothing is called hard just for lacking a rank label). */
export function separationTierOf(tree: Tree, id: string): number {
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    const t = MRCA_TIER[tree.byId.get(c)?.rank ?? ""];
    if (t !== undefined) return t;
  }
  return 1; // no ranked ancestor at all → a very high clade → easy
}

/** The MEDIAN over all pairs of `ids` of their MRCA-rank separation (separationTierOf of
 *  each pair's MRCA). Median — not the single all-way MRCA — is robust to one distant
 *  outlier among otherwise-tight groups. Returns 1 for fewer than two ids. */
export function medianSeparationTier(tree: Tree, ids: string[]): number {
  const pairs: number[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      pairs.push(separationTierOf(tree, mrca(tree, ids[i], ids[j])));
  if (pairs.length === 0) return 1;
  pairs.sort((a, b) => a - b);
  const m = Math.floor(pairs.length / 2);
  return pairs.length % 2 ? pairs[m] : (pairs[m - 1] + pairs[m]) / 2;
}

/** Is `maybeAncestor` on the path from `id` to the root? (inclusive) */
export function isAncestor(tree: Tree, maybeAncestor: string, id: string): boolean {
  let cur: string | null = id;
  while (cur !== null) {
    if (cur === maybeAncestor) return true;
    cur = tree.byId.get(cur)?.parentId ?? null;
  }
  return false;
}

/** All node ids in the subtree rooted at `rootId` (inclusive). */
export function descendants(tree: Tree, rootId: string): string[] {
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    for (const c of tree.childrenOf.get(id) ?? []) stack.push(c);
  }
  return out;
}

/** Leaf node ids (no children) in the subtree rooted at `rootId`. */
const leavesUnderCache = new WeakMap<Tree, Map<string, string[]>>();
export function leavesUnder(tree: Tree, rootId: string): string[] {
  let byTree = leavesUnderCache.get(tree);
  if (!byTree) leavesUnderCache.set(tree, (byTree = new Map()));
  const hit = byTree.get(rootId);
  if (hit) return hit;
  const res = descendants(tree, rootId).filter(
    (id) => (tree.childrenOf.get(id) ?? []).length === 0
  );
  byTree.set(rootId, res);
  return res;
}

/** Number of edges between two nodes where one is an ancestor of the other. */
export function edgeDistance(tree: Tree, a: string, b: string): number {
  const da = tree.depthOf.get(a);
  const db = tree.depthOf.get(b);
  if (da === undefined || db === undefined) throw new Error("Unknown node in edgeDistance");
  return Math.abs(da - db);
}

/** A node in a minimal "display" tree — the shape a cladogram is drawn from.
 *  Every id refers to a real TaxonNode; `isBranch` just marks a node that was
 *  kept only because two kept lineages split there (an MRCA), not because the
 *  caller asked for it by name. */
export interface DisplayTreeNode {
  id: string;
  children: DisplayTreeNode[];
  isBranch: boolean;
}

/**
 * Build the smallest tree that still connects every id in `keepIds`, rooted at
 * their MRCA. Single-child pass-through nodes are collapsed away, so what's left
 * is exactly the shared-ancestor structure a player cares about: the clades where
 * their guesses (and the answer) branch apart. Pure — no React, no DOM.
 */
export function inducedSubtree(
  tree: Tree,
  keepIds: string[],
  /** Optionally force-keep other nodes on the retained paths (e.g. named clades,
   *  so their labels survive instead of collapsing into a bare junction). */
  keepIf?: (id: string) => boolean
): DisplayTreeNode | null {
  const keep = new Set(keepIds.filter((id) => tree.byId.has(id)));
  if (keep.size === 0) return null;

  // Root the drawing at the shallowest clade shared by everything we're keeping.
  let rootId = [...keep][0];
  for (const id of keep) rootId = mrca(tree, rootId, id);

  const containsMemo = new Map<string, boolean>();
  const contains = (id: string): boolean => {
    const cached = containsMemo.get(id);
    if (cached !== undefined) return cached;
    let res = keep.has(id);
    if (!res) {
      for (const c of tree.childrenOf.get(id) ?? []) {
        if (contains(c)) { res = true; break; }
      }
    }
    containsMemo.set(id, res);
    return res;
  };

  const build = (id: string): DisplayTreeNode[] => {
    const kids = (tree.childrenOf.get(id) ?? []).filter(contains);
    if (keep.has(id) || keepIf?.(id)) return [{ id, isBranch: false, children: kids.flatMap(build) }];
    if (kids.length >= 2) return [{ id, isBranch: true, children: kids.flatMap(build) }];
    return kids.flatMap(build); // 0 or 1 relevant child → collapse this link away
  };

  const top = build(rootId);
  return top.length === 1 ? top[0] : { id: rootId, isBranch: true, children: top };
}
