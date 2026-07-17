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

/** How many of a board's groups give themselves away by name. A group is a
 *  giveaway when a distinctive word is shared by more than two of its members AND
 *  appears in NO other group on the board — those tiles obviously clump into a
 *  free group ("…bear" ×4, only bears here). Board-aware on purpose: a word spread
 *  across the groups (four frog families all named "…frog") doesn't distinguish
 *  one group from another, so it's no giveaway — the name can't sort the board,
 *  only the clade can, which is exactly what a hard board should demand. */
function giveawayCount(tree: Tree, board: GridBoard): number {
  // Per group, the distinctive words it contains (each counted once per member).
  const perGroup = board.groups.map((g) => {
    const c = new Map<string, number>();
    for (const id of g.memberIds) {
      for (const w of new Set(nameWords(tree, id))) c.set(w, (c.get(w) ?? 0) + 1);
    }
    return c;
  });
  let n = 0;
  perGroup.forEach((c, gi) => {
    for (const [w, v] of c) {
      if (v <= 2) continue;
      const elsewhere = perGroup.some((other, oi) => oi !== gi && (other.get(w) ?? 0) > 0);
      if (!elsewhere) { n++; break; } // this group self-labels via a word unique to it
    }
  });
  return n;
}

/** Giveaway groups tolerated at a tier: brutal days (6–7) none — a group whose
 *  members share a distinctive word ("…Furrow Bee" ×3) is a freebie; Thu/Fri (4–5)
 *  two; easy days (1–3) no limit (recognisable names help). Sunday is picture-mode
 *  so a name giveaway is invisible in play, but we still prefer distinct-name boards
 *  so it isn't a freebie if names ever show (previews, share cards). */
function maxGiveaways(tier: number): number {
  if (tier >= 6) return 0;
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
  /** Broad group this container sits in (Mammalia/Aves/…), set in discover(). */
  group?: string;
  /** The tier this board naturally belongs at, from the taxonomic RANK of its four
   *  groups: four genera (siblings in one family) are brutal, four orders are easy —
   *  regardless of absolute tree depth. Set in discover(). */
  natTier?: number;
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

// Broad taxonomic groups, each given its OWN difficulty scale. Container depth only
// means "hard" relative to a lineage: fish nest far deeper than mammals, so a single
// global depth scale makes every brutal day fish and mammals can never be hard.
// Instead each group ramps over its own min→max container depth, and hard days
// rotate the featured group — so a brutal mammal board (four sibling genera) is as
// reachable as a brutal fish one. (Config: the game's own notion of a broad group,
// not taxonomy data.)
const BROAD_MARKERS = new Set([
  "Mammalia", "Aves", "Actinopterygii", "Squamata", "Testudines", "Crocodylia",
  "Amphibia", "Elasmobranchii", "Insecta", "Arachnida", "Malacostraca",
  "Cephalopoda", "Gastropoda", "Bivalvia", "Anthozoa", "Magnoliopsida",
  "Liliopsida", "Pinopsida", "Polypodiopsida", "Agaricomycetes",
]);
// Featured-group rotation order for hard tiers — a stable, interleaved sequence so
// consecutive same-weekday days cycle through groups. A group joins only if it has
// enough containers to ramp. Keep its length coprime with 7 so weekly (7-day)
// spacing still visits every group over successive weeks.
const BROAD_GROUP_ORDER = [
  "Mammalia", "Actinopterygii", "Aves", "Squamata",
  "Magnoliopsida", "Amphibia", "Insecta", "Testudines",
];
const MIN_GROUP_CONTAINERS = 4; // below this, a group isn't featured (spread only)
const HARD_TIER_START = 3; // tiers 1–2 = cross-group spread; 3–7 = featured within-group

const TIER_WINDOW = 8; // containers considered per tier before the seeded pick
const GROUP_BAND = 6; // re-roll attempts spent widening one featured group before rotating to the next

// How "tight" (confusable) a board is, from the taxonomic RANK of its four groups.
// This is the difficulty axis: four genera that are siblings in one family look
// alike (brutal); four orders are obviously different (easy). Rank is comparable
// across lineages — a genus is a genus whether it's a cat or a beetle — so it fixes
// the depth problem (a fish family nests far deeper than a mammal genus, yet the
// mammal genus board is the harder one).
const RANK_TIGHTNESS: Record<string, number> = {
  genus: 6, subgenus: 6, "species group": 6, "species subgroup": 6,
  subtribe: 5, tribe: 5,
  subfamily: 4, family: 4, section: 4,
  superfamily: 3, infraorder: 3, parvorder: 3, suborder: 3,
  infraclass: 2, superorder: 2, order: 2,
  subclass: 1, class: 1, subphylum: 1, phylum: 1, superclass: 1,
  cohort: 1, subcohort: 1, kingdom: 1, subkingdom: 1, domain: 1,
};
const CLADE_TIGHTNESS_FALLBACK = 3; // unranked OTL junctions — treat as mid

/** A board's natural tier (3…7) from the median rank-tightness of its four groups.
 *  Genus siblings (6) → 7, family (4) → 6, order (2) → 4 — so family-level boards
 *  (four fish families, four turtle families) still land on hard days. */
function naturalTier(tree: Tree, c: Container): number {
  const vals = c.themes
    .map((t) => RANK_TIGHTNESS[tree.byId.get(t.cladeId)?.rank ?? ""] ?? CLADE_TIGHTNESS_FALLBACK)
    .sort((a, b) => a - b);
  const mid = Math.floor(vals.length / 2);
  const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  return Math.max(HARD_TIER_START, Math.min(7, Math.round(median + 2)));
}

interface Discovered {
  /** Each broad group's containers (each carries its natural tier). */
  byGroup: Map<string, Container[]>;
  /** For each hard tier 3…7, the featured-rotation groups that can reach it — those
   *  with enough containers AND at least one board naturally that hard. */
  groupsByTier: Map<number, string[]>;
  /** Precomputed `${group}|${tier}` → that group's containers sorted by closeness to
   *  the tier (nearest first). Done once so the per-attempt re-roll is a cheap slice. */
  nearPool: Map<string, Container[]>;
  /** All containers by global depth; the shallow end are cross-group spread boards. */
  easy: Container[];
}

/** The broad group a node belongs to: the outermost BROAD_MARKER ancestor. */
function broadGroupOf(tree: Tree, id: string): string {
  let last = "other";
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    const s = tree.byId.get(c)?.sciName;
    if (s && BROAD_MARKERS.has(s)) last = s;
  }
  return last;
}

