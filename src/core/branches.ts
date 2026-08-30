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
// Difficulty (shared weekday ramp), stacked levers Monday → Sunday:
//   • GROUP GRAIN — broad order-level groups (easy) → fine family/genus groups (hard).
//   • GROUP SEPARATION — far-apart branches (owls vs. beetles vs. oaks, easy) → tight
//     sibling groups that look alike (hard).
//   • SLOT COUNT — 4 → 7, and WORKED EXAMPLES — most groups anchored (easy) → one or two
//     (hard). Only the worked examples taper; the context species that fill out the rest
//     of the tree are flat across the week, so a hard board is tight, not empty.
//   • SHARED-WORD FLOOR — the reverse of Kinship's cap: the tray must hold at least
//     2 (Mon) rising to 4 (Sun) look-alike names (two "sparrows"), so a bare word-match
//     stops being enough and you must place each species on its own clade.
//
// Pure: imports only the tree engine — no React, no DOM, no data layer.

import type { Tree } from "./types";
import { leavesUnder, mrca, medianSeparationTier } from "./tree";
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
// Total species drawn on a board (slots + everything pre-filled). The skeleton pans and
// zooms, but the radial view lays its tips around a wedge of fixed angle, so every extra
// leaf costs the others room: 14 put roughly three unresolvable box collisions on an
// average board, 12 with the radius scaling in branchesLayout puts a quarter of one.
const MAX_BOARD_LEAVES = 12;
// How many species one CONTEXT clade may show. Two or three make a branch that visibly
// forks; one leaves a bare twig, which is what the tree looked like before.
const CONTEXT_PER_CLADE = 3;
// How many species one NEIGHBOURING clade (a branch beside the answer region) may show,
// and how far up the tree the search for those branches may walk.
const NEIGHBOUR_PER_CLADE = 2;
const NEIGHBOUR_LEVELS = 3;

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

/** The HEAD NOUN of a species' common name — its LAST significant word (≥3 letters). This
 *  is the "kind" word that makes two tray tiles genuine look-alikes: "Java Sparrow" /
 *  "House Sparrow" → "sparrow"; "Jumping spider" / "Crab spider" → "spider". Crucially it
 *  is NOT a descriptive modifier: "Long-tailed chinchilla" / "Black-tailed jackrabbit"
 *  have heads "chinchilla" / "jackrabbit" — their shared "tailed" is not a collision, and
 *  an obvious chinchilla-vs-jackrabbit pair no longer counts toward the floor. In an
 *  English animal name the head is (almost) always the last word; modifiers precede it, so
 *  no hand-kept modifier list is needed. Null for a Latin-only species. */
export const headWord = (tree: Tree, id: string): string | null => {
  const c = tree.byId.get(id)?.common;
  if (!c) return null;
  const toks = c.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3);
  return toks.length ? toks[toks.length - 1] : null;
};

/** Shared-word FLOOR — the reverse of Kinship's cap. How many of the day's tray species
 *  must share a HEAD NOUN with another tray species (two "sparrows", three "terns").
 *  Always ≥ 2, rising to 4 by Sunday, so hard days pack the tray with look-alike names
 *  that a bare word-match can't tell apart — you must actually place each species on its
 *  own clade. A soft target: a board whose groups genuinely can't collide is allowed
 *  (its difficulty is carried by the separation band instead). */
export function sharedWordFloor(tier: number): number {
  return 2 + Math.round(((tier - 1) / 6) * 2); // 2 (Mon/Tue) … 3 (mid) … 4 (Sat/Sun)
}

// Per-tier window on a board's ACTUAL answer-group separation (median MRCA-rank tier over
// the answer groups, via medianSeparationTier). This is the difficulty GATE — it scores
// the real groups on the board, not the container's aggregate, so a spread cross-class
// subset (butterfly + shark + gecko…) can never land on a hard day, and a tight genus
// board can never land on Monday. Wide, overlapping windows: a lean, not a knife-edge,
// with anti-repeat retry finding an in-band board. Index by weekday tier 1…7 (0 unused).
const SEP_BAND: Array<[number, number]> = [
  [0, 0], [1, 2], [1, 3], [2, 4], [2, 5], [3, 5], [3, 6], [4, 7],
];

// Broad "Lineage-style" groups a board must stay WITHIN — no board ever mixes two classes
// (no chinchilla-and-cockatoo board), exactly as Kinship. A container node ABOVE every
// class marker (Amniota, Tetrapoda, Bilateria…) maps to "other" and can never host a
// board, so every board sits inside one class; a node BELOW a marker inherits that class.
// Mirrors grid.ts's BROAD_GROUPS markers — keep the two lists in sync.
const BROAD_MARKERS: Record<string, string> = {
  Mammalia: "Mammals", Aves: "Birds",
  Actinopterygii: "Fish", Elasmobranchii: "Fish", Chondrichthyes: "Fish",
  Squamata: "Reptiles", Testudines: "Reptiles", Crocodylia: "Reptiles",
  Amphibia: "Amphibians", Insecta: "Insects",
  Arachnida: "Spiders", Araneae: "Spiders", // this tree has no Arachnida node; Araneae (order "Spiders") is the marker
  Gastropoda: "Molluscs", Bivalvia: "Molluscs", Cephalopoda: "Molluscs",
  Magnoliopsida: "Plants", Liliopsida: "Plants", Pinopsida: "Plants", Polypodiopsida: "Plants",
};
/** The broad group a node sits in: the OUTERMOST (broadest) marker ancestor's group, or
 *  "other" if it sits above every class marker (→ can't host a board, so no board spans
 *  two classes). */
