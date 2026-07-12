// A Connections-style board built from the tree of life. Sixteen species fall
// into four hidden groups of four; each group is a real, recognisable clade
// ("Owls", "Beetles"). The player sorts the tiles; a group's clade name is
// revealed only once it's solved.
//
// Difficulty is NOT the breadth of each group (groups are always tight and
// recognisable) — it's the SEPARATION between the four groups. An easy board
// draws its four groups from far-apart branches (owls / beetles / oaks / crabs);
// a hard board draws four SIBLING groups under one deep clade (four bird orders
// that all "look like birds"), so tiles are temptingly cross-placeable.
//
// Pure: imports only the tree engine — no React, no DOM, no data layer.

import type { Tree } from "./types";
import { leavesUnder, mrca } from "./tree";

export const GRID_GROUPS = 4;
export const GRID_GROUP_SIZE = 4;
export const GRID_TILES = GRID_GROUPS * GRID_GROUP_SIZE; // 16

/** A recognisable clade with a handful of member species — one group of four. */
export interface GridGroup {
  /** Clade node id whose subtree the four members come from. */
  cladeId: string;
  /** Group label, revealed on solve (common name preferred, else scientific). */
  label: string;
  /** Scientific name of the clade (shown as a subtitle on solve). */
  sciLabel: string;
  /** The four member species leaf ids. */
  memberIds: string[];
  /** 0 (most obvious) … 3 (trickiest) — a per-group difficulty rank for colour. */
  level: number;
}

export interface GridBoard {
  date: string;
  /** Board difficulty tier 1…7 (drives group separation), for display/scoring. */
  tier: number;
  /** The four solution groups. */
  groups: GridGroup[];
  /** All 16 member species ids, shuffled — the tile order the player sees. */
  tiles: string[];
}

// A group's clade should be tight enough to be one coherent, recognisable
// category — not "all mammals". Between these many leaves qualifies as a theme.
// The shipped tree is almost entirely binary, so groups can't be an anchor's
// direct children; instead we pick pairwise-disjoint theme clades and set
// difficulty by how deep their common container sits.
const MIN_THEME_LEAVES = GRID_GROUP_SIZE; // need at least four to sample
const MAX_THEME_LEAVES = 25;

// ---- deterministic RNG (mulberry32 over an xmur3 seed) ----

function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates using a seeded rng; returns the same array. */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Seeded pick of `n` distinct items from `arr` (order preserved by shuffle). */
function pickN<T>(arr: T[], n: number, rng: () => number): T[] {
  return shuffle([...arr], rng).slice(0, n);
}

// ---- theme discovery ----

interface Theme {
  cladeId: string;
  leaves: string[];
  named: boolean; // has a common name → nicer group label
}

const isLeaf = (tree: Tree, id: string) => (tree.childrenOf.get(id) ?? []).length === 0;

/** Every clade that could serve as one group: an internal node with a coherent
 *  number of member species. Memoised leaf lists ride along. */
function allThemes(tree: Tree): Map<string, Theme> {
  const out = new Map<string, Theme>();
  for (const node of tree.byId.values()) {
    if (isLeaf(tree, node.id)) continue;
    // A theme must have a name to reveal on solve. The flattened tree keeps some
    // bare junction nodes (no scientific name) — those can't label a group.
    if (!node.sciName && !node.common) continue;
    const leaves = leavesUnder(tree, node.id);
    if (leaves.length < MIN_THEME_LEAVES || leaves.length > MAX_THEME_LEAVES) continue;
    out.set(node.id, { cladeId: node.id, leaves, named: Boolean(node.common) });
  }
  return out;
}

interface Container {
  id: string;
  depth: number;
  /** Pairwise-disjoint themes under this node (the shallowest theme in each
   *  branch — never nested, so their leaf sets can't overlap). */
  themes: Theme[];
}

/** For every node, the shallowest theme in each of its branches — computed in one
 *  bottom-up pass. A node that is itself a theme contributes only itself (we don't
 *  descend into it), so the list is always pairwise disjoint. A node qualifying as
 *  a "container" (≥4 such themes) can host a board; its depth is the board's group
 *  separation: shallow = groups spread across the tree (easy), deep = clustered
 *  sibling groups (hard). */
function containers(tree: Tree, themes: Map<string, Theme>): Container[] {
  const top = new Map<string, Theme[]>();
  const compute = (id: string): Theme[] => {
    const cached = top.get(id);
    if (cached) return cached;
    const below: Theme[] = [];
    for (const c of tree.childrenOf.get(id) ?? []) below.push(...compute(c));
    const self = themes.get(id);
    let res: Theme[];
    if (self && self.named) {
      // A clean, recognisable group — take it and stop (don't fragment further).
      res = [self];
    } else if (self) {
      // An unnamed theme: prefer named groups found below (nicer reveal labels);
      // fall back to this shallowest clade only if the whole branch is unnamed.
      res = below.some((t) => t.named) ? below : [self];
    } else {
      res = below;
    }
    top.set(id, res);
    return res;
  };
  compute(tree.rootId);

  const out: Container[] = [];
  for (const [id, list] of top) {
    if (list.length >= GRID_GROUPS) out.push({ id, depth: tree.depthOf.get(id) ?? 0, themes: list });
  }
  return out;
}

