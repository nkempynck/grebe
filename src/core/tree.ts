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
