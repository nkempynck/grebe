// "Branches" — reconstruct a slice of the tree of life.
//
// The player sees a skeleton of RECOGNISABLE clades (named groups like "Turban
// snails", "True owls") in their real arrangement. Each group has one empty tip;
// a tray of species must be placed onto the group each belongs to. Some groups
// also show an already-placed species (an ANCHOR) as a worked example.
//
// SOLVABLE BY RECOGNITION, NOT PHYLOGENETICS. Every slot lives in its own
// distinct COMMON-NAMED clade, so placing a species is "which of these groups is
// it?" — a bottlenose dolphin goes with the dolphins, not "is it sister to the
// orca?". The given anchors are useful, not decoration: they sit INSIDE the slot
// groups (a placed dolphin telling you which branch is the dolphins), and the
// board contains ONLY the groups in play — no unrelated filler branches.
//
// Difficulty (shared weekday ramp): an easy board draws groups from far-apart
// branches (owls vs. beetles vs. oaks) and anchors most of them; a hard board
// draws sibling groups that look alike, with more slots and fewer anchors.
//
// Pure: imports only the tree engine — no React, no DOM, no data layer.

import type { Tree } from "./types";
import { leavesUnder, mrca } from "./tree";
import { DAILY_EPOCH } from "./daily";

/** A frozen Branches board, stored by IDENTITY (ids only). Display labels and the
 *  drawn skeleton are re-derived from the current tree at read time, so a name fix
 *  or relabelling never desyncs a pinned board. */
export interface BranchesBoard {
  date: string;
  /** Difficulty tier 1…7 (group separation + slot count), for display/scoring. */
  tier: number;
  /** The region the groups sit in (an ancestor of every leaf) — informational. */
  rootId: string;
  /** Every species leaf on the board (anchors ∪ slots). */
  leafIds: string[];
  /** Leaves shown pre-filled (never draggable): worked examples inside the slot
   *  groups (never in an answer's own final clade) PLUS one representative species
   *  for each context clade — a non-answer family that just fills out the tree. */
  anchorIds: string[];
  /** Empty tips to fill; each sits in its own distinct group clade (the
   *  solvability guarantee). The correct species for a slot IS that leaf. */
  slotIds: string[];
  /** The clade ids the UI labels: every answer group PLUS the context clades (the
   *  rest of the skeleton collapses to bare branch points). Not all of these have a
   *  slot — a context clade is labelled but already filled. */
  groupIds: string[];
  /** The slot species, shuffled — the tray the player drags from. */
  tray: string[];
}

// A group is the shallowest NAMED clade in a branch (scientific name is fine — an
// anchor species inside it makes even a Latin group identifiable) with at least
// two species (so it can host an anchor beside the slot) but not so broad it
// stops being one coherent category. Taking the SHALLOWEST named clade is what
// stops two siblings (e.g. two turban genera) splitting into separate slots.
const MIN_GROUP_LEAVES = 2;
const MAX_GROUP_LEAVES = 24; // coarsest grain — easy days keep broad, order-level groups
const FINE_GROUP_LEAVES = 5; // tightest grain — hard days go family/genus-level
const MIN_GROUPS = 4; // never fewer than four slots

// ---- deterministic RNG (mulberry32 over an xmur3 seed) — as in grid.ts ----

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

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickN<T>(arr: T[], n: number, rng: () => number): T[] {
  return shuffle([...arr], rng).slice(0, n);
}

const isLeaf = (tree: Tree, id: string) => (tree.childrenOf.get(id) ?? []).length === 0;
const hasName = (tree: Tree, id: string) => {
  const n = tree.byId.get(id);
  return Boolean(n && (n.common || n.sciName));
};

/** The significant words of a species' COMMON name (lowercased, ≥3 letters), e.g.
 *  "Gould's wattled bat" → {gould, wattled, bat}. Empty for a Latin-only species
 *  (a scientific tile carries no everyday word to give anything away). Purely
 *  data-driven — no hand-kept word list. */
const nameWords = (tree: Tree, id: string): Set<string> => {
  const c = tree.byId.get(id)?.common;
  if (!c) return new Set();
  return new Set(c.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3));
};

// ---- discovery (tree-only, cached per tree) ----

interface Group {
  cladeId: string;
  leaves: string[];
}

