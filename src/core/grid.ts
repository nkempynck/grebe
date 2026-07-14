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
import { DAILY_EPOCH } from "./daily";

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

// Words that don't identify a group on their own — size / colour / locality
// modifiers and articles. Sharing one of these isn't a giveaway, so they don't
// count toward the "too many members share a word" limit.
const NAME_STOPWORDS = new Set([
  "the", "of", "and", "common", "northern", "southern", "eastern", "western",
  "american", "european", "eurasian", "african", "asian", "australian", "oriental",
  "great", "greater", "lesser", "giant", "dwarf", "pygmy", "little", "large", "small",
  "red", "black", "white", "blue", "green", "yellow", "brown", "grey", "gray", "golden",
  "spotted", "striped", "banded", "crested",
]);

/** Distinctive words in a species' common name (lower-cased, modifiers dropped). */
function nameWords(tree: Tree, id: string): string[] {
  const name = tree.byId.get(id)?.common ?? "";
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w));
}

/** Pick `n` distinct members while avoiding a name giveaway — no distinctive word
 *  (e.g. "bear", "heron") may be shared by more than two of them. Greedy over a
 *  seeded shuffle; if the constraint can't be met (a clade whose members really do
 *  all share a word), it fills the shortfall unconstrained so a board is always
 *  produced. Deterministic: consumes the RNG exactly like pickN (one shuffle). */
function pickMembers(tree: Tree, pool: string[], n: number, rng: () => number): string[] {
  const order = shuffle([...pool], rng);
  const chosen: string[] = [];
  const wordCount = new Map<string, number>();
  for (const id of order) {
    if (chosen.length >= n) break;
    const words = nameWords(tree, id);
    if (words.some((w) => (wordCount.get(w) ?? 0) >= 2)) continue;
    chosen.push(id);
    for (const w of words) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
  }
  if (chosen.length < n) {
    const have = new Set(chosen);
    for (const id of order) {
      if (chosen.length >= n) break;
      if (!have.has(id)) chosen.push(id);
    }
  }
  return chosen.slice(0, n);
}

/** The species a group draws from: named leaves when there are enough (nicer
 *  tiles), else all leaves. Shared by member picking and giveaway feasibility. */
function themePool(tree: Tree, leaves: string[]): string[] {
  const named = leaves.filter((id) => tree.byId.get(id)?.common);
  return named.length >= GRID_GROUP_SIZE ? named : leaves;
}

/** How many of a board's groups give themselves away by name — a distinctive word
 *  shared by more than two of the four members (four "…bear"s, three "…heron"s). */
function giveawayCount(tree: Tree, board: GridBoard): number {
  let n = 0;
  for (const g of board.groups) {
    const c = new Map<string, number>();
    let bad = false;
    for (const id of g.memberIds) {
      for (const w of nameWords(tree, id)) {
        const v = (c.get(w) ?? 0) + 1;
        c.set(w, v);
        if (v > 2) bad = true;
      }
    }
    if (bad) n++;
  }
  return n;
}

/** Giveaway groups tolerated at a tier: Sat (6) none; Thu/Fri (4–5) two; easy days
 *  (1–3) no limit (recognisable names help). Sun (7) also has no limit because it's
 *  played in picture mode with names hidden, so a name giveaway can't matter — that
 *  frees its re-roll budget for the mammal-free guard instead. */
