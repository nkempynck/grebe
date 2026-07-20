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
//   • SLOT COUNT — 4 → 7, and ANCHORS — mostly anchored (easy) → few/none (hard).
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
    if (list.length < MIN_GROUPS) continue;
    const group = broadGroupOf(tree, id);
    if (group === "other") continue; // spans ≥2 classes → never a board
    // Separation over a bounded, deterministic sample of the groups (median-pairwise is
    // O(g²); a big container's tier is well-estimated by a stable slice of its groups).
    const sample = [...list].sort((a, b) => a.cladeId.localeCompare(b.cladeId)).slice(0, 12);
    out.push({ id, group, sepTier: medianSeparationTier(tree, sample.map((g) => g.cladeId)), groups: list });
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
  const eligible = container.groups.filter((g) => g.leaves.some((id) => tree.byId.get(id)?.common));
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
    const rep = byViews(tree, named.length ? named : [...cg.leaves], rng).find((id) => !used.has(id) && !clashesAnswer(id));
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

/** The day's board. Surveys up to BRANCHES_ATTEMPTS containers (each attempt re-seeds
 *  pickContainer, which balances broad classes) and returns the first that is fresh AND
 *  meets the shared-word floor — the firm difficulty signal (meaningful head-noun
 *  collisions, which naturally track how tight the groups are). The separation band is only
 *  a SOFT preference: a hard per-tier band would admit only the classes whose natural
 *  separation happens to match it (mammals on easy, amphibians midweek) and undo the class
 *  balance, so it merely breaks ties. Falls back: fresh+floor → fresh+in-band → fresh →
 *  any valid board (attempts are null when a container is too Latin-only to field a board).
 *  Returns null only if NO attempt yields a valid board. */
function boardForDay(tree: Tree, dateKey: string, tier: number, avoid: (s: string) => boolean): BranchesBoard | null {
  // Lock the day's broad class ONCE (uniform over eligible classes) — every attempt stays
  // within it, so the class distribution is balanced and the shared-word floor is a
  // best-effort within the class, never the thing that picks the class.
  const group = pickGroup(tree, tier, mulberry32(xmur3(`grebe:branches:${dateKey}:${tier}:group`)));
  if (!group) return null;
  let freshFloor: BranchesBoard | null = null;
  let freshInBand: BranchesBoard | null = null;
  let firstFresh: BranchesBoard | null = null;
  let anyValid: BranchesBoard | null = null;
  for (let attempt = 0; attempt < BRANCHES_ATTEMPTS; attempt++) {
    const board = selectBoard(tree, group, dateKey, tier, attempt);
    if (!board) continue;                            // Latin-only container — unusable
    if (!anyValid) anyValid = board;                 // last-resort (may repeat)
    if (avoid(boardSig(board))) continue;            // a recent repeat — skip
    const floor = meetsFloor(tree, board);
    if (floor && inSepBand(tree, board)) return board; // fresh, look-alikes, on-band → ideal
    if (floor && !freshFloor) freshFloor = board;    // look-alikes (firm) → primary fallback
    if (inSepBand(tree, board) && !freshInBand) freshInBand = board; // on-band → secondary
    if (!firstFresh) firstFresh = board;             // any fresh → last fresh option
  }
  return freshFloor ?? freshInBand ?? firstFresh ?? anyValid;
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
    if (!board) continue; // a day with no valid board contributes nothing to anti-repeat

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