function broadGroupOf(tree: Tree, id: string): string {
  let group = "other";
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    const s = tree.byId.get(c)?.sciName;
    if (s && BROAD_MARKERS[s]) group = BROAD_MARKERS[s];
  }
  return group;
}

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
  /** Broad class this container sits in (Mammals/Birds/…/Plants) — every board stays
   *  within one, and the min-tier gate keeps the unfamiliar ones off the easy days. */
  group: string;
  /** Group SEPARATION as a difficulty tier (1 spread/easy … 7 tight/hard): the median
   *  MRCA-rank separation of the container's groups (shared with Kinship, via
   *  medianSeparationTier). Rank-based, not raw tree depth, so it reads consistently
   *  across taxa resolved to different granularities. */
  sepTier: number;
  /** Pairwise-disjoint groups under this node (the shallowest named clade in each
   *  branch — never nested, so their leaf sets can't overlap). */
  groups: Group[];
  /** The group grain this container was found at, so the neighbour fill can read the
   *  branches beside it from the SAME pass (see Grain.shallow). */
  grain: number;
  /** Groups that can host a slot, deduplicated by label — memoised on first use, see
   *  eligibleGroups. */
  eligible?: Group[];
}

/** One grain's worth of discovery: the containers that can host a board, plus the
 *  shallowest-groups-per-node map the pass built on the way. */
interface Grain {
  list: Container[];
  shallow: Map<string, Group[]>;
}

// Structurally-unfamiliar classes are barred from the easy early-week days (as Kinship's
// GROUP_MIN_TIER): plants/molluscs surface from Thursday, spiders from the weekend. Every
// vertebrate + insect group is allowed from Monday. Keeps easy days from flooding with the
// most container-rich lineage (angiosperms) and reserves the niche groups for hard days.
const GROUP_MIN_TIER: Record<string, number> = {
  Mammals: 1, Birds: 1, Fish: 1, Reptiles: 1, Amphibians: 1, Insects: 1,
  Plants: 4, Molluscs: 4, Spiders: 5,
};

/** For every node, the shallowest named group in each of its branches (one
 *  bottom-up pass). A node that is itself a group contributes only itself, so the
 *  list is always pairwise disjoint. A node with ≥MIN_GROUPS such groups can host
 *  a board; its groups' MRCA-rank separation sets the difficulty (spread = easy). */
function containers(tree: Tree, groups: Map<string, Group>, maxLeaves: number): Grain {
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
    if (list.length < MIN_GROUPS) continue;
    const group = broadGroupOf(tree, id);
    if (group === "other") continue; // spans ≥2 classes → never a board
    // Separation over a bounded, deterministic sample of the groups (median-pairwise is
    // O(g²); a big container's tier is well-estimated by a stable slice of its groups).
    const sample = [...list].sort((a, b) => a.cladeId.localeCompare(b.cladeId)).slice(0, 12);
    out.push({ id, group, grain: maxLeaves, sepTier: medianSeparationTier(tree, sample.map((g) => g.cladeId)), groups: list });
  }
  return { list: out, shallow: top };
}

/** A container's groups that can actually host a slot: they hold at least one common-named
 *  species (a slot species is never a bare binomial), and no two carry the same LABEL. */
function eligibleGroups(tree: Tree, container: Container): Group[] {
  const byLabel = new Map<string, Group>();
  for (const g of container.groups) {
    if (!g.leaves.some((id) => tree.byId.get(id)?.common)) continue;
    const n = tree.byId.get(g.cladeId);
    const label = n?.common ?? n?.sciName ?? g.cladeId;
    const held = byLabel.get(label);
    if (!held || g.leaves.length > held.leaves.length ||
        (g.leaves.length === held.leaves.length && g.cladeId < held.cladeId)) {
      byLabel.set(label, g);
    }
  }
  return [...byLabel.values()];
}

/** The clades sitting in the branches BESIDE a container: walk up from it and take each
 *  ancestor's OTHER children, reading their shallowest groups from the same grain pass.
 *  The walk stops the moment it would leave the day's broad class, so a board still never
 *  spans two classes, and the leaves it returns are disjoint from the container's (a
 *  sibling subtree shares none of them) and from each other.
 *
 *  These clades hold none of the answers and sit outside the answer region entirely, so a
 *  species drawn from one adds tree without adding a hint. That is why a hard day fills
 *  from here rather than from more worked examples inside the answer groups. */