function maxGiveaways(tier: number): number {
  if (tier >= 7) return GRID_GROUPS;
  if (tier === 6) return 0;
  if (tier >= 4) return 2;
  return GRID_GROUPS;
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
 *  group labels read nicely; fills from unnamed themes when named run short. Kept
 *  varied (not filtered by giveaway-freeness) so the anti-repeat layer has enough
 *  distinct group-sets to avoid repeats — the giveaway guard is applied at the
 *  board level in boardForDay instead. */
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

interface Discovered {
  /** Candidate containers nearest the target depth for each tier (1…7). */
  windowByTier: Map<number, Container[]>;
  /** Every node id in the Mammalia subtree — excluded as a group on the hardest
   *  days (mammals are too recognisable for brutal). Empty if the tree has none. */
  mammalIds: Set<string>;
}

const TIER_WINDOW = 8; // containers considered per tier before the seeded pick

/** All node ids in a subtree (the clade rooted at `rootId`, inclusive). */
function subtreeIds(tree: Tree, rootId: string): Set<string> {
  const s = new Set<string>();
  const walk = (id: string) => {
    s.add(id);
    for (const c of tree.childrenOf.get(id) ?? []) walk(c);
  };
  walk(rootId);
  return s;
}

/** Expensive, tree-only discovery (theme + container enumeration), plus the
 *  per-tier container windows. Cached per tree so the epoch replay is cheap. */
function discover(tree: Tree): Discovered | null {
  const candidates = containers(tree, allThemes(tree));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1));
  const minD = candidates[0].depth;
  const maxD = candidates[candidates.length - 1].depth;

  // Precompute, per weekday tier, the containers nearest that tier's target depth:
  // tier 1 → shallowest (groups far apart, easy), tier 7 → deepest (sibling groups).
  const windowByTier = new Map<number, Container[]>();
  for (let tier = 1; tier <= 7; tier++) {
    const frac = (tier - 1) / 6;
    const target = minD + frac * (maxD - minD);
    const byCloseness = [...candidates].sort(
      (a, b) => Math.abs(a.depth - target) - Math.abs(b.depth - target)
    );
    windowByTier.set(tier, byCloseness.slice(0, Math.min(TIER_WINDOW, byCloseness.length)));
  }

  const mammalRoot = [...tree.byId.values()].find((n) => n.sciName === "Mammalia")?.id;
  const mammalIds = mammalRoot ? subtreeIds(tree, mammalRoot) : new Set<string>();
  return { windowByTier, mammalIds };
}

const discoverCache = new WeakMap<Tree, Discovered | null>();
function getDiscovered(tree: Tree): Discovered | null {
  if (!discoverCache.has(tree)) discoverCache.set(tree, discover(tree));
  return discoverCache.get(tree) ?? null;
}

/** Weekday difficulty tier for a date (Mon=1 … Sun=7) — matches dailySchedule. */
function tierForDate(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // Sun=0 … Sat=6
  return ((day + 6) % 7) + 1;
}