/** Seeded pick of four themes, preferring ones with common names so the revealed
 *  group labels read nicely; fills from unnamed themes when named run short. */
function pickThemes(list: Theme[], rng: () => number): Theme[] {
  const shuffled = shuffle([...list], rng);
  const named = shuffled.filter((t) => t.named);
  const rest = shuffled.filter((t) => !t.named);
  return [...named, ...rest].slice(0, GRID_GROUPS);
}

const label = (tree: Tree, id: string) => {
  const n = tree.byId.get(id);
  return n?.common ?? n?.sciName ?? id;
};

/**
 * Build the grid board for a date at a difficulty tier (1 gentle … 7 brutal).
 * Deterministic: a pure function of (tree, date, tier). Returns null only if the
 * tree can't field any valid board (never expected for the shipped taxonomy).
 */
export function generateGridBoard(tree: Tree, dateKey: string, tier: number): GridBoard | null {
  const themes = allThemes(tree);
  const candidates = containers(tree, themes);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1));
  const minD = candidates[0].depth;
  const maxD = candidates[candidates.length - 1].depth;

  // Map the weekday tier onto a target container depth: tier 1 → shallowest
  // (groups far apart, easy), tier 7 → deepest (clustered/sibling groups, hard).
  const frac = Math.min(Math.max((tier - 1) / 6, 0), 1);
  const targetDepth = minD + frac * (maxD - minD);

  const rng = mulberry32(xmur3(`grebe:grid:${dateKey}:${tier}`));

  // Consider the containers nearest the target depth, then seed-pick among them so
  // the same weekday doesn't always reuse one container.
  const byCloseness = [...candidates].sort(
    (a, b) => Math.abs(a.depth - targetDepth) - Math.abs(b.depth - targetDepth)
  );
  const window = byCloseness.slice(0, Math.min(8, byCloseness.length));
  const container = pickN(window, 1, rng)[0];

  // Four pairwise-disjoint themes, each sampled to four members. Prefer members
  // with common names so tiles are recognisable.
  const chosen = pickThemes(container.themes, rng);
  const groups: GridGroup[] = chosen.map((t) => {
    const named = t.leaves.filter((id) => tree.byId.get(id)?.common);
    const pool = named.length >= GRID_GROUP_SIZE ? named : t.leaves;
    const memberIds = pickN(pool, GRID_GROUP_SIZE, rng);
    return {
      cladeId: t.cladeId,
      label: label(tree, t.cladeId),
      sciLabel: tree.byId.get(t.cladeId)?.sciName ?? "",
      memberIds,
      level: 0, // assigned below
    };
  });

  // Within-puzzle difficulty (the yellow→purple colour rank): a group is harder
  // the closer it sits to its nearest neighbour group on the board — those are
  // the ones easy to mix up (Connections' "purple is the trap"). Closeness =
  // depth of the deepest common ancestor it shares with any other group; deeper
  // = more confusable. Least-confusable → level 0 (yellow), most → level 3.
  // The confusable pair ties on closeness (they share that ancestor), so break
  // the tie by clade breadth: the broader, more familiar group takes the easier
  // colour, the narrower one takes the harder. Clade id is a final tiebreak so
  // the ranking is fully deterministic.
  const leafCount = new Map(groups.map((g) => [g.cladeId, leavesUnder(tree, g.cladeId).length]));
  const closeness = (id: string) =>
    Math.max(
      ...groups
        .filter((g) => g.cladeId !== id)
        .map((g) => tree.depthOf.get(mrca(tree, id, g.cladeId)) ?? 0)
    );
  const order = [...groups].sort(
    (a, b) =>
      closeness(a.cladeId) - closeness(b.cladeId) ||
      (leafCount.get(b.cladeId) ?? 0) - (leafCount.get(a.cladeId) ?? 0) ||
      (a.cladeId < b.cladeId ? -1 : 1)
  );
  order.forEach((g, i) => (g.level = i));

  const tiles = shuffle(groups.flatMap((g) => g.memberIds), rng);

  return { date: dateKey, tier, groups, tiles };
}

/** Which solution group a set of four selected tiles forms, plus a Connections
 *  "one away" hint (exactly three share a single group). */
export function checkGridSelection(
  board: GridBoard,
  selectedIds: string[]
): { solvedIndex: number | null; oneAway: boolean } {
  if (selectedIds.length !== GRID_GROUP_SIZE) return { solvedIndex: null, oneAway: false };
  const sel = new Set(selectedIds);
  let bestOverlap = 0;
  let solvedIndex: number | null = null;
  board.groups.forEach((g, i) => {
    const overlap = g.memberIds.filter((id) => sel.has(id)).length;
    if (overlap === GRID_GROUP_SIZE) solvedIndex = i;
    bestOverlap = Math.max(bestOverlap, overlap);
  });
  return { solvedIndex, oneAway: solvedIndex === null && bestOverlap === GRID_GROUP_SIZE - 1 };
}