/** Every named clade (scientific or common) with 2..maxLeaves species. The
 *  `maxLeaves` grain sets how tight a group is: coarse = orders, fine = families. */
function allGroups(tree: Tree, maxLeaves: number): Map<string, Group> {
  const out = new Map<string, Group>();
  for (const node of tree.byId.values()) {
    if (isLeaf(tree, node.id) || !hasName(tree, node.id)) continue;
    const leaves = leavesUnder(tree, node.id);
    if (leaves.length < MIN_GROUP_LEAVES || leaves.length > maxLeaves) continue;
    out.set(node.id, { cladeId: node.id, leaves });
  }
  return out;
}

interface Container {
  id: string;
  depth: number;
  /** Pairwise-disjoint groups under this node (the shallowest named clade in each
   *  branch — never nested, so their leaf sets can't overlap). */
  groups: Group[];
}

/** For every node, the shallowest named group in each of its branches (one
 *  bottom-up pass). A node that is itself a group contributes only itself, so the
 *  list is always pairwise disjoint. A node with ≥MIN_GROUPS such groups can host
 *  a board; its depth sets the group separation (shallow = spread out = easy). */
function containers(tree: Tree, groups: Map<string, Group>): Container[] {
  const top = new Map<string, Group[]>();
  const compute = (id: string): Group[] => {
    const cached = top.get(id);
    if (cached) return cached;
    const self = groups.get(id);
    let res: Group[];
    if (self) res = [self];
    else {
      res = [];
      for (const c of tree.childrenOf.get(id) ?? []) res.push(...compute(c));
    }
    top.set(id, res);
    return res;
  };
  compute(tree.rootId);

  const out: Container[] = [];
  for (const [id, list] of top) {
    if (list.length >= MIN_GROUPS) out.push({ id, depth: tree.depthOf.get(id) ?? 0, groups: list });
  }
  return out;
}

/** Group grain by tier: coarse (order-level, broad and well-separated → easy) on
 *  Monday down to fine (family/genus-level, sibling groups that look alike → hard)
 *  on Sunday. This single knob drives difficulty — tighter groups are both harder
 *  to name and sit closer together. */
function grainForTier(tier: number): number {
  return Math.max(FINE_GROUP_LEAVES, Math.round(MAX_GROUP_LEAVES - ((tier - 1) / 6) * (MAX_GROUP_LEAVES - FINE_GROUP_LEAVES)));
}

// Containers (nodes hosting ≥MIN_GROUPS disjoint groups) are found per grain and
// cached, so replaying the epoch across many tiers stays cheap.
const grainCache = new WeakMap<Tree, Map<number, Container[]>>();
function getContainers(tree: Tree, maxLeaves: number): Container[] {
  let m = grainCache.get(tree);
  if (!m) { m = new Map(); grainCache.set(tree, m); }
  let c = m.get(maxLeaves);
  if (!c) { c = containers(tree, allGroups(tree, maxLeaves)); m.set(maxLeaves, c); }
  return c;
}

/** Containers at a tier's grain — widening the grain if that exact grain yields
 *  none, so every tier can always field a board. */
function containersForTier(tree: Tree, tier: number): Container[] {
  for (let mx = grainForTier(tier); mx <= MAX_GROUP_LEAVES; mx += 2) {
    const c = getContainers(tree, mx);
    if (c.length) return c;
  }
  return getContainers(tree, MAX_GROUP_LEAVES);
}

/** Pick the day's container, biased by tier: easy tiers favour SHALLOW containers
 *  (their groups sit far apart across the tree — owls vs. beetles vs. oaks), hard
 *  tiers favour DEEP ones (tight sibling families — one squid family vs. another).
 *  A window around the tier's target keeps day-to-day variety and lets the
 *  anti-repeat layer still find alternatives. */
function pickContainer(tree: Tree, tier: number, rng: () => number): Container {
  const pool = containersForTier(tree, tier);
  if (pool.length <= 1) return pool[0];
  const sorted = [...pool].sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  const center = ((tier - 1) / 6) * (sorted.length - 1); // shallow (Mon) → deep (Sun)
  const half = Math.max(1, Math.round(sorted.length * 0.2));
  const lo = Math.max(0, Math.floor(center - half));
  const hi = Math.min(sorted.length - 1, Math.ceil(center + half));
  return sorted[lo + Math.floor(rng() * (hi - lo + 1))];
}