/** Expensive, tree-only discovery (theme + container enumeration), then rank-based
 *  difficulty tagging + per-tier group eligibility. Cached per tree. */
function discover(tree: Tree): Discovered | null {
  const candidates = containers(tree, allThemes(tree));
  if (candidates.length === 0) return null;

  const byGroup = new Map<string, Container[]>();
  for (const c of candidates) {
    c.group = broadGroupOf(tree, c.id);
    c.natTier = naturalTier(tree, c);
    (byGroup.get(c.group) ?? byGroup.set(c.group, []).get(c.group)!).push(c);
  }
  // Within a group, order by how hard the board is (its natural tier), then id.
  for (const cs of byGroup.values()) {
    cs.sort((a, b) => (a.natTier! - b.natTier!) || (a.id < b.id ? -1 : 1));
  }
  // Per hard tier, which featured groups can reach it: enough containers AND at
  // least one board naturally that hard, so a group is never forced above the
  // difficulty it can genuinely produce (no insect-orders board on a brutal day).
  const groupsByTier = new Map<number, string[]>();
  const nearPool = new Map<string, Container[]>();
  for (let tier = HARD_TIER_START; tier <= 7; tier++) {
    groupsByTier.set(
      tier,
      BROAD_GROUP_ORDER.filter((g) => {
        const cs = byGroup.get(g);
        return cs && cs.length >= MIN_GROUP_CONTAINERS && cs.some((c) => (c.natTier ?? 0) >= tier);
      })
    );
    for (const [g, cs] of byGroup) {
      nearPool.set(
        `${g}|${tier}`,
        [...cs].sort(
          (a, b) => Math.abs((a.natTier ?? 0) - tier) - Math.abs((b.natTier ?? 0) - tier) || (a.id < b.id ? -1 : 1)
        )
      );
    }
  }
  const easy = [...candidates].sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1));
  return { byGroup, groupsByTier, nearPool, easy };
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

/** An integer that advances by one per calendar day (days since the epoch) — used
 *  to rotate the featured broad group so same-tier days cycle groups. A non-date
 *  seed (playtest/reshuffle) falls back to a hash so it still varies deterministically. */