function neighbourGroups(tree: Tree, container: Container, want: number): Group[] {
  const { shallow } = getGrain(tree, container.grain);
  const out: Group[] = [];
  let node = container.id;
  for (let up = 0; up < NEIGHBOUR_LEVELS && out.length < want; up++) {
    const parent = tree.byId.get(node)?.parentId;
    if (!parent || broadGroupOf(tree, parent) !== container.group) break;
    for (const sib of tree.childrenOf.get(parent) ?? []) {
      if (sib === node) continue;
      out.push(...(shallow.get(sib) ?? []));
    }
    node = parent;
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
// cached, so replaying the epoch across many tiers stays cheap. `shallow` is the same
// bottom-up pass keyed by EVERY node, not just the board-hosting ones: the neighbour fill
// reads it to find the groups sitting in the branches beside a container.
const grainCache = new WeakMap<Tree, Map<number, Grain>>();
function getGrain(tree: Tree, maxLeaves: number): Grain {
  let m = grainCache.get(tree);
  if (!m) { m = new Map(); grainCache.set(tree, m); }
  let c = m.get(maxLeaves);
  if (!c) { c = containers(tree, allGroups(tree, maxLeaves), maxLeaves); m.set(maxLeaves, c); }
  return c;
}
const getContainers = (tree: Tree, maxLeaves: number): Container[] => getGrain(tree, maxLeaves).list;

const ALL_GROUPS = Object.keys(GROUP_MIN_TIER);

/** Containers of ONE broad class at a tier's grain. Starts at the tier's grain and widens
 *  COARSER, then falls back FINER, so a class always yields a board when it's picked — even
 *  a low-order class like amphibians (which only forms containers at a fine grain) can run
 *  on an easy day. Grain sets group breadth; sepTier then sets the difficulty within. */
function containersForGroupTier(tree: Tree, group: string, tier: number): Container[] {
  const base = grainForTier(tier);
  for (let mx = base; mx <= MAX_GROUP_LEAVES; mx += 2) {
    const c = getContainers(tree, mx).filter((x) => x.group === group);
    if (c.length) return c;
  }
  for (let mx = base - 2; mx >= FINE_GROUP_LEAVES; mx -= 2) {
    const c = getContainers(tree, mx).filter((x) => x.group === group);
    if (c.length) return c;
  }
  return [];
}

// Per (tree, tier): each gated-in class → its containers. Cached so the epoch replay stays
// cheap. Balancing over CLASSES (not the raw container pool) is what stops the most
// container-rich lineages — mammal-dense augment on easy days, angiosperms/insects on hard
// — from flooding a tier.
const groupTierCache = new WeakMap<Tree, Map<number, Map<string, Container[]>>>();
function groupContainers(tree: Tree, tier: number): Map<string, Container[]> {
  let byTier = groupTierCache.get(tree);
  if (!byTier) groupTierCache.set(tree, (byTier = new Map()));
  const hit = byTier.get(tier);
  if (hit) return hit;
  const m = new Map<string, Container[]>();
  for (const g of ALL_GROUPS) {
    if ((GROUP_MIN_TIER[g] ?? 1) > tier) continue; // class gated off this tier
    const cs = containersForGroupTier(tree, g, tier);
    if (cs.length) m.set(g, cs);
  }
  byTier.set(tier, m);
  return m;
}

/** The day's broad CLASS, chosen uniformly among those eligible this tier. Locked ONCE per
 *  day (not per container attempt) so the class distribution stays balanced: the augment is
 *  mammal-dense and only some classes can field a colliding board at a given grain, so if
 *  the class were re-drawn each attempt the shared-word floor would quietly re-bias every
 *  easy day toward mammals. Locking the class first makes the floor a best-effort WITHIN the
 *  day's class instead of a lever that picks the class. Null if none eligible. */
function pickGroup(tree: Tree, tier: number, rng: () => number): string | null {
  const groups = [...groupContainers(tree, tier).keys()].sort();
  return groups.length ? groups[Math.floor(rng() * groups.length)] : null;
}

// How many classes a day may fall through before it settles for a repeat. Each one costs a
// full BRANCHES_ATTEMPTS survey, and this runs inside the epoch replay, so the search is
// bounded: three classes is enough for the thin ones (molluscs, amphibians) to hand over to
// a neighbour without the replay's cost tripling on every day that just happens to start
// with a busy class.
const BRANCHES_CLASS_ATTEMPTS = 3;

/** The day's class first, then the others in a stable per-day order.
 *
 *  Element 0 is EXACTLY the old locked draw (uniform over the classes eligible at this
 *  tier), so a day that can field a fresh board behaves as it always did. The rest are the
 *  remaining classes shuffled with a different seed, so the fallback varies by day instead
 *  of always landing on whichever class sorts first. */
function eligibleClasses(tree: Tree, tier: number, dateKey: string): string[] {
  const first = pickGroup(tree, tier, mulberry32(xmur3(`grebe:branches:${dateKey}:${tier}:group`)));
  if (!first) return [];
  const rest = [...groupContainers(tree, tier).keys()].sort().filter((g) => g !== first);
  return [first, ...shuffle(rest, mulberry32(xmur3(`grebe:branches:${dateKey}:${tier}:class-fallback`)))];
}

/** Pick a container WITHIN the day's locked class, biased by tier: easy days favour
 *  WELL-SEPARATED containers (low sepTier — different orders), hard days favour TIGHT ones
 *  (high sepTier — sibling families). A window around the target keeps day-to-day variety
 *  and lets the anti-repeat layer find alternatives. */
function pickContainer(tree: Tree, group: string, tier: number, rng: () => number): Container | null {
  const cs = groupContainers(tree, tier).get(group);
  if (!cs || !cs.length) return null;
  if (cs.length <= 1) return cs[0];
  const sorted = [...cs].sort((a, b) => a.sepTier - b.sepTier || a.id.localeCompare(b.id));
  const center = ((tier - 1) / 6) * (sorted.length - 1); // spread (Mon) → tight (Sun)
  const half = Math.max(1, Math.round(sorted.length * 0.3));
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

/** Leaves in the SAME direct branch as the slot — its own final sub-clade — excluding
 *  the slot itself. A sibling here sits right beside the answer: the strongest
 *  recognition hint. Empty when the slot's final clade holds only the slot. */
function slotBranchLeaves(tree: Tree, groupId: string, slot: string, groupLeaves: string[]): string[] {
  const kids = tree.childrenOf.get(groupId) ?? [];
  const slotBranch = kids.find((k) => leavesUnder(tree, k).includes(slot));
  if (!slotBranch) return [];
  const slotSet = new Set(leavesUnder(tree, slotBranch));
  return groupLeaves.filter((id) => id !== slot && slotSet.has(id));
}

const viewsOf = (tree: Tree, id: string) => tree.byId.get(id)?.views ?? 0;
/** Weighted-random order by pageviews (Efraimidis–Spirakis key u^(1/views), as Kinship's
 *  pickMembers). Famous species usually come first — this is a RECOGNITION game, so the
 *  tray should lean recognisable — but obscurer members still rotate in across days, so
 *  the boards vary far more than a fixed top-N would. Deterministic given the rng. */
function byViews(tree: Tree, ids: string[], rng: () => number): string[] {
  return ids
    .map((id) => ({ id, key: Math.pow(rng(), 1 / Math.max(viewsOf(tree, id), 1)) }))
    .sort((a, b) => b.key - a.key || (a.id < b.id ? -1 : 1))
    .map((x) => x.id);
}

/** Choose the day's k groups AND one slot species each, packing the tray with at least
 *  `floor` species that share a distinctive name word (two "sparrows", …) so a bare
 *  word-match can't solve the board. Greedy, best-effort and deterministic:
 *   1. index every group by the words its members can field;
 *   2. lock colliding groups to their shared word — biggest span first — until the floor
 *      is met or the collision words run out (a word must span ≥2 groups to count);
 *   3. fill the remaining slots with other groups, each a recognisable common-named pick.
 *  Falls back gracefully when the container can't collide (few or no shared words) — it
 *  simply returns k recognisable picks, as the pre-floor generator did. */
function pickGroupSlots(
  tree: Tree,
  groups: Group[],
  k: number,
  floor: number,
  rng: () => number
): { grp: Group; slot: string }[] {
  // Candidate members per group: COMMON-NAMED ONLY — a slot species must never be a bare
  // Latin binomial (an unplaceable, un-collidable tray tile). Ordered weighted-random by
  // pageviews so the tray leans recognisable. The filler pick is candidates[0]; a
  // collision's representative is the most-famous member carrying the shared word. Groups
  // with no common-named member are dropped (selectBoard passes only eligible groups, but
  // guard anyway).
  const cand = new Map<Group, string[]>();
  for (const g of groups) {
    const named = g.leaves.filter((id) => tree.byId.get(id)?.common);
    if (named.length) cand.set(g, byViews(tree, named, rng));
  }
  groups = groups.filter((g) => cand.has(g));

  // head noun → one representative (group, species) per group that can field it.
  const byWord = new Map<string, { grp: Group; species: string }[]>();
  for (const g of groups) {
    const claimed = new Set<string>();
    for (const id of cand.get(g)!) {
      const h = headWord(tree, id);
      if (!h || claimed.has(h)) continue; // one representative species per (head, group)
      claimed.add(h);
      (byWord.get(h) ?? byWord.set(h, []).get(h)!).push({ grp: g, species: id });
    }
  }
  // Collision words span ≥2 groups; widest span first, seeded tiebreak so the day's
  // shared word varies. Deterministic given the rng.
  const collisions = [...byWord.values()]
    .map((gs) => ({ gs, span: new Set(gs.map((x) => x.grp)).size, key: rng() }))
    .filter((c) => c.span >= 2)
    .sort((a, b) => b.span - a.span || a.key - b.key);

  const slotOf = new Map<Group, string>(); // group → its locked slot species
  // (1) Lock colliding groups until the floor is met (or we run out / fill k). Each word
  // contributes only as many groups as still needed (≥2 to form a real collision), so a
  // wide "…sparrow" word doesn't swallow the whole board when the floor is small.
  for (const { gs } of collisions) {
    if (slotOf.size >= floor || slotOf.size >= k) break;
    const fresh = [...new Map(gs.filter((x) => !slotOf.has(x.grp)).map((x) => [x.grp, x])).values()];
    if (fresh.length < 2) continue; // a collision needs a fresh pair
    const take = Math.max(2, floor - slotOf.size);
    for (const x of fresh.slice(0, Math.min(take, k - slotOf.size))) slotOf.set(x.grp, x.species);
  }

  // (2) Fill the rest with other groups (shuffled), each a recognisable common-named slot.
  const chosen = [...slotOf.keys()];
  for (const g of shuffle([...groups], rng)) {
    if (chosen.length >= k) break;
    if (slotOf.has(g)) continue;
    slotOf.set(g, cand.get(g)![0]);
    chosen.push(g);
  }
  return chosen.slice(0, k).map((g) => ({ grp: g, slot: slotOf.get(g)! }));
}

/** The cheap per-day board selection over the day's LOCKED class. Returns null when the
 *  picked container can't field MIN_GROUPS groups that each have a common-named species to
 *  place (every slot species must be common-named — never a bare Latin binomial). */
function selectBoard(tree: Tree, group: string, dateKey: string, tier: number, attempt: number): BranchesBoard | null {
  const seedKey = attempt === 0 ? `grebe:branches:${dateKey}:${tier}` : `grebe:branches:${dateKey}:${tier}:${attempt}`;
  const rng = mulberry32(xmur3(seedKey));
  const container = pickContainer(tree, group, tier, rng);
  if (!container) return null;

  // Only groups with a common-named member can host a (common-named) slot; size the board
  // from those, and bail if too few — a Latin-only region can't field this game.
  //
  // Deduplicated by LABEL first. Distinct clades can share a common name — the tree holds two
  // called "Tortoiseshells" — and a board that draws both shows the same label over two
  // branches, which no amount of recognition can tell apart. Keep the richer of the two
  // (more species to draw on), by clade id when they tie, so the choice is deterministic.
  //
  // Memoised on the container, which is itself cached per grain. A container can hold
  // hundreds of groups and this runs inside the 24-attempt survey of the epoch replay, so
  // recomputing it per attempt cost more than everything else in the generator put together.
  const eligible = (container.eligible ??= eligibleGroups(tree, container));
  if (eligible.length < MIN_GROUPS) return null;
  const k = slotCount(tier, eligible.length);
  // Pass 1: choose the k groups AND their slot species jointly, packing the tray with
  // at least `floor` look-alike names (rising with the tier) so a bare word-match can't
  // solve the board. Floor can't exceed the slot count.
  const floor = Math.min(k, sharedWordFloor(tier));
  const picks = pickGroupSlots(tree, eligible, k, floor, rng);
  if (picks.length < MIN_GROUPS) return null;

  const slotIds: string[] = [];
  const anchorIds: string[] = [];
  const groupIds: string[] = [];
  const usedGroupIds = new Set(picks.map((p) => p.grp.cladeId));

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
  // A word spanning many of the REGION's clades is NOT thereby safe, however common it is
  // there. A primate board with gibbons pre-filled in Nomascus and Hylobates leaves Hoolock
  // as the only gibbon genus without one, and the tray's single gibbon places itself by
  // elimination — even though "gibbon" names species in four of that region's clades. What
  // matters is that only one ANSWER carries the word, which is exactly what this test says.
  const distinctive = (w: string) => (wordGroups.get(w) ?? 0) === 1;
  // No prefilled species (worked example OR context) may carry a word DISTINCTIVE to
  // a single answer — that word would point straight at one clade, whether the
  // species sits in that clade (a give-away) or elsewhere (misleading). Generic
  // words shared across the board ("squid") are fine.
  //
  // EXCEPT where the word tells the player nothing the board already tells them, which
  // takes BOTH of these to be true at once:
  //   • the prefill sits in the very clade whose answer carries the word, and
  //   • that clade's own LABEL carries it too.
  // A board of Spiny lizards / Anoles / Iguanas / Corytophaninae blocked every candidate it
  // had, because each clade's kind-word belongs to that clade alone, and it drew empty. But
  // the label over that branch reads "Iguanas": a Green iguana pre-filled beneath it adds
  // nothing to what the player can already read, so it is allowed. Both conditions matter.
  // Drop the label test and pre-filled gibbons in Nomascus and Hylobates leave Hoolock as
  // the only gibbon genus still empty, placing the tray's one gibbon by elimination. Drop
  // the same-clade test and an "… iguana" under Anoles becomes a misleading pointer.
  // Plurals are matched by a trailing-s trim, so "Iguanas" ⊃ "iguana".
  const singular = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  // For each distinctive word, the clade of the one answer carrying it.
  const wordOwner = new Map<string, string>();
  picks.forEach(({ grp, slot }) => {
    for (const w of nameWords(tree, slot)) if ((wordGroups.get(w) ?? 0) === 1) wordOwner.set(w, grp.cladeId);
  });
  const labelCache = new Map<string, Set<string>>();
  const labelWords = (cladeId: string): Set<string> => {
    let ws = labelCache.get(cladeId);
    if (!ws) {
      const c = tree.byId.get(cladeId)?.common ?? "";
      ws = new Set(c.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3).map(singular));
      labelCache.set(cladeId, ws);
    }
    return ws;
  };
  const clashesAnswer = (id: string, cladeId: string) => {
    const labelled = labelWords(cladeId);
    for (const w of nameWords(tree, id)) {
      if (!distinctive(w)) continue;
      if (wordOwner.get(w) === cladeId && labelled.has(singular(w))) continue; // already on the label
      return true;
    }
    return false;
  };

  // Pre-filled leaves (never draggable). TWO SEPARATE BUDGETS, because the two kinds of
  // prefill do different jobs and only one of them is a difficulty lever:
  //
  //  • WORKED EXAMPLES sit inside an answer's own group and point straight at the branch
  //    it belongs on, so they ARE the hint. They keep the weekday taper: nearly every
  //    group anchored on Monday, one or two on Sunday.
  //  • CONTEXT SPECIES sit in clades holding NONE of the answers. They can't give a
  //    placement away (clashesAnswer bars any name that could), so they carry no
  //    difficulty and are FLAT across the week.
  //
  // Until this split the two shared one tapering budget, which hit zero on Sunday and
  // produced boards with NOTHING drawn on them: 2026-08-30 was four clams over four
  // unlabelled Latin clades and no placed species anywhere, and 14 of 26 Sundays looked
  // like that. Hard is meant to be tight groups and look-alike tray names, not an empty
  // canvas — so the taper now applies to the hint alone and the tree stays full.
  const workedTarget = Math.min(
    slotIds.length,
    Math.max(
      Math.max(1, Math.round(slotIds.length / 4)), // never zero: a bare board isn't a tree
      Math.round(slotIds.length * (1 - (tier - 1) / 6) * 1.1) // ×1.1: a small deliberate ease
    )
  );
  const used = new Set(slotIds);

  // (a) WORKED EXAMPLES inside the answer groups, FIRST — one per slot while the budget
  // lasts. Prefer a species in the slot's OWN final branch (a sibling sitting right
  // beside the answer: the strongest recognition hint), else elsewhere in the same
  // group; prefer common-named (recognisable) picks. `clashesAnswer` still bars any word
  // DISTINCTIVE to one answer, so a helpful sibling can never become a word give-away —
  // a shared "kind" noun (e.g. every slot is a beetle) points nowhere and is allowed.
  const rank = (ids: string[]) => {
    const named = ids.filter((id) => tree.byId.get(id)?.common);
    return byViews(tree, named.length ? named : ids, rng);
  };
  // Ordered ONCE per group, for the same reason as the context pools below: byViews is a
  // weighted draw, so re-rolling it would resample instead of continuing down the list.
  const workedPool = new Map<Group, string[]>();
  for (const { grp, slot } of picks) {
    workedPool.set(grp, [
      ...rank(slotBranchLeaves(tree, grp.cladeId, slot, grp.leaves)),
      ...rank(otherBranchLeaves(tree, grp.cladeId, slot, grp.leaves)),
    ].filter((id) => !used.has(id) && !clashesAnswer(id, grp.cladeId)));
  }
  for (const { grp } of picks) {
    if (anchorIds.length >= workedTarget) break;
    const w = workedPool.get(grp)!.find((id) => !used.has(id));
    if (w) { anchorIds.push(w); used.add(w); } // group already labelled by its slot
  }

  // (b) CONTEXT CLADES: labelled clades holding NONE of the answers, each seeded with a
  // representative and then topped up so the branch visibly FORKS instead of hanging as a
  // lone twig. Decoys that fill the tree and teach by elimination ("your species don't go
  // here"). Flat across the week: Sunday's tree is as full as Monday's.
  //
  // Two sources, and the ORDER between them is a rule, not a preference. Spare clades
  // INSIDE the answer region come first. The branches BESIDE the region are only ever a
  // top-up: they may extend a tree that already has context near the answers, and they may
  // never stand in for it. A region with no spare clades at all (the bivalves field one
  // whose only named clades ARE the four answers) is left sparse on purpose. Filling it
  // outward was tried and looked worse than the empty board it replaced: every pre-filled
  // species ended up in a sibling branch of the whole puzzle, so the tree grew rich in the
  // half of the picture that isn't the puzzle while the four clam orders stayed bare.
  const contextBudget = Math.min(slotIds.length + 2, MAX_BOARD_LEAVES - slotIds.length - anchorIds.length);
  // Two clades on one board must never carry the SAME label. The tree holds distinct clades
  // that share a common name ("Tortoiseshells" names two of them), and a board showing that
  // name twice is unreadable — you cannot say which branch a label means. Answer clades
  // claim their labels first; a context clade that would duplicate one is skipped.
  const labelOf = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
  const takenLabels = new Set(groupIds.map(labelOf));
  // Candidates per clade, ordered ONCE (byViews is a weighted draw — re-rolling it per
  // round would resample rather than continue down the same list).
  const fill = (sources: { grp: Group; cap: number }[], budget: number): number => {
    sources = sources.filter(({ grp }) => !takenLabels.has(labelOf(grp.cladeId)));
    const pool = new Map<Group, string[]>();
    for (const { grp } of sources) {
      const named = grp.leaves.filter((id) => tree.byId.get(id)?.common);
      pool.set(grp, byViews(tree, named.length ? named : [...grp.leaves], rng).filter((id) => !used.has(id) && !clashesAnswer(id, grp.cladeId)));
    }
    let taken = 0;
    for (let round = 0; round < CONTEXT_PER_CLADE && taken < budget; round++) {
      for (const { grp, cap } of sources) {
        if (taken >= budget) break;
        if (round >= cap) continue;
        const next = pool.get(grp)!.find((id) => !used.has(id));
        if (!next) continue;
        if (round === 0) {
          if (takenLabels.has(labelOf(grp.cladeId))) continue; // another source already used it
          groupIds.push(grp.cladeId); // label the context clade too
          takenLabels.add(labelOf(grp.cladeId));
        }
        anchorIds.push(next);
        used.add(next);
        taken++;
      }
    }
    return taken;
  };
  const spare = container.groups.filter((g) => !usedGroupIds.has(g.cladeId));
  const contextTaken = fill(shuffle(spare, rng).map((grp) => ({ grp, cap: CONTEXT_PER_CLADE })), contextBudget);
  if (contextTaken > 0) {
    // Neighbours are capped lower than in-region clades: several distinct branches beside
    // the region read as a richer tree than one neighbour stuffed with species.
    const nbrs = neighbourGroups(tree, container, contextBudget - contextTaken);
    fill(shuffle(nbrs, rng).map((grp) => ({ grp, cap: NEIGHBOUR_PER_CLADE })), contextBudget - contextTaken);
  }

  // There is deliberately no third pass topping the board up from inside the answer groups.
  // A species added there is another worked example: it points at an answer, so a board too
  // thin to fill any other way would be made EASIER by filling it, on exactly the hard days
  // that are supposed to give least away. A sparse board is the right outcome for a region
  // that has nothing beside its answers.

  const leafIds = [...anchorIds, ...slotIds];
  let root = leafIds[0];
  for (const id of leafIds) root = mrca(tree, root, id);
  const tray = shuffle([...slotIds], rng);
  return { date: dateKey, tier, rootId: root, leafIds, anchorIds, slotIds, groupIds, tray };
}

/** A board's identity for anti-repeat: its ANSWER CLADES.
 *
 *  This used to be the species — slots plus prefills — which made two boards distinct the
 *  moment one prefill differed. But the puzzle is "which of these branches does each species
 *  belong to", so a board asking about the same clades is the same puzzle even when the
 *  species differ; over a year 20 boards repeated their whole clade set inside 60 days, some
 *  after five weeks. Kinship has always keyed on its group set, and scores zero. Keying on
 *  the clades is also strictly stronger: the species follow from the clades, so nothing that
 *  the species key caught slips past this one. */
const boardSig = (b: BranchesBoard) => [...answerGroupIds(b)].sort().join(",");

/** How many of a board's tray species share a HEAD NOUN with another tray species — the
 *  quantity the shared-word floor targets ("sparrow" ×2, not "-tailed" ×3). */
function trayCollisions(tree: Tree, b: BranchesBoard): number {
  const heads = b.slotIds.map((id) => headWord(tree, id));
  const freq = new Map<string, number>();
  for (const h of heads) if (h) freq.set(h, (freq.get(h) ?? 0) + 1);
  let n = 0;
  for (const h of heads) if (h && (freq.get(h) ?? 0) >= 2) n++;
  return n;
}
/** True when a board hits its shared-word floor (capped by its slot count — a small
 *  board can't collide more names than it has). */
function meetsFloor(tree: Tree, b: BranchesBoard): boolean {
  return trayCollisions(tree, b) >= Math.min(b.slotIds.length, sharedWordFloor(b.tier));
}

/** The board's ANSWER groups (the clades that actually own a slot) — groupIds stores them
 *  first, before the labelled context clades. */
const answerGroupIds = (b: BranchesBoard) => b.groupIds.slice(0, b.slotIds.length);

/** True when the board's actual answer-group separation sits in the day's SEP_BAND — the
 *  difficulty gate that keeps a spread cross-class board off a hard day (and a tight genus
 *  board off Monday). */
function inSepBand(tree: Tree, b: BranchesBoard): boolean {
  const [lo, hi] = SEP_BAND[b.tier] ?? SEP_BAND[1];
  const sep = medianSeparationTier(tree, answerGroupIds(b));
  return sep >= lo && sep <= hi;
}

const BRANCHES_ANTI_REPEAT_WINDOW = 60;
const BRANCHES_ATTEMPTS = 24;

// SERVED HISTORY — see the same block in ./grid, which explains it at length.
//
// The epoch replay below rebuilds the anti-repeat window by REGENERATING every past day with
// the current generator, so a version bump silently rewrites the past it is meant to avoid.
// The pinned rows are the record of what was really served and carry the ids boardSig is
// built from, so injecting them lets the replay count the real boards and generate only the
// days that were never served.
let servedBranches: Map<string, { sig: string; groupIds: string[] }> | null = null;
/** Install (or clear, with null) the boards really served, keyed by date. Takes the pinned
 *  payload's ids; the signature is derived here so callers need not know its shape. groupIds
 *  matter as much as the signature — they feed the per-group window below, and a served day
 *  that contributed no groups would let the very boards people just played come straight
 *  back. */
export function setServedBranchesHistory(
  // groupIds is REQUIRED, not optional as it once was. Both the signature and the per-group
  // window are built from the answer clades now, so a served day handed over without them
  // contributes an empty signature: the injection silently does nothing and the very board
  // that was played comes straight back. A missing field must not be sayable.
  served: Map<string, { slotIds: string[]; anchorIds: string[]; groupIds: string[] }> | null
): void {
  servedBranches = served && served.size
    ? new Map([...served].map(([dk, p]) => {
        // ANSWER groups only, which groupIds stores first — see the window below for why the
        // context clades must stay out of it. The signature is those same clades, matching
        // boardSig, so a served day and a generated one are compared like for like.
        const groupIds = p.groupIds.slice(0, p.slotIds.length);
        return [dk, { sig: [...groupIds].sort().join(","), groupIds }];
      }))
    : null;
}

// PER-GROUP ANTI-REPEAT, the counterpart to the grid's GRID_GROUP_ANTI_REPEAT_WINDOW.
//
// Until this existed Branches guarded only the exact board SIGNATURE (slots + anchors), so
// any board counted as fresh the moment one species differed, and individual groups came
// back almost immediately: over a year, 1368 group reappearances, 354 of them inside a
// fortnight, 65 inside three days, the soonest on the very next day. Two boards four days
// apart shared three of their six groups (Geometroidea, Arctiinae and Tineidae), and
// Rhacophoridae ran twice in three days. The signature window cannot see any of that.
//
// A board that repeats a recent group is not rejected outright, only ranked below one that
// does not — see the two ladders in boardForDay. Branches locks its broad class for the day
// before it surveys containers, so a hard ban would push thin classes onto their last-resort
// board rather than simply preferring a fresher one.
//
// The window counts ANSWER groups ONLY, never the context clades that fill out the tree.
// Both live in groupIds (answers first), and pricing all of them quietly broke this: once a
// board could carry six or seven labelled clades instead of two or three, nearly every
// candidate was charged for something, no candidate scored zero, the fresh ladder stayed
// empty and every day settled for the mildest repeat it could find. Answer-clade repeats
// inside a fortnight went 53 → 72 over a year. The context clades are scenery; only the
// clades that ARE the puzzle should keep it away from a container.
const BRANCHES_GROUP_ANTI_REPEAT_WINDOW = 14;
/** A candidate board plus how badly it repeats, so the fallback can take the mildest. */
type Scored = { board: BranchesBoard; cost: number } | null;

/** The day's board. Surveys up to BRANCHES_ATTEMPTS containers (each attempt re-seeds
 *  pickContainer, which balances broad classes) and returns the first that is fresh AND
 *  meets the shared-word floor — the firm difficulty signal (meaningful head-noun
 *  collisions, which naturally track how tight the groups are). The separation band is only
 *  a SOFT preference: a hard per-tier band would admit only the classes whose natural
 *  separation happens to match it (mammals on easy, amphibians midweek) and undo the class
 *  balance, so it merely breaks ties. Falls back: fresh+floor → fresh+in-band → fresh →
 *  any valid board (attempts are null when a container is too Latin-only to field a board).
 *  Returns null only if NO attempt yields a valid board. */
function boardForDay(
  tree: Tree,
  dateKey: string,
  tier: number,
  avoid: (s: string) => boolean,
  repeatCost: (groupIds: string[]) => number = () => 0
): BranchesBoard | null {
  // The day's broad class, drawn uniformly over the eligible ones, then the classes it would
  // fall back to IN ORDER. The first entry is exactly the old locked draw, so the class
  // distribution is unchanged on every day that can field a fresh board — and with no
  // history at all (the seed path, where repeatCost is always 0) the survey below returns
  // inside the first class every time, so nothing about the balance moves.
  //
  // The fallback exists because locking one class outright made a thin class repeat itself
  // on a weekly cadence. Molluscs field three containers and the bivalves field ONE, so when
  // the draw landed there every one of the 24 attempts produced the same four clam orders,
  // the ladder had nothing fresh to rank and took the "mildest" repeat, which was that same
  // board. Rat snakes and Lampropeltis ran on 2026-09-07, 09-14 and 09-21; the clams ran the
  // Sunday after the Sunday. A class with nothing fresh left to give is a reason to draw
  // another class, not a reason to serve last week's board again.
  const classes = eligibleClasses(tree, tier, dateKey);
  if (!classes.length) return null;
  // The same preference ladder is kept TWICE: `n` for boards reusing no group seen inside
  // BRANCHES_GROUP_ANTI_REPEAT_WINDOW, `r` for boards that do. Every `n` beats every `r`, so a
  // repeat is taken only when the day has nothing else. That matters because Branches locks
  // its broad class before it surveys containers: a hard ban would strand a thin class
  // (molluscs field three containers) on its last-resort board rather than a fresher one.
  //
  // Within `r` the LOWEST repeatCost wins rather than the first found. Taking the first left
  // some group coming back the very next day at every window size — the fallback was choosing
  // arbitrarily among repeats, so widening the window only reshuffled which ones landed. Cost
  // grades by how recent and how many, so when a repeat is unavoidable it is the mildest one
  // on offer. With the window off, cost is always 0, `r` is never populated, and the ladder
  // collapses to exactly what it was before.
  // Repeat candidates are kept ACROSS the classes tried, so if none of them can field a
  // fresh board the day still ends on the mildest repeat available anywhere — never worse
  // than the single-class version, which could only offer the mildest repeat within one.
  let rIdeal: Scored = null, rFloor: Scored = null, rInBand: Scored = null, rFirst: Scored = null;
  let anyValid: BranchesBoard | null = null;
  const better = (cur: Scored, board: BranchesBoard, cost: number): Scored =>
    !cur || cost < cur.cost ? { board, cost } : cur;

  for (const group of classes.slice(0, BRANCHES_CLASS_ATTEMPTS)) {
    let nFloor: BranchesBoard | null = null, nInBand: BranchesBoard | null = null, nFirst: BranchesBoard | null = null;
    for (let attempt = 0; attempt < BRANCHES_ATTEMPTS; attempt++) {
      const board = selectBoard(tree, group, dateKey, tier, attempt);
      if (!board) continue;                            // Latin-only container — unusable
      if (!anyValid) anyValid = board;                 // last-resort (may repeat)
      if (avoid(boardSig(board))) continue;            // a recent repeat — skip
      const floor = meetsFloor(tree, board);
      const band = inSepBand(tree, board);
      const cost = repeatCost(answerGroupIds(board));
      if (cost === 0) {
        if (floor && band) return board;               // fresh, look-alikes, on-band → ideal
        if (floor && !nFloor) nFloor = board;          // look-alikes (firm) → primary fallback
        if (band && !nInBand) nInBand = board;         // on-band → secondary
        if (!nFirst) nFirst = board;                   // any fresh → last fresh option
      } else {
        if (floor && band) rIdeal = better(rIdeal, board, cost);
        if (floor) rFloor = better(rFloor, board, cost);
        if (band) rInBand = better(rInBand, board, cost);
        rFirst = better(rFirst, board, cost);
      }
    }
    // This class had something fresh. Take it and stop — trying further classes would only
    // trade a fresh board for another fresh board and skew the class balance for nothing.
    const fresh = nFloor ?? nInBand ?? nFirst;
    if (fresh) return fresh;
  }
  return rIdeal?.board ?? rFloor?.board ?? rInBand?.board ?? rFirst?.board ?? anyValid;
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
  // Day index each group last appeared on, for the per-group window.
  const groupSeenAt = new Map<string, number>();
  let idx = 0;
  // 0 when nothing recurs. Otherwise each offending group contributes how much of the window
  // it still has to run, so yesterday hurts most and a group about to age out barely counts —
  // and two repeats beat one only if both are old.
  const repeatCost = (groupIds: string[]) =>
    groupIds.reduce((sum, id) => {
      const seen = groupSeenAt.get(id);
      if (seen === undefined) return sum;
      const age = idx - seen;
      return age < BRANCHES_GROUP_ANTI_REPEAT_WINDOW
        ? sum + (BRANCHES_GROUP_ANTI_REPEAT_WINDOW - age)
        : sum;
    }, 0);

  for (let dk = DAILY_EPOCH; ; dk = shiftDate(dk, 1), idx++) {
    if (dk === dateKey) return boardForDay(tree, dk, tier, avoid, repeatCost);

    // A day that was really served contributes the board that was really served; only days
    // with no pin are generated.
    const served = servedBranches?.get(dk);
    let sig: string;
    let groupIds: string[];
    if (served !== undefined) {
      sig = served.sig;
      groupIds = served.groupIds;
    } else {
      const board = boardForDay(tree, dk, tierForDate(dk), avoid, repeatCost);
      if (!board) continue; // a day with no valid board contributes nothing to anti-repeat
      sig = boardSig(board);
      groupIds = answerGroupIds(board); // answers only, as the window's comment explains
    }
    queue.push(sig);
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
    if (queue.length > BRANCHES_ANTI_REPEAT_WINDOW) {
      const old = queue.shift()!;
      const c = (counts.get(old) ?? 0) - 1;
      if (c <= 0) counts.delete(old);
      else counts.set(old, c);
    }
    for (const id of groupIds) groupSeenAt.set(id, idx);
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