function tierForDate(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return ((day + 6) % 7) + 1;
}

function shiftDate(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Slots (one per group) rise 4 → 7 with the tier. */
function slotCount(tier: number, available: number): number {
  return Math.min(available, MIN_GROUPS + Math.round(((tier - 1) / 6) * 3));
}
/** Leaves of a group that sit in a DIFFERENT direct branch than the slot — i.e. not
 *  the answer's own final sub-clade. Empty when the group doesn't fork, so a group
 *  never prefills a species right beside its answer. */
function otherBranchLeaves(tree: Tree, groupId: string, slot: string, groupLeaves: string[]): string[] {
  const kids = tree.childrenOf.get(groupId) ?? [];
  if (kids.length < 2) return [];
  const slotBranch = kids.find((k) => leavesUnder(tree, k).includes(slot));
  if (!slotBranch) return [];
  const slotSet = new Set(leavesUnder(tree, slotBranch));
  return groupLeaves.filter((id) => id !== slot && !slotSet.has(id));
}

/** The cheap per-day board selection over the tier's containers. */
function selectBoard(tree: Tree, dateKey: string, tier: number, attempt: number): BranchesBoard {
  const seedKey = attempt === 0 ? `grebe:branches:${dateKey}:${tier}` : `grebe:branches:${dateKey}:${tier}:${attempt}`;
  const rng = mulberry32(xmur3(seedKey));
  const container = pickContainer(tree, tier, rng);

  const k = slotCount(tier, container.groups.length);
  const chosen = pickN(container.groups, k, rng);

  const slotIds: string[] = [];
  const anchorIds: string[] = [];
  const groupIds: string[] = [];
  const usedGroupIds = new Set(chosen.map((g) => g.cladeId));

  // Pass 1: each group's slot (the answer) + its group label. Prefer common-named
  // members so the tray tile reads recognisably.
  const picks = chosen.map((grp) => {
    const named = grp.leaves.filter((id) => tree.byId.get(id)?.common);
    const pool = shuffle(named.length >= 2 ? [...named] : [...grp.leaves], rng);
    return { grp, slot: pool[0] };
  });
  picks.forEach(({ grp, slot }) => {
    slotIds.push(slot);
    groupIds.push(grp.cladeId);
  });
  // Distinctive-word collision model: a shared name word only gives a placement away
  // if it's UNIQUE to one group's answer on this board. Generic words shared across
  // the board — "squid" when every group is a squid family — don't help, so they're
  // allowed; that keeps same-word regions from rendering completely empty.
  const answerWords = picks.map((p) => nameWords(tree, p.slot));
  const wordGroups = new Map<string, number>();
  for (const ws of answerWords) for (const w of ws) wordGroups.set(w, (wordGroups.get(w) ?? 0) + 1);
  const distinctive = (w: string) => (wordGroups.get(w) ?? 0) === 1;
  // No prefilled species (worked example OR context) may carry a word DISTINCTIVE to
  // a single answer — that word would point straight at one clade, whether the
  // species sits in that clade (a give-away) or elsewhere (misleading). Generic
  // words shared across the board ("squid") are fine.
  const clashesAnswer = (id: string) => {
    for (const w of nameWords(tree, id)) if (distinctive(w)) return true;
    return false;
  };

  // Pre-filled context (never draggable) to make the tree fuller and teach the
  // neighbourhood. Amount tapers with the tier — about one per slot on Monday down
  // to none on Sunday.
  const target = Math.round(slotIds.length * (1 - (tier - 1) / 6));
  const used = new Set(slotIds);

  // (a) CONTEXT CLADES: other labelled families/orders in the region that hold NONE
  // of the answers, each shown with one representative species — decoys that fill
  // the tree and teach by elimination ("your species don't go here").
  for (const cg of shuffle(container.groups.filter((g) => !usedGroupIds.has(g.cladeId)), rng)) {
    if (anchorIds.length >= target) break;
    const named = cg.leaves.filter((id) => tree.byId.get(id)?.common);
    const rep = shuffle(named.length ? [...named] : [...cg.leaves], rng).find((id) => !used.has(id) && !clashesAnswer(id));
    if (!rep) continue;
    anchorIds.push(rep);
    used.add(rep);
    groupIds.push(cg.cladeId); // label the context clade too
  }

  // (b) WORKED EXAMPLES inside answer groups, from a DIFFERENT branch than the slot
  // (never the answer's own final clade), if the target isn't met yet.
  const primary = picks.map(({ grp, slot }) =>
    shuffle(otherBranchLeaves(tree, grp.cladeId, slot, grp.leaves), rng).filter((id) => !used.has(id) && !clashesAnswer(id))
  );
  for (let more = true; more && anchorIds.length < target; ) {
    more = false;
    for (const list of primary) {
      if (anchorIds.length >= target) break;
      const next = list.find((id) => !used.has(id));
      if (next) { anchorIds.push(next); used.add(next); more = true; }
    }
  }

  const leafIds = [...anchorIds, ...slotIds];
  let root = leafIds[0];
  for (const id of leafIds) root = mrca(tree, root, id);
  const tray = shuffle([...slotIds], rng);
  return { date: dateKey, tier, rootId: root, leafIds, anchorIds, slotIds, groupIds, tray };
}

/** A board's identity for anti-repeat: its group set. */
const boardSig = (b: BranchesBoard) =>
  b.slotIds.concat(b.anchorIds).map((id) => id).sort().join(",");

const BRANCHES_ANTI_REPEAT_WINDOW = 60;
const BRANCHES_ATTEMPTS = 24;

function boardForDay(tree: Tree, dateKey: string, tier: number, avoid: (s: string) => boolean): BranchesBoard {
  let board = selectBoard(tree, dateKey, tier, 0);
  for (let attempt = 1; attempt < BRANCHES_ATTEMPTS && avoid(boardSig(board)); attempt++) {
    board = selectBoard(tree, dateKey, tier, attempt);
  }
  return board;
}

/**
 * Build the Branches board for a date at a difficulty tier (1 gentle … 7 brutal).
 * Deterministic pure function of (tree, date, tier). Skips any board whose exact
 * species set repeated in the previous window. Replays from DAILY_EPOCH like the
 * grid so every date resolves identically. Returns null only if the tree can't
 * field a board.
 */
export function generateBranchesBoard(tree: Tree, dateKey: string, tier: number): BranchesBoard | null {
  if (getContainers(tree, MAX_GROUP_LEAVES).length === 0) return null;
  if (dateKey <= DAILY_EPOCH) return boardForDay(tree, dateKey, tier, () => false);

  const queue: string[] = [];
  const counts = new Map<string, number>();
  const avoid = (s: string) => (counts.get(s) ?? 0) > 0;

  for (let dk = DAILY_EPOCH; ; dk = shiftDate(dk, 1)) {
    const t = dk === dateKey ? tier : tierForDate(dk);
    const board = boardForDay(tree, dk, t, avoid);
    if (dk === dateKey) return board;

    const sig = boardSig(board);
    queue.push(sig);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
    if (queue.length > BRANCHES_ANTI_REPEAT_WINDOW) {
      const old = queue.shift()!;
      const c = (counts.get(old) ?? 0) - 1;
      if (c <= 0) counts.delete(old);
      else counts.set(old, c);
    }
  }
}

/** A single board from an ARBITRARY seed string + tier, with no anti-repeat
 *  replay — the Branches counterpart to gridBoardForSeed. For playtest / reshuffle
 *  only (a non-date seed must never reach generateBranchesBoard's epoch replay,
 *  which would loop forever). Deterministic on (seed, tier). */
export function branchesBoardForSeed(tree: Tree, seed: string, tier: number): BranchesBoard | null {
  if (getContainers(tree, MAX_GROUP_LEAVES).length === 0) return null;
  return boardForDay(tree, seed, tier, () => false);
}

/** Score a set of placements (slotId → the species id the player dropped there).
 *  Correct when the placed species equals the slot's own leaf id. */
export function scoreBranches(
  board: BranchesBoard,
  placements: Record<string, string | null>
): { correct: number; total: number; wrongIds: string[] } {
  let correct = 0;
  const wrongIds: string[] = [];
  for (const slot of board.slotIds) {
    if (placements[slot] === slot) correct++;
    else wrongIds.push(slot);
  }
  return { correct, total: board.slotIds.length, wrongIds };
}