function rotationIndex(key: string): number {
  const t = Date.parse(`${key}T00:00:00Z`);
  if (!Number.isNaN(t)) {
    const epoch = Date.parse(`${DAILY_EPOCH}T00:00:00Z`);
    return Math.round((t - epoch) / 86_400_000);
  }
  return xmur3(key) >>> 0;
}

/** The cheap per-day board selection over already-discovered containers.
 *  `attempt` salts the seed so the anti-repeat layer can draw an alternative. */
function selectBoard(tree: Tree, d: Discovered, dateKey: string, tier: number, attempt: number): GridBoard {
  const seedKey = attempt === 0 ? `grebe:grid:${dateKey}:${tier}` : `grebe:grid:${dateKey}:${tier}:${attempt}`;
  const rng = mulberry32(xmur3(seedKey));

  // Easy tiers (1–2) draw cross-group "spread" boards from the shallow end of the
  // whole tree (four groups on far-apart branches). Hard tiers (3–7) feature ONE
  // broad group — rotated by the day so brutal days cycle mammals→fish→birds→herps…
  // — and take a board whose natural (rank-based) tier matches: four genera for the
  // brutal end, coarser groups lower down. A group only features at a tier it can
  // genuinely reach, so no easy cross-order board lands on a hard day.
  //
  // Re-rolls (`attempt`) serve two callers: the anti-repeat layer (find a fresh
  // group-set) and the giveaway guard (find a board within the tier's name budget).
  // The day's canonical featured group is attempt 0; each group gets a BAND of
  // attempts to widen its slice — some groups' hardest end is a single board (e.g.
  // Squamata's only snakes board), so a wider window reaches its next-hardest
  // boards. Once a band is exhausted we ROTATE to the next eligible group, so a
  // brutal day whose featured group is inherently self-labelling (every passerine
  // "…nuthatch") can still escape to a group that fields a giveaway-free board,
  // rather than shipping the gimme. The canonical group still wins whenever it can
  // produce a fresh, within-budget board (the common case), keeping daily rotation.
  const tierGroups = tier >= HARD_TIER_START ? d.groupsByTier.get(tier) ?? [] : [];
  let pool: Container[];
  if (tierGroups.length === 0) {
    pool = d.easy.slice(0, Math.min(TIER_WINDOW * (1 + attempt), d.easy.length));
  } else {
    const band = Math.floor(attempt / GROUP_BAND);            // which group to feature
    const local = attempt % GROUP_BAND;                       // slice width within it
    const base = ((rotationIndex(dateKey) % tierGroups.length) + tierGroups.length) % tierGroups.length;
    const group = tierGroups[(base + band) % tierGroups.length];
    // precomputed nearest-to-tier order; the re-roll just takes a wider slice
    const near = d.nearPool.get(`${group}|${tier}`) ?? d.easy;
    pool = near.slice(0, Math.min(TIER_WINDOW * (1 + local), near.length));
  }
  const container = pickN(pool, 1, rng)[0];

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

/** One day's board. Re-rolls looking for a board that is unused by `avoid` and
 *  within the tier's name-giveaway budget. If no attempt satisfies the budget it
 *  falls back to the FRESHEST-with-fewest-giveaways board — so a brutal day whose
 *  featured group is inherently self-labelling (every passerine "…lark") still
 *  ships the least give-away-y board it can, not the first fresh one. Only if every
 *  attempt was blocked does it drop to attempt 0. (Mammals are no longer banned on
 *  weekends — with per-group scaling a deep mammal board is genuinely hard, so they
 *  earn their place on brutal days.) */
function boardForDay(tree: Tree, d: Discovered, dateKey: string, tier: number, avoid: (s: string) => boolean): GridBoard {
  const budget = maxGiveaways(tier);
  let best: GridBoard | null = null;
  let bestGive = Infinity;
  for (let attempt = 0; attempt < GRID_ATTEMPTS; attempt++) {
    const board = selectBoard(tree, d, dateKey, tier, attempt);
    if (avoid(groupSig(board))) continue;
    const give = giveawayCount(tree, board);
    if (give <= budget) return board;
    if (give < bestGive) { bestGive = give; best = board; } // keep the least-giveaway fresh board
  }
  return best ?? selectBoard(tree, d, dateKey, tier, 0);
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