function shiftDate(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** The cheap per-day board selection over already-discovered containers.
 *  `attempt` salts the seed so the anti-repeat layer can draw an alternative. */
function selectBoard(tree: Tree, d: Discovered, dateKey: string, tier: number, attempt: number): GridBoard {
  const seedKey = attempt === 0 ? `grebe:grid:${dateKey}:${tier}` : `grebe:grid:${dateKey}:${tier}:${attempt}`;
  const rng = mulberry32(xmur3(seedKey));
  const window = d.windowByTier.get(tier) ?? d.windowByTier.get(1)!;
  const container = pickN(window, 1, rng)[0];

  // Four pairwise-disjoint themes, each sampled to four members. From Thursday on
  // (tier ≥ 4) members are picked to avoid a name giveaway within a group; the
  // board-level budget in boardForDay then decides how many such groups a day may
  // still contain. Easy/medium days keep the plain pick — recognisable names help.
  const chosen = pickThemes(container.themes, rng);
  const groups: GridGroup[] = chosen.map((t) => {
    const pool = themePool(tree, t.leaves);
    const memberIds =
      tier >= 4 ? pickMembers(tree, pool, GRID_GROUP_SIZE, rng) : pickN(pool, GRID_GROUP_SIZE, rng);
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
  // = more confusable. Least-confusable → level 0 (yellow), most → level 3. The
  // confusable pair ties on closeness (they share that ancestor), so break the
  // tie by clade breadth (broader = easier colour), then clade id for full
  // determinism.
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

/** A board's four categories, order-independent — the anti-repeat key. */
const groupSig = (b: GridBoard) => b.groups.map((g) => g.cladeId).sort().join(",");

/** Days a board's group-set must stay clear of its recent predecessors: ~3
 *  months (member species vary daily regardless). Capped here — only ~289
 *  distinct category-sets exist, so a larger window would force repeats inside
 *  it (simulated: clean at 90, breaks by 120). */
const GRID_ANTI_REPEAT_WINDOW = 90;
const GRID_ATTEMPTS = 48;

/** One day's board. Re-rolls looking for a board that is unused by `avoid`, within
 *  the tier's name-giveaway budget, and (on Sat/Sun) free of mammal groups. If no
 *  attempt satisfies the extra guards, it falls back to the first merely-fresh
 *  board (anti-repeat wins over the guards), and only to attempt 0 if every attempt
 *  was blocked. */
function boardForDay(tree: Tree, d: Discovered, dateKey: string, tier: number, avoid: (s: string) => boolean): GridBoard {
  const budget = maxGiveaways(tier);
  const noMammals = tier >= 6; // Sat/Sun: mammals are too recognisable for brutal
  const hasMammal = (b: GridBoard) => b.groups.some((g) => d.mammalIds.has(g.cladeId));
  let fresh: GridBoard | null = null;
  for (let attempt = 0; attempt < GRID_ATTEMPTS; attempt++) {
    const board = selectBoard(tree, d, dateKey, tier, attempt);
    if (avoid(groupSig(board))) continue;
    if (giveawayCount(tree, board) <= budget && (!noMammals || !hasMammal(board))) return board;
    if (fresh === null) fresh = board;
  }
  return fresh ?? selectBoard(tree, d, dateKey, tier, 0);
}

/**
 * Build the grid board for a date at a difficulty tier (1 gentle … 7 brutal).
 * Deterministic pure function of (tree, date, tier). Skips any group-set used in
 * the previous GRID_ANTI_REPEAT_WINDOW days so nearby boards don't reuse the same
 * four categories (member species always vary regardless). Returns null only if
 * the tree can't field a board.
 *
 * Replays the boards from DAILY_EPOCH up to the target date, keeping a rolling
 * window of the group-sets actually shown. Anchoring at the fixed epoch (not the
 * target minus a window) makes every date resolve identically no matter which is
 * asked for, so a board shown on one day is visible to the days that follow it —
 * a solid guarantee, not an approximation. Cheap: discovery is cached per tree
 * and each replayed day is O(1).
 */
export function generateGridBoard(tree: Tree, dateKey: string, tier: number): GridBoard | null {
  const d = getDiscovered(tree);
  if (!d) return null;
  if (dateKey <= DAILY_EPOCH) return boardForDay(tree, d, dateKey, tier, () => false);

  const queue: string[] = []; // last WINDOW shown group-sets (FIFO)
  const counts = new Map<string, number>(); // multiset view of queue
  const avoid = (s: string) => (counts.get(s) ?? 0) > 0;

  for (let dk = DAILY_EPOCH; ; dk = shiftDate(dk, 1)) {
    const t = dk === dateKey ? tier : tierForDate(dk);
    const board = boardForDay(tree, d, dk, t, avoid);
    if (dk === dateKey) return board;

    const sig = groupSig(board);
    queue.push(sig);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
    if (queue.length > GRID_ANTI_REPEAT_WINDOW) {
      const old = queue.shift()!;
      const c = (counts.get(old) ?? 0) - 1;
      if (c <= 0) counts.delete(old);
      else counts.set(old, c);
    }
  }
}

/** A single board from an ARBITRARY seed string + tier, with no anti-repeat
 *  replay. For playtest / reshuffle, where the "seed" is not a real date and so
 *  must NOT be fed to generateGridBoard (whose epoch replay only terminates on an
 *  exact date match — a non-date seed would loop forever). Deterministic on
 *  (seed, tier); the seed is used purely to drive the RNG. */
export function gridBoardForSeed(tree: Tree, seed: string, tier: number): GridBoard | null {
  const d = getDiscovered(tree);
  return d ? boardForDay(tree, d, seed, tier, () => false) : null;
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
