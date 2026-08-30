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
import { branchDistance, leavesUnder, mrca, separationTierOf } from "./tree";

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
// TRIED AND REVERTED at 50. It looks like free variety — 79 above-floor clades sit in 26-50
// and read as perfectly good categories (Beeches & oaks, Dolphins, Lemurs, Voles & hamsters)
// — but a clade that becomes a theme is offered UPWARD as ONE group and swallows the finer
// groups beneath it: "Cats" replaces the individual cat genera, "Woodpeckers" the woodpecker
// genera. Measured over a year it went backwards on every count: distinct groups 224 -> 215,
// near-repeats 127 -> 158, and boards with no confusable pair 18 -> 58, because broad groups
// sit further apart. Variety here comes from FINER groups, not bigger ones.
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


const viewsOf = (tree: Tree, id: string) => tree.byId.get(id)?.views ?? 0;
const medianOf = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/** A clade's FAME: the median pageviews of the four species we'd actually show from it
 *  (its top four by views). The board-difficulty currency — high = recognisable. */
function fameOf(tree: Tree, leaves: string[]): number {
  const top = [...leaves].sort((a, b) => viewsOf(tree, b) - viewsOf(tree, a)).slice(0, GRID_GROUP_SIZE);
  return medianOf(top.map((id) => viewsOf(tree, id)));
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

/** Pick `n` distinct members, biased to the theme's most RECOGNISABLE species while
 *  STRICTLY respecting the word cap. `wordCap` limits how many members may share a
 *  distinctive word (e.g. "bear", "junglefowl"): 3 early-week, 2 from Thursday.
 *
 *  Selection is WEIGHTED-RANDOM by pageviews rather than a fixed top-N: each species gets
 *  a key u^(1/views) (Efraimidis–Spirakis), and we walk the pool in descending key order.
 *  Famous species still usually come first, but obscurer members of a group rotate in
 *  across days, so far more distinct species surface over time than a deterministic top-4.
 *  Deterministic given the seeded rng. Greedily takes the first `n` that fit the word cap;
 *  RETURNS FEWER than `n` when the theme genuinely can't avoid a giveaway (a whole genus
 *  sharing one vernacular, "…junglefowl" ×4) so the caller drops it.
 *
 *  Also skips a candidate whose FULL common name is already on the board's group: the tree
 *  carries a few distinct taxa under one vernacular ("Pitcher plant" ×3 Nepenthes) and even
 *  true synonym duplicates (Alpaca = Lama pacos & Vicugna pacos), and two tiles with the
 *  identical label is a confusing, unsolvable giveaway. */
function pickMembers(
  tree: Tree,
  pool: string[],
  n: number,
  rng: () => number,
  wordCap: number,
  latinPool: string[] = [],
  latinAllowance = 0,
  ageOf?: (speciesId: string) => number
): string[] {
  const views = (id: string) => tree.byId.get(id)?.views ?? 0;
  // Species shown recently sort last, so a group that comes back brings different tiles.
  // Without this the weighted draw is memoryless and fame dominates, so a returning group
  // re-showed 60-65% of the same four species and about 155 times a year came back with all
  // four identical — measured, and unchanged by every board-level fix. The GROUP is what a
  // player has to recognise, and its recognisability floor is computed from the clade's top
  // members rather than the four on screen, so demoting a seen species just takes the next
  // most famous unseen one. Two buckets, not raw age: fame must still order within them.
  const stale = (id: string) => (ageOf && ageOf(id) < SPECIES_REPEAT_WINDOW ? 1 : 0);
  // Weighted-random order: higher views → key nearer 1 → earlier, but not deterministic.
  const seq = pool
    .map((id) => ({ id, stale: stale(id), key: Math.pow(rng(), 1 / Math.max(views(id), 1)) }))
    .sort((a, b) => a.stale - b.stale || b.key - a.key || (a.id < b.id ? -1 : 1))
    .map((x) => x.id);
  const chosen: string[] = [];
  const wordCount = new Map<string, number>();
  const usedNames = new Set<string>();
  for (const id of seq) {
    if (chosen.length >= n) break;
    const common = tree.byId.get(id)?.common?.trim().toLowerCase();
    if (common && usedNames.has(common)) continue; // no two tiles with the identical label
    const words = nameWords(tree, id);
    if (words.some((w) => (wordCount.get(w) ?? 0) >= wordCap)) continue;
    chosen.push(id);
    if (common) usedNames.add(common);
    for (const w of words) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
  }
  // Still short? Fill the last seat from the Latin pool, but only where the caller allows it
  // (a picture is showing) and never more than `latinAllowance` of them. Deliberately a
  // fallback, not a preference: a named tile is always taken first.
  let latinUsed = 0;
  for (const id of latinPool) {
    if (chosen.length >= n || latinUsed >= latinAllowance) break;
    const words = nameWords(tree, id);
    if (words.some((w) => (wordCount.get(w) ?? 0) >= wordCap)) continue;
    chosen.push(id);
    latinUsed++;
    for (const w of words) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
  }
  return chosen; // may be < n → theme is a giveaway at this cap, caller skips it
}

/** The species a group draws from: NAMED leaves only — a tile that shows a bare
 *  Latin name is a bad guess, so a group must have four species with common names
 *  (allThemes already guarantees it). */
function themePool(tree: Tree, leaves: string[]): string[] {
  return leaves.filter((id) => tree.byId.get(id)?.common);
}

// ---- theme discovery ----

interface Theme {
  cladeId: string;
  leaves: string[];
  /** Leaves with NO common name, best-viewed first. A tile showing a bare binomial is only
   *  fair when a picture is showing, so these are drawn from on picture days only, at most
   *  one per group, and only to fill a group that would otherwise come up short. Worth 48
   *  extra themes (45 above the fame floor), concentrated where the pool is thinnest:
   *  Willow, Barberry, Banana, Combretaceae, earthworms, oysters, Microhylidae. */
  latinPool: string[];
  named: boolean; // has a common name → nicer group label
  fame: number; // median views of the four species we'd show (difficulty currency)
  /** max(fame, the clade's own article views) — "would a player recognise this group?",
   *  which is NOT the same question as "are its species individually famous". Read only by
   *  the MIN_BOARD_FAME / MIN_BOARD_FAME_RELAXED floors, never by difficulty tiering. */
  recognisability: number;
}

const isLeaf = (tree: Tree, id: string) => (tree.childrenOf.get(id) ?? []).length === 0;

/** O(1) "is a inside b" for a whole tree, from one iterative DFS. `isAncestor` in ./tree
 *  walks parent links, which is fine for a handful of calls and far too slow here: container
 *  discovery asks it O(n^2) times per container for the disjoint-count test and again for
 *  the pairwise separation table, and once containers could hold overlapping themes that
 *  turned first-board generation into a 16-SECOND stall. Cached per tree, like discovery. */
interface Euler { enter: Map<string, number>; exit: Map<string, number> }
const eulerCache = new WeakMap<Tree, Euler>();
function eulerOf(tree: Tree): Euler {
  const hit = eulerCache.get(tree);
  if (hit) return hit;
  const enter = new Map<string, number>();
  const exit = new Map<string, number>();
  let clock = 0;
  // Iterative: the tree is deep enough that recursion has blown the stack here before.
  const stack: Array<[string, boolean]> = [[tree.rootId, false]];
  while (stack.length) {
    const [id, done] = stack.pop()!;
    if (done) { exit.set(id, clock++); continue; }
    enter.set(id, clock++);
    stack.push([id, true]);
    for (const c of tree.childrenOf.get(id) ?? []) stack.push([c, false]);
  }
  const e = { enter, exit };
  eulerCache.set(tree, e);
  return e;
}
/** True when `a` contains `b`, or they are the same node. */
const contains = (e: Euler, a: string, b: string) => {
  const ea = e.enter.get(a), eb = e.enter.get(b);
  if (ea === undefined || eb === undefined) return false;
  return ea <= eb && (e.exit.get(b) ?? 0) <= (e.exit.get(a) ?? 0);
};
/** Either node inside the other — the test for "these two can never share a board". */
const overlaps = (e: Euler, a: string, b: string) => contains(e, a, b) || contains(e, b, a);

/** Separation for a pair of clades, memoised per tree. Containers overlap heavily — a theme
 *  belongs to every container above it — so discovery asks for the same pair many times, and
 *  each miss walks both ancestry chains to find the MRCA. */
const sepMemoCache = new WeakMap<Tree, Map<string, number>>();
function pairSeparation(tree: Tree, a: string, b: string): number {
  let memo = sepMemoCache.get(tree);
  if (!memo) { memo = new Map(); sepMemoCache.set(tree, memo); }
  const k = sepKey(a, b);
  let v = memo.get(k);
  if (v === undefined) {
    v = separationTierOf(tree, mrca(tree, a, b));
    memo.set(k, v);
  }
  return v;
}

/** Every clade that could serve as one group: an internal node with a coherent
 *  number of NAMED member species (Latin-only leaves are unusable as tiles, so a
 *  theme must field four with common names). Its stored leaf list is the named
 *  species only — the pool member picking draws from. Memoised. */
function allThemes(tree: Tree): Map<string, Theme> {
  const out = new Map<string, Theme>();
  for (const node of tree.byId.values()) {
    if (isLeaf(tree, node.id)) continue;
    // A theme must have a name to reveal on solve. The flattened tree keeps some
    // bare junction nodes (no scientific name) — those can't label a group.
    if (!node.sciName && !node.common) continue;
    const all = leavesUnder(tree, node.id);
    const named = all.filter((id) => tree.byId.get(id)?.common);
    const latin = all.filter((id) => !tree.byId.get(id)?.common).sort((a, b) => viewsOf(tree, b) - viewsOf(tree, a));
    // Four named members, or three plus a Latin one to fill the fourth seat.
    if (named.length > MAX_THEME_LEAVES) continue;
    if (named.length < MIN_THEME_LEAVES && !(named.length === MIN_THEME_LEAVES - 1 && latin.length > 0)) continue;
    out.set(node.id, {
      cladeId: node.id,
      leaves: named,
      latinPool: latin,
      named: Boolean(node.common),
      fame: fameOf(tree, named),
      // Recognisability = the better of "are its species known" and "is the GROUP known".
      // Only the fame floors read this; difficulty tiering still uses `fame` alone.
      recognisability: Math.max(fameOf(tree, named), node.cladeViews ?? 0),
    });
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
  /** Median pageviews of the (floored) groups this container would show. Sets the
   *  container's ORDER in its group and nothing else: difficulty is separation (see
   *  boardSeparation), fame is only a floor. Set in discover(). */
  fame?: number;
  /** Separation tier for every pair of this container's themes, keyed "idA|idB" with the
   *  ids sorted. A container's themes never change, so this is computed once at discovery
   *  and the per-day gate check becomes six lookups instead of six MRCA walks. Without it
   *  the gates cost hours over a year: they reject most candidates, so the score===0 early
   *  exit in boardForDay stops firing and every day surveys every container. */
  pairSep?: Map<string, number>;
  /** Branch distance for every pair, same key and the same reason: precomputed once so the
   *  weekend spread cap costs six lookups a day, not six more MRCA walks. */
  pairDist?: Map<string, number>;
  /** The confusable-pair floor that applies to this container's class (see discover). */
  tightestFloor?: number;
  /** cladeId → recognisability, so boardForDay can gate on how NAMEABLE a board's groups
   *  are without recomputing. Set at discovery. */
  recog?: Map<string, number>;
}

/** Key into Container.pairSep. */
const sepKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** In one bottom-up pass compute, for every node, two disjoint-theme lists:
 *  • OFFERED — the shallowest theme in each branch, contributed UPWARD to a parent
 *    container. A named theme contributes only itself (we don't fragment a clean group
 *    like "Ducks" when it's a group inside a broader board), so this list is disjoint.
 *  • BELOW — the offered themes of its children: the groups a board rooted HERE would
 *    use. A node with ≥4 of these is a "container" that can host a board.
 *  Splitting the two lets a named family be BOTH a single group in an order-level board
 *  AND, separately, its own board of genus-level groups ("four duck genera"). Its depth
 *  records group separation: shallow = spread across the tree (easy), deep = clustered
 *  sibling groups (hard).
 *
 *  FAMILY_AS_CONTAINER gates the second use. It's ON: it maximises the pool (every named
 *  family that can field 4 genus-groups becomes a board). The genus-level boards it adds
 *  skew to famous mammal genera, but the STRUCTURAL difficulty tier (see difficultyTier)
 *  routes those sub-collections into harder bands rather than flooding the easy days, so
 *  the extra boards are a win instead of the imbalance a fame-only tier produced. */
const FAMILY_AS_CONTAINER = true;
function containers(tree: Tree, themes: Map<string, Theme>): Container[] {
  const e = eulerOf(tree);
  const offered = new Map<string, Theme[]>();
  const belowOf = new Map<string, Theme[]>();
  const compute = (id: string): Theme[] => {
    const cached = offered.get(id);
    if (cached) return cached;
    const below: Theme[] = [];
    for (const c of tree.childrenOf.get(id) ?? []) below.push(...compute(c));
    belowOf.set(id, below);
    const self = themes.get(id);
    let res: Theme[];
    if (self && self.named) {
      res = [self]; // offered upward as one clean, recognisable group
    } else if (self) {
      // An unnamed theme: prefer named groups found below (nicer reveal labels);
      // fall back to this shallowest clade only if the whole branch is unnamed.
      res = below.some((t) => t.named) ? below : [self];
    } else {
      res = below;
    }
    offered.set(id, res);
    return res;
  };
  compute(tree.rootId);

  // A container's candidates are its own disjoint groups PLUS one level finer: the groups
  // each of those could be broken into. Committing to a single granularity for all 365 days
  // is what made a board like Panthera / Lynx / Dogs / Bears impossible, and that board is
  // exactly the Mon/Tue shape the gates ask for — one genuinely confusable pair (two cat
  // genera, separation 6) with the rest merely related (separation 3). It also stranded
  // groups outright: a node whose two children each hold three usable groups offers only
  // two, too few for a board, while neither child can host one either, so six good groups
  // became unreachable.
  //
  // ONE level, not the whole subtree. Unbounded, the root would offer all ~1,300 themes and
  // every node's list would be its entire subtree: discovery computes pairwise separations
  // per container (O(n^2)) and container fame would stop describing anything.
  //
  // The list is therefore NO LONGER pairwise disjoint, which two things now depend on:
  // buildBoard skips a theme nested with one already chosen, and discover ignores ancestor
  // pairs when looking for a confusable pair.
  const out: Container[] = [];
  for (const [id, off] of offered) {
    const base = FAMILY_AS_CONTAINER && (belowOf.get(id)?.length ?? 0) >= off.length ? belowOf.get(id)! : off;
    const seen = new Set(base.map((t) => t.cladeId));
    const list = [...base];
    for (const t of base)
      for (const finer of belowOf.get(t.cladeId) ?? [])
        if (!seen.has(finer.cladeId)) { seen.add(finer.cladeId); list.push(finer); }
    // Admission counts the DISJOINT groups available, not the list length: a list of one
    // clade plus its three children looks like four groups and can only ever field three.
    // On a tree the leaf-most themes are a maximum antichain, so counting them is exact.
    const disjoint = list.filter((t) => !list.some((o) => o.cladeId !== t.cladeId && contains(e, t.cladeId, o.cladeId))).length;
    if (disjoint >= GRID_GROUPS) out.push({ id, depth: tree.depthOf.get(id) ?? 0, themes: list });
  }
  return out;
}

/** Seeded ordering of a container's themes, named ones first (their revealed group
 *  labels read nicely) then the rest, each block shuffled for daily variety. Returns
 *  the WHOLE list, not just four: buildBoard walks it and takes the first four themes
 *  that can field a giveaway-free group at the day's word cap, skipping any that can't.
 *
 *  Above-floor themes come before relaxed (500-2000 fame) ones regardless of naming, so a
 *  board takes its best three or four first and only reaches into the relaxed band when it
 *  is short a slot. Without this the relaxed theme would be just as likely to land in slot
 *  one, which is not what it is for.
 *
 *  `ageOf` gives the ordering a MEMORY of what has been played, and without it the shuffle
 *  is the main source of near-repeats. A container with six usable themes can field 15
 *  different boards; for any one of them, 1 of the other 14 repeats all four groups and 8
 *  repeat exactly three, so two memoryless draws from that container land three-or-more
 *  apart 60% of the time. It also wasted containers outright: boardForDay rejects any board
 *  carrying a group seen in the last GRID_GROUP_ANTI_REPEAT_WINDOW days, so a blind draw
 *  would hand back a doomed board and the container counted as unusable that day even when
 *  a perfectly good subset of its themes was free.
 *
 *  Bucketed, not sorted on raw age, and applied only AFTER the fame/named ranks: sorting on
 *  exact age would make the pick a function of history alone and kill the day-to-day
 *  rotation the shuffle exists to provide, and putting it ahead of fame would let a stale
 *  board beat a recognisable one.
 *
 *  `speciesAgeOf` then breaks the remaining ties by how much UNSHOWN stock a theme still
 *  holds. Distinct species over a year is capped not by the memory in pickMembers but by
 *  the pools of the themes that get picked: a theme seen n times can show at most 4n
 *  species, and measured over a year 116 of 218 used groups had already shown every member
 *  they have, while big pools sat idle (Paridae 22 species on ONE board, Thraupidae 20 on
 *  one). Preferring the theme with fresh stock spends the idle pools instead of re-spending
 *  exhausted ones, and demotes four-species themes, which can never rotate at all. */
function orderedThemes(
  list: Theme[],
  rng: () => number,
  ageOf?: (cladeId: string) => number,
  speciesAgeOf?: (speciesId: string) => number
): Theme[] {
  const shuffled = shuffle([...list], rng);
  // Fame only. A `named` tier used to sit under this, ranking a Latin-labelled group below a
  // common-named one of equal fame — but the label is the REVEAL, not the puzzle, and
  // difficulty here is group closeness, never obscurity. It cost more than prettiness: the
  // common-named groups are a small set, so they saturated (max 17 appearances a year, and a
  // single group reached 25) while equally recognisable Latin ones idled. Dropping it takes
  // max reuse to 12, distinct groups 249 -> 258 and off-band boards 27 -> 19. Latin labels go
  // from 65% to 77% of slots, which is the intended trade.
  const rank = (t: Theme) => (t.recognisability >= MIN_BOARD_FAME ? 0 : 1);
  // Enough unshown members to field a whole fresh group, enough for some rotation, or none.
  const stock = (t: Theme) => {
    if (!speciesAgeOf) return 0;
    let fresh = 0;
    for (const id of t.leaves) if (speciesAgeOf(id) >= SPECIES_REPEAT_WINDOW) fresh++;
    return fresh >= GRID_GROUP_SIZE ? 0 : fresh > 0 ? 1 : 2;
  };
  const recency = (t: Theme) => {
    if (!ageOf) return 0;
    const age = ageOf(t.cladeId);
    // free · costs group spacing · barred outright by the hard gate.
    // TRIED AND REVERTED: a fourth bucket putting NEVER-shown themes ahead of merely-stale
    // ones. It sounds like more variety and measures worse on both test windows (distinct
    // four-group sets 238 -> 232 and 235 -> 225), because spending the unseen themes on
    // sight forces the reused ones back sooner.
    return age >= GRID_GROUP_SPACING ? 0 : age >= GRID_GROUP_ANTI_REPEAT_WINDOW ? 1 : 2;
  };
  return shuffled.sort((a, b) => rank(a) - rank(b) || recency(a) - recency(b) || stock(a) - stock(b));
}

const label = (tree: Tree, id: string) => {
  const n = tree.byId.get(id);
  return n?.common ?? n?.sciName ?? id;
};

// The broad, Lineage-style groups a board must stay WITHIN — every board features
// exactly one, so it never mixes two ("no birds-and-lizards board"). Each maps one
// or more tree marker clades to a player-facing group and carries a MIN TIER: the
// unfamiliar groups (plants, molluscs, spiders) are barred from the easy early-week
// days and only surface once the week gets harder, while mammals/birds anchor Monday.
// Because a board's four groups always come from one CONTAINER (a single tree node)
// tagged with this group, staying within one group is automatic — the container can't
// span two of them. (Config: the game's own notion of a broad group, not taxonomy.)
// Every animal group is allowed all week; the fame floors then decide which actually
// appear (a group only surfaces on an easy day if its container is famous enough — famous
// sharks/crocs/butterflies do, obscure ones don't). This keeps the easy end varied instead
// of always mammals/birds.
// Which weekday tiers each broad group may appear on. This is about the REVEAL MODE, not
// difficulty: Mon-Wed (1-3) shows name + picture, Thu-Fri (4-5) name only, Sat-Sun (6-7)
// picture only. A group whose organisms are recognised by SIGHT rather than by name must
// not land on the name-only days.
//
// Plants are the case that forced this. They used to be a `minTier: 4` floor, i.e. allowed
// on 4-7, and they ended up almost entirely on Thu/Fri — 30 of 53 Thursdays — because the
// weekend band asks for separation >= 4.5 and botany has no rank between family and order,
// so plants top out at 3-4 and the band penalty pushed them off 6-7. That left them stranded
// on precisely the two days with no pictures, where four plant families are close to
// unplayable. They now get Wednesday (name + picture, and the easy band's 3-3.5 window is
// exactly where plant separation sits) and the picture-only weekend.
// `minGap` — days that must pass before this class may host another board. Only the
// occasional-guest classes set it. Without it, restricting a class to few tiers backfires:
// plants sit at separation 3, which is exactly the easy band's window, so once they were
// limited to Wednesday they won 51 of 52 Wednesdays outright and Wednesday became plant day.
const ALL_TIERS = [1, 2, 3, 4, 5, 6, 7];
const BROAD_GROUPS: Array<{ group: string; tiers: number[]; markers: string[]; minGap?: number }> = [
  { group: "Mammals", tiers: ALL_TIERS, markers: ["Mammalia"] },
  { group: "Birds", tiers: ALL_TIERS, markers: ["Aves"] },
  { group: "Fish", tiers: ALL_TIERS, markers: ["Actinopterygii", "Elasmobranchii", "Chondrichthyes"] },
  { group: "Reptiles", tiers: ALL_TIERS, markers: ["Squamata", "Testudines", "Crocodylia"] },
  { group: "Amphibians", tiers: ALL_TIERS, markers: ["Amphibia"] },
  { group: "Insects", tiers: ALL_TIERS, markers: ["Insecta"] },
  { group: "Plants", tiers: [3, 6, 7], minGap: 21, markers: ["Magnoliopsida", "Liliopsida", "Pinopsida", "Polypodiopsida"] },
  { group: "Molluscs", tiers: [3, 6, 7], minGap: 21, markers: ["Gastropoda", "Bivalvia", "Cephalopoda"] },
  { group: "Spiders", tiers: [6, 7], minGap: 28, markers: ["Arachnida"] },
];
const MARKER_TO_GROUP = new Map<string, string>();
for (const g of BROAD_GROUPS) for (const m of g.markers) MARKER_TO_GROUP.set(m, g.group);
const GROUP_TIERS = new Map(BROAD_GROUPS.map((g) => [g.group, new Set(g.tiers)]));
const GROUP_MIN_GAP = new Map(BROAD_GROUPS.flatMap((g) => (g.minGap ? [[g.group, g.minGap] as const] : [])));

/** A container's FAME — the primary difficulty signal (median fame of its floored
 *  themes; each theme's fame set in allThemes). Famous groups are easier to place, but
 *  fame alone isn't enough — see tightnessBump. */
function containerFame(c: Container): number {
  return medianOf(c.themes.map((t) => t.fame));
}

// SEPARATION → difficulty tier: see separationTierOf / MRCA_TIER in ./tree (shared with
// Branches). What makes a board hard is how closely related its four groups are — read off
// the rank of their MRCA. Four genera inside one FAMILY are near-siblings, temptingly
// cross-placeable, hard; four families across an ORDER are distinct and easy; four groups
// spanning a CLASS are trivially separable. This is the "sub-collection harder than
// super-collection" rule made precise: a sub-collection's groups share a deeper ancestor.

/** A BOARD's separation profile, read off its four groups alone: for each of the six
 *  group-pairs, the MRCA-rank separation, summarised three ways.
 *   • med — the board's overall tightness, and its DIFFICULTY. Median (not the single
 *     all-four MRCA) is robust to an outlier: three near-identical salmonid genera + one
 *     distant viperfish still reads as tight, because most pairs share a deep ancestor.
 *   • min — the LOOSEST pair. Low means one group is a giveaway nobody can misplace.
 *   • max — the TIGHTEST pair, i.e. is there anything here to confuse at all.
 *
 *  Obscurity is deliberately NOT part of difficulty. It used to be (difficulty was the
 *  stronger of separation and a fame tier), and that was wrong twice over. It let boards
 *  through the floor for the wrong reason: of the 44 trivially-separable boards in a
 *  generated year, ALL 44 cleared the old floor on obscurity alone, and 16 of them landed
 *  Mon–Wed, where the tile NAMES are printed and obscurity cannot bite — those are the
 *  walkovers (real play: 08-12 took 1.00 of available points, 08-03 and 08-11 0.97). And
 *  where obscurity did bite it made boards unplayable rather than interesting: the two
 *  worst of 22 played boards were obscure and well separated (cutworm moths + Lymantriidae
 *  0.02, four beetle families 0.11), while the tightest famous board — Small cats / Big
 *  cats / Lynxes / Spotted cats, separation 6 — scored 0.64 at a 78% win rate. Eight
 *  similar well-known monkeys beat four obscure moths plus four obscure butterflies.
 *  Fame survives only as a fairness FLOOR (MIN_BOARD_FAME): can players name the group. */
function boardSeparation(
  tree: Tree,
  groupIds: string[],
  pairSep?: Map<string, number>
): { med: number; min: number; max: number; core: number } {
  const n = groupIds.length;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const pairs: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const memo = pairSep?.get(sepKey(groupIds[i], groupIds[j]));
      const v = memo ?? pairSeparation(tree, groupIds[i], groupIds[j]);
      m[i][j] = m[j][i] = v;
      pairs.push(v);
    }
  // CORE — the tightest three-way trap on the board: over every triple, how close its
  // LOOSEST pair is; take the best triple. A board earns its difficulty from having three
  // groups you can genuinely confuse, not from all four being mildly related.
  let core = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const t = Math.min(m[i][j], m[i][k], m[j][k]);
        if (t > core) core = t;
      }
  pairs.sort((a, b) => a - b);
  return { med: medianOf(pairs), min: pairs[0], max: pairs[pairs.length - 1], core };
}

/** A board's SPREAD in branch distance, the rank-free mirror of boardSeparation:
 *   • med — how wide the board is overall (MAX_WEEKEND_BRANCH_DISTANCE).
 *   • min — its TIGHTEST pair, i.e. whether anything on it is confusable at all
 *     (MAX_TIGHTEST_PAIR_DISTANCE).
 *   • core — its tightest TRIPLE. Not gated on: see the note by MAX_TIGHTEST_PAIR_DISTANCE
 *     for why the species set cannot currently afford it.
 *  Takes the container's precomputed distances when it has them, exactly as
 *  boardSeparation does — the gate runs on every candidate of every day. */
function boardBranchSpread(
  tree: Tree,
  groupIds: string[],
  pairDist?: Map<string, number>
): { med: number; min: number; core: number } {
  const n = groupIds.length;
  const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const pairs: number[] = [];
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const memo = pairDist?.get(sepKey(groupIds[i], groupIds[j]));
      const v = memo ?? branchDistance(tree, groupIds[i], groupIds[j]);
      m[i][j] = m[j][i] = v;
      pairs.push(v);
    }
  // CORE — the tightest TRIPLE: over every triple, its widest pair; keep the best triple.
  // The rank-free mirror of boardSeparation's `core`, and the measure that actually says
  // whether a board holds a puzzle.
  let core = Infinity;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++) {
        const t = Math.max(m[i][j], m[i][k], m[j][k]);
        if (t < core) core = t;
      }
  pairs.sort((a, b) => a - b);
  return { med: medianOf(pairs), min: pairs[0], core: core === Infinity ? pairs[0] : core };
}

// Difficulty is carried mostly by the REVEAL MODE (GridGame: name+picture Mon–Wed →
// name-only Thu–Fri → picture-only Sat–Sun), not by a precise fame ramp — a strict
// 7-level fame curve starved the easy days of variety (too few clades are famous
// enough). So each weekday sits in one of three loose BANDS matching the reveal split,
// and each band draws from a WIDE, overlapping fame window: pools stay large, boards
// stay varied, and difficulty is a tendency rather than a knife-edge. Band by weekday
// tier (1=Mon … 7=Sun): Mon–Wed easy, Thu–Fri medium, Sat–Sun hard.
// Wednesday sits in the MEDIUM band even though it keeps both aids. Difficulty is reveal
// mode plus separation, so a day that shows the name AND the picture can carry a tighter
// MRCA for the same total: Mon/Tue and Wed were previously identical on both axes (measured
// mean separation 3.54 / 3.56 / 3.40), which made the "seven-tier ramp" really a three-step
// one with three days stacked on each of the first two steps.
const WEEKDAY_BAND = [0, 0, 0, 1, 1, 1, 2, 2]; // index by weekday tier 1…7 (index 0 unused)
// Each band's window over a board's separation (boardSeparation.med, fractional because it
// is a median of six). Wide and overlapping on purpose: the band is a lean, not a gate;
// the reveal mode does the real work. Every board now clears the gates below, so the whole
// scale starts at 3 — the bands lean within "already worth playing", they no longer have to
// hold the trivial end out. Easy days lean to super-collections a rank or two apart, hard
// days to sub-collections sharing a family or genus.
const BAND_TIER_WINDOW: Array<[number, number]> = [
  [3, 3.5], // easy  (Mon–Wed, name + picture)
  [3.5, 4.5], // medium (Thu–Fri, name only)
  [4.5, 7], // hard  (Sat–Sun, picture only)
];
// Closeness is one currency but it does not buy the same difficulty in every class.
// Measured over 730 boards, closeness is flat across classes (mammals 3.87, birds 3.92)
// while fame is not: a mammal tile carries 7383 median pageviews against a bird's 4120,
// and a mammal GROUP 13532 against 7595. Difficulty is deliberately blind to fame (see
// the block above boardSeparation), so mammals ride easy inside whatever tier they land
// in — four mammal families at separation 3 separate themselves on sight, where four
// snake families at separation 3 genuinely do not. Shift the band for the classes players
// can eyeball, so those boards must sit closer to earn the same weekday. Applied per
// CONTAINER, not per day, since class varies candidate to candidate. Soft, like the band
// itself: a class that cannot go tighter is not banned, it just loses ties.
const CLASS_BAND_SHIFT: Record<string, number> = { Mammals: 0.5 };
/** Separation is a rank tier, so the window can never be pushed past the top of it. */
const MAX_SEPARATION = 7;

// TWO structural gates, applied to every candidate board on EVERY day. Unlike the band
// these are hard: `offBand` is only a +1 tiebreak, so a fresh-but-trivial board still won
// on score, which is how the walkovers got through.
//
// No pair of groups may be further apart than this, i.e. no group is a giveaway that
// nobody could misplace. The loosest pair is the best single board-level predictor of how
// players actually did (r = -0.487 against normalised score over 22 played boards, versus
// -0.412 for the median), and it is what makes a board with three tempting groups and one
// obvious one collapse to a three-way choice.
const MIN_PAIR_SEPARATION = 3;
// …but that applies only on the picture-only weekend, where every group should be
// confusable. Mon-Fri a board may take the Connections shape instead: a real three-way trap
// plus one group you get for free. That is a better puzzle than four mildly-related groups,
// and demanding all six pairs be close is what made a group with no close companion unusable
// at all, costing 108 of 261 groups over a year. The fourth group is floored too, just
// lower — it must still be a relative (same superorder or closer), never an unrelated
// organism. The loosest board this admits is [2,2,2,4,4,4], median exactly 3, so the 3+1
// shape lands on easy days and four-tight boards still land on hard ones: the bands need no
// change. A board whose four groups are all mutually close still passes, trivially.
const FOURTH_GROUP_MIN = 2;
/** How many groups must form the board's trap, by weekday tier (index 0 unused). Two
 *  confusable groups are enough on Mon/Tue; from Wednesday the board should hold a real
 *  three-way trap. `sep.max` is the tightest PAIR, `sep.core` the tightest TRIPLE. */
const TRAP_SIZE = [0, 2, 2, 3, 3, 3, 3, 3];
// …and at least one pair must be genuinely close, so every board has two groups you can
// honestly mix up. Without this a board can clear the floor above while still being four
// mutually-distant groups, none of them confusable with any other.
const MIN_TIGHTEST_PAIR = 4;
/** Tiers from which the board is picture-only (Sat-Sun) — mirrors GridGame's own constant. */
const PICTURE_ONLY_MIN_TIER = 6;
// SPREAD CAP, weekend only. The gates above are all expressed in separation tiers, and for
// most of the tree separation cannot see what it claims to (see branchDistance in ./tree:
// the MRCA resolves to `infraclass` for 88% of fish boards and 82% of bird ones, so those
// classes score a near-constant 4 whatever the groups are). A board of four different bird
// ORDERS therefore reads [4,4,4,4,4,4] — clearing tripleTrap and uniform outright — and
// Sunday 2026-08-16 served Pteroglossus / Buteo / Ninox / Alcedinidae, a toucan beside a
// hawk beside an owl beside a kingfisher, on the hardest day of the week.
//
// So the weekend gets one rank-free cap on top: the median branch distance over the six
// pairs. It is deliberately ONE-SIDED and set loose. Distance is not a difficulty scale and
// is not comparable class to class (see ./tree), but at the loose end the classes agree, and
// that is the only end this is asked about. Measured over 208 weekend boards in two years,
// a cap of 10 rejects 37 and every one of them is a board you would call a walkover on
// sight: the six fish sets spanning Teleostei (Rockcods / Moray eels / Catfish / Flounders
// at distance 32.5), Hummingbirds / Falcons / Ibises / Swamphen, Ants / Bees / Leaf-footed
// bugs / Carpenter bees, and the whole toucan-hawk-owl-kingfisher family that produced the
// Sunday above. A tight board is nowhere near it — four duck genera score 2.5, four
// sheep-and-goat relatives 2, and the weekend median is 6-7.
//
// 10 rather than 8 because 8 empties two classes off the weekend entirely (reptiles 20 -> 8
// boards, amphibians 4 -> 0) for a handful more rejections. The honest limit of the measure
// sits right at the threshold: at exactly 10 it keeps True frogs / True toads / Chorus frogs
// / Microhylidae, which is a fair picture-only board, and also Monitor lizards / Pit vipers
// / Geckos / Skinks, which is not. Distance cannot separate those two. It is unambiguous
// about the walkovers, which is what it is here for.
//
// Mon-Fri is not capped on the MEDIAN: those days print the group names, the band already
// leans them loose, and a wide board there is the Connections shape the gates want. They get
// the tightest-pair rule below instead.
const MAX_WEEKEND_BRANCH_DISTANCE = 10;
// …and EVERY day, the rank-free mirror of pairTrap: the board's tightest pair must be
// genuinely tight. A board with nothing confusable on it is a walkover on Monday exactly as
// it is on Sunday — the reveal mode changes how much help you get, not whether there is a
// puzzle — and pairTrap, which exists to prevent precisely that, reads the same blind
// separation as everything else. The Sunday board scored sep.max 4 and cleared it; its
// tightest pair is eight splits apart.
//
// It is safe for the Connections shape — a real trap plus a group you get for free. Measured
// over two years, every board of that shape has a tightest pair 2 or 3 splits apart
// (Porpoises / Sheep & goats / Gazella / Oryx: median 9, tightest pair 2). Capping the MEDIAN
// Mon-Fri would have killed those; capping the tightest pair leaves all of them.
//
// WHAT THIS DOES NOT CATCH, and why it is set here anyway. The honest rule is stricter: a
// board should hold three groups that hang together, not two, and the four-bird-orders family
// — Ramphastidae / Trogonidae / Alcedinidae / Buteo and its permutations — slips through with
// mid-range pairs of 5 to 7 and a tightest TRIPLE of 10. boardBranchSpread computes that
// triple, and gating on it is a one-line change. It is not made because the species set
// cannot pay for it. Measured over two generated years, against 387 distinct boards and 153
// near-repeat pairs on the shipped generator:
//
//   pair <= 7 (this)          405 boards, 147 near-repeats   <- the only setting that
//   pair <= 7 + triple <= 9   343 boards, 173 near-repeats      beats the shipped generator
//   triple <= 6 from Wed      309 boards, 300 near-repeats
//   pair <= 4                 310 boards, 267 near-repeats
//   triple <= 6 every day     281 boards, 395 near-repeats
//
// Every rule strict enough to remove those boards roughly doubles the near-repeat rate: too
// few clades have genuine near-siblings to fill 365 days, so demanding one daily forces the
// generator to recycle the handful that do. Trading a board a fortnight that reads easy for
// boards that visibly repeat is the worse deal. The real fix is a larger species set, after
// which this should become the triple.
const MAX_TIGHTEST_PAIR_DISTANCE = 7;

// …plus slack for a class whose corner of the tree is too COARSE to reach it — the same
// argument as MIN_TIGHTEST_PAIR_RELAXED one measure over. Branch distance counts splits, so
// where the tree holds few of them a class's tightest available pair sits further out however
// alike its groups look, and a flat cap judges every class by the best-resolved one.
//
// Only amphibians need it, and the number is not a guess: EVERY amphibian board in two
// generated years sits at median distance 9-16, and the ones a flat 7 rejects are True frogs
// / True toads / Chorus Frogs / Microhylidae at exactly 8 — four families of small brown
// frogs, as confusable by picture as anything in the game. One unit recovers those and
// nothing else; Newts & salamanders / True frogs / True toads / Chorus Frogs still fails,
// correctly, on the weekend median (16).
//
// FISH deliberately get NO slack, though they look like the same case and lose more boards
// (105 -> 82). They are the opposite case, and the fame numbers settle it: their WIDE boards
// are their FAMOUS ones — median group recognisability 7983 at distance 13+ against 6304 at
// 4 or less, the rejects being Moray eels (33646), Billfish (24370), Needlefish (13652).
// A board whose four groups you can all name and which look nothing alike is not hard
// because its species are unfamiliar; it is just easy, and obscurity is not difficulty
// (see boardSeparation). What survives — salmonids, sharks, the Cottales/Perches sets — is
// the genuinely confusable end of the class.
const CLASS_TRAP_DISTANCE_SHIFT: Record<string, number> = { Amphibians: 1 };
// …relaxed to this for a class whose tree simply isn't ranked finely enough to reach it
// (plants), rather than dropping the class. Still a real demand: at 3 the two groups share
// an order, e.g. four families inside Asparagales.
const MIN_TIGHTEST_PAIR_RELAXED = 3;
// A class keeps the full floor only if it can still field this many containers under it.
// Chosen so no class is left with a handful of containers cycling on repeat: plants clear
// 4 on 13 containers, which the anti-repeat window would grind into the same few boards.
const MIN_VIABLE_CONTAINERS = 25;
// …and a class whose ORDERS are the right unit of confusion takes the relaxed floor
// outright, regardless of how many containers it can field.
//
// The self-calibration above asks "can this class still fill a year at 4?", which birds and
// fish both answer yes to (98 and 43 containers against a threshold of 25) — measured per
// CONTAINER, where one close pair among a container's themes is enough. It says nothing
// about the boards actually drawn from them, and those collapse: holding birds at 4 costs
// 240 boards a year down to 118, and fish 105 down to 28.
//
// The floor is a rank, and a rank means different things in different corners of the tree.
// A bird order is TIGHT — kingfishers, bee-eaters and rollers really are confusable on
// sight — where Carnivora spans cats to seals. Demanding the same number from both is what
// made the honest fix look like a regression the first two times it was tried. Requiring
// "same order" of birds and fish is a real demand, not a waiver: it still throws out every
// cross-order board, which is the entire complaint (a hawk beside a trogon beside a
// kingfisher beside an owl, 38 occurrences over two years → 0).
//
// Measured over 730 days against live, this is the variant that wins on the metric that was
// supposed to be the cost: 420 distinct boards (live 405), 725 near-repeats inside 60 days
// (live 925), 1695 distinct species (live 1723). Birds settle at 197 and fish RISE to 150,
// their tree finally being read honestly rather than defaulting to the trap floor.
const CLASS_TIGHTEST_FLOOR: Record<string, number> = { Birds: 3, Fish: 3 };
// A GROUP whose four shown species have a median below this is never used — so no board
// ever contains a brutally obscure, unplaceable group (e.g. an obscure salamander
// family). Kept modest (not high): difficulty now comes from the reveal mode, not fame,
// so a moderately-obscure but still-nameable group is fair game — especially on the
// picture-only weekend, where you recognise by sight. Lowering this widens the container
// pool (more reptile/amphibian/plant variety). (Applied per theme in discover.)
const MIN_BOARD_FAME = 2000;
/** Below this a group is one most players cannot NAME even once they have solved it —
 *  `Petrogale`, `Potoroidae`, `Microhyloidea`. One or two of those on a board is the game
 *  teaching you something; a whole board of them is unplayable and unrewarding. */
const GROUP_NAMEABLE = 4000;
/** How many such groups a board may carry. The fame floors are all PER GROUP, so nothing
 *  stopped four marginal ones sitting together: measured over 730 boards, 103 (14%) had
 *  three or more and one had four — a picture-only Sunday of Potoroidae / Dendrolagus /
 *  Petrogale / Osphranter, i.e. separate rock-wallabies from tree-kangaroos from bettongs
 *  by sight, with four Latin labels as the reward. */
const MAX_OBSCURE_GROUPS = 2;

// …except that ONE group per board may sit below that, down to this harder floor, and only
// when the rest of the board is comfortably recognisable (RELAXED_COMPANION_MIN).
//
// The justification is elimination, not obscurity: three groups you can name plus one odd
// set left over is solvable, because the leftovers identify themselves. Four obscure groups
// is a wall — the live scores are unambiguous, every board that landed at 2-11% of available
// points had EVERY group obscure (four moth families, four beetle families).
//
// So the companion floor is what makes this safe, and it is not theoretical. Measured over
// a year of boards, the band filled 27 slots: 12 sat beside strong companions (Buteogallus
// with a weakest companion of 8712) and 15 did not (Torpediniformes with a weakest companion
// of 2364, on tiers 6 and 7 where everything else is obscure too). Only the first kind is
// the puzzle we want.
//
// NOTE what this band does NOT do. It was first written for groups whose fame lives in the
// group rather than its species — clownfish, octopus, nightjars. It never reached them: a
// relaxed theme is only considered when a CONTAINER RUNS SHORT, and short containers sit in
// obscure corners of the tree, while Amphiprion's container already had four better themes.
// That case is handled properly by Theme.recognisability instead (see patch-clade-views.mjs).
// What actually lands here is genuinely obscure: rain frogs, silversides, yellowthroats.
const MIN_BOARD_FAME_RELAXED = 500;
const MAX_SUB_FLOOR_GROUPS = 1;
// Every group ALREADY on the board must clear this before a relaxed one may join it.
const RELAXED_COMPANION_MIN = 5000;

interface Discovered {
  /** Each broad group's containers. */
  byGroup: Map<string, Container[]>;
  /** For each weekday tier 1…7, the containers eligible that day: every group past its
   *  min tier. The board's own difficulty is matched to the day's band in boardForDay. */
  tierPool: Map<number, Container[]>;
}

/** The broad group a node belongs to: the OUTERMOST (broadest) marker ancestor's
 *  group. A node above every class marker (e.g. Vertebrata) is "other" and never
 *  hosts a board — which is exactly what keeps a board inside one class. */
function broadGroupOf(tree: Tree, id: string): string {
  let group = "other";
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    const s = tree.byId.get(c)?.sciName;
    if (s && MARKER_TO_GROUP.has(s)) group = MARKER_TO_GROUP.get(s)!;
  }
  return group;
}

/** Expensive, tree-only discovery (theme + container enumeration) + per-tier group
 *  eligibility. Cached per tree. Only containers that sit WITHIN a broad group are kept —
 *  a cross-class container (group "other") can't host a board, so no board ever mixes two
 *  classes. (Board difficulty is scored later, per board, in boardForDay.) */
function discover(tree: Tree): Discovered | null {
  const eu = eulerOf(tree);
  const candidates = containers(tree, allThemes(tree)).filter((c) => broadGroupOf(tree, c.id) !== "other");
  if (candidates.length === 0) return null;

  const byGroup = new Map<string, Container[]>();
  const prepared: { c: Container; tightest: number }[] = [];
  for (const c of candidates) {
    // Drop themes below the RELAXED floor outright; keep the 500-2000 band because a board
    // may spend one slot down there (see MIN_BOARD_FAME_RELAXED). A container still needs
    // enough above-floor themes to fill every slot but the relaxed one, so it can never be
    // mostly obscure.
    c.themes = c.themes.filter((t) => t.recognisability >= MIN_BOARD_FAME_RELAXED);
    const aboveFloor = c.themes.filter((t) => t.recognisability >= MIN_BOARD_FAME);
    if (c.themes.length < GRID_GROUPS) continue;
    if (aboveFloor.length < GRID_GROUPS - MAX_SUB_FLOOR_GROUPS) continue;
    c.group = broadGroupOf(tree, c.id);
    // Fame stays the median of the ABOVE-floor themes: those are what a board is normally
    // built from, and scoring the container on the one relaxed theme it may never use would
    // shift its difficulty tier (and hence its weekday band) for the wrong reason.
    c.fame = containerFame({ ...c, themes: aboveFloor });
    // Pairwise separations, once. A container whose themes are ALL mutually distant can
    // never field a board with a confusable pair, so it is dropped below rather than
    // rebuilt and rejected on every one of the ~365 days it would be surveyed.
    c.recog = new Map(c.themes.map((t) => [t.cladeId, t.recognisability]));
    c.pairSep = new Map();
    c.pairDist = new Map();
    let tightest = 0;
    for (let i = 0; i < c.themes.length; i++)
      for (let j = i + 1; j < c.themes.length; j++) {
        const a = c.themes[i].cladeId, b = c.themes[j].cladeId;
        // A nested pair can never share a board, and its "separation" is the rank of the
        // outer clade itself — a large number that would fake a confusable pair and let a
        // container through the floor on a board it cannot build.
        if (overlaps(eu, a, b)) continue;
        const s = pairSeparation(tree, a, b);
        c.pairSep.set(sepKey(a, b), s);
        c.pairDist.set(sepKey(a, b), branchDistance(tree, a, b));
        if (s > tightest) tightest = s;
      }
    prepared.push({ c, tightest });
  }

  // How close two groups can get is capped by how finely the tree is RANKED there, and that
  // varies by class in a way that has nothing to do with how confusable the groups are.
  // Botany has no rank between family and order, so four Asparagales families — as
  // temptingly alike as four owl genera — top out at separation 3 and an absolute floor of
  // 4 would silently ban plants outright (it did: 0 plant boards in a generated year). So
  // the floor is per class: ask for a genuinely confusable pair, but never ask for more
  // than the class can supply. Measured per container over its own themes: birds field 85
  // containers at 4+, mammals 80, fish 43, insects 42 — plants only 13, against 68 at 3+.
  const tightestFloor = new Map<string, number>();
  for (const g of new Set(prepared.map((p) => p.c.group!))) {
    const viable = prepared.filter((p) => p.c.group === g && p.tightest >= MIN_TIGHTEST_PAIR).length;
    const byClass = CLASS_TIGHTEST_FLOOR[g];
    tightestFloor.set(g, byClass ?? (viable >= MIN_VIABLE_CONTAINERS ? MIN_TIGHTEST_PAIR : MIN_TIGHTEST_PAIR_RELAXED));
  }

  for (const { c, tightest } of prepared) {
    const floor = tightestFloor.get(c.group!) ?? MIN_TIGHTEST_PAIR;
    if (tightest < floor) continue;
    c.tightestFloor = floor;
    (byGroup.get(c.group!) ?? byGroup.set(c.group!, []).get(c.group!)!).push(c);
  }
  for (const cs of byGroup.values()) cs.sort((a, b) => (b.fame! - a.fame!) || (a.id < b.id ? -1 : 1));

  // For each weekday tier, pool EVERY container whose group is past its min tier
  // (structurally hard groups — plants/molluscs/spiders — stay off the easy early days).
  // The board's own difficulty (boardDiffTier, per its four groups) is matched to the
  // day's BAND window later, in boardForDay — not here — because a container can yield
  // boards of different difficulty depending which four themes are drawn.
  const tierPool = new Map<number, Container[]>();
  const all = [...byGroup.values()].flat();
  for (let tier = 1; tier <= 7; tier++) {
    tierPool.set(tier, all.filter((c) => GROUP_TIERS.get(c.group!)?.has(tier) ?? true));
  }
  return { byGroup, tierPool };
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

/** Would putting this theme on the board read as one group nested inside another? The four
 *  groups are always disjoint CLADES, but their NAMES can still overlap, and the player
 *  only sees names. The base tree's "Bovinae" holds Bos taurus while the augment's separate
 *  "Bos" node holds Bos mutus, so a board offers both and asks you to sort one Bos into
 *  Bovinae and another into Bos. Detected by the visible evidence rather than by topology:
 *  one group's scientific name IS the genus of another group's member species. (Fixing the
 *  augment's stale grafts is the real cure; this keeps such a pair off a board meanwhile.) */
function nestsWithAny(tree: Tree, cladeId: string, memberIds: string[], groups: GridGroup[]): boolean {
  const genusOf = (id: string) => (tree.byId.get(id)?.sciName ?? "").split(" ")[0];
  const sci = tree.byId.get(cladeId)?.sciName ?? "";
  const myGenera = new Set(memberIds.map(genusOf));
  return groups.some(
    (g) => (sci && g.memberIds.some((m) => genusOf(m) === sci)) || (g.sciLabel && myGenera.has(g.sciLabel))
  );
}

/** Build the board for a specific CONTAINER on a date, or null if this container can't
 *  field four giveaway-free groups at the day's word cap. Deterministic on (date,
 *  container) so a container yields the same board whenever it's the day's pick, but a
 *  different board on a different date (themes/members re-sampled). Walks the container's
 *  themes in preference order and takes the first four that each fill four members
 *  WITHOUT exceeding the word cap; a theme that can't (a whole genus sharing one word) is
 *  skipped. If fewer than four survive, the container is unusable today → null. */
function buildBoard(
  tree: Tree,
  container: Container,
  dateKey: string,
  tier: number,
  hist?: History
): GridBoard | null {
  const eb = eulerOf(tree);
  const rng = mulberry32(xmur3(`grebe:grid:${dateKey}:${container.id}`));
  // Which of this container's themes are still fresh (see orderedThemes). Optional so the
  // function stays usable without history; with it the board is a function of (date,
  // container, tier) AND what came before, which the sequential replay always has.
  const ageOf = hist
    ? (id: string) => {
        const seen = hist.groupSeenAt.get(id);
        return seen === undefined ? Infinity : hist.idx - seen;
      }
    : undefined;
  const speciesAgeOf = hist
    ? (id: string) => {
        const seen = hist.speciesSeenAt.get(id);
        return seen === undefined ? Infinity : hist.idx - seen;
      }
    : undefined;
  // Shared-word cap: at most 2 members share a distinctive word on the easy early-week
  // days (their species are famous and recognisable, so a shared name would only hand the
  // group away), loosening to 3 on the harder days (tier ≥ 4) where the species are
  // obscurer and a little name overlap is fair help — and on the picture-only weekend the
  // names are hidden during play anyway.
  const wordCap = tier >= 4 ? 3 : 2;
  // Thu-Fri (4-5) are the name-only days: there the tile name IS the tile, so a bare
  // binomial is a dud you cannot reason about. Everywhere else a picture is showing.
  const latinAllowance = tier <= 3 || tier >= 6 ? 1 : 0;
  const groups: GridGroup[] = [];
  let subFloor = 0; // groups taken from the relaxed fame band — at most MAX_SUB_FLOOR_GROUPS
  const accepted: number[] = []; // recognisability of each group already on the board
  for (const t of orderedThemes(container.themes, rng, ageOf, speciesAgeOf)) {
    if (groups.length >= GRID_GROUPS) break;
    const relaxed = t.recognisability < MIN_BOARD_FAME;
    if (relaxed && subFloor >= MAX_SUB_FLOOR_GROUPS) continue;
    // An odd group only works if its companions are ones a player can actually name — that
    // is what makes the leftovers identifiable. Tested against the groups accepted SO FAR,
    // which is sound because orderedThemes puts every above-floor theme first.
    if (relaxed && accepted.some((f) => f < RELAXED_COMPANION_MIN)) continue;
    const memberIds = pickMembers(tree, themePool(tree, t.leaves), GRID_GROUP_SIZE, rng, wordCap, t.latinPool, latinAllowance, speciesAgeOf);
    if (memberIds.length < GRID_GROUP_SIZE) continue; // theme would self-label — skip it
    // Two groups may not carry the SAME label. The tree still holds ~49 duplicate scientific
    // names as base-vs-augment pairs (the base "Colobus" and the augment's auggen_Colobus),
    // which no taxonomy rebuild fixes because the augment is not rebuilt, and a board
    // offering "Cebidae" twice is unsolvable by inspection.
    const lbl = label(tree, t.cladeId);
    if (groups.some((g) => g.label === lbl)) continue;
    // A container's themes may now overlap (see containers), so disjointness is enforced
    // here rather than guaranteed by the list: a group that CONTAINS another group on the
    // same board leaves the puzzle with no correct answer.
    if (groups.some((g) => overlaps(eb, t.cladeId, g.cladeId))) continue;
    if (nestsWithAny(tree, t.cladeId, memberIds, groups)) continue; // reads as a group inside a group
    // Count the allowance only once the theme is actually ACCEPTED: pickMembers can still
    // reject it on the word cap, and spending the allowance on a theme that never made the
    // board would leave the board a slot short for no reason.
    if (relaxed) subFloor++;
    accepted.push(t.recognisability);
    groups.push({
      cladeId: t.cladeId,
      label: lbl,
      sciLabel: tree.byId.get(t.cladeId)?.sciName ?? "",
      memberIds,
      level: 0, // assigned below
    });
  }
  if (groups.length < GRID_GROUPS) return null;

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

/** Days a board's group-SET may not return at all. A HARD gate, like the group rule below
 *  and unlike the soft cost this used to be. As a cost it competed on equal terms with
 *  everything else and lost: a set returning after 60 days charged 90-60 = 30, while missing
 *  the day's difficulty band charges 45 per rank, so the scorer would replay all four groups
 *  from two months ago rather than accept a slightly off-band board. Measured over a year
 *  that let 26 sets return inside the window, one after 49 days, where the pre-branch
 *  generator never repeated a set inside 90 days at all. Replaying the identical four groups
 *  is the worst outcome on offer, so it does not get a price. */
const GRID_ANTI_REPEAT_WINDOW = 90;
/** Beyond the hard window a repeated set still costs something, decaying to zero here — the
 *  same shape as GRID_GROUP_SPACING, and for the same reason: without it a set returns the
 *  day its gate expires. */
const GRID_SET_SPACING = 180;

/** Days an individual SPECIES should stay off the board before it is a preferred tile
 *  again (pickMembers). A preference, never a gate: a group with exactly four named
 *  members has no choice, and forbidding a repeat there would just delete the group. */
const SPECIES_REPEAT_WINDOW = 45;
/** What one recently-shown TILE costs a candidate board, in the same currency as group
 *  spacing and the band penalty. Until this existed the score was blind to species: a board
 *  of sixteen fresh species and one of sixteen seen last month scored the same, and every
 *  species rule lived in tile selection, i.e. after the board had already been chosen.
 *  Scored per board rather than as a theme-ordering preference on purpose — demoting
 *  species-exhausted THEMES also demotes them out of use entirely, which cost 14 distinct
 *  four-group combinations when tried. Sixteen tiles, so the cap is 16x this.
 *  Swept at 2/4/8/16 over two years. 16 edges it on raw variety (combinations 252 vs 247,
 *  distinct species 1544 vs 1529) but 8 is clearly better on repetition, which is the
 *  complaint this exists to answer: near-repeat boards 65 vs 72, and group returns with all
 *  four tiles identical 34 vs 52. */
const SPECIES_REPEAT_COST = 8;

/** Days an INDIVIDUAL group (clade) should stay clear of its recent predecessors —
 *  the dominant anti-repeat rule. The set-level window above only forbids the exact
 *  same four categories; on its own it let a board swap ONE of four groups and read
 *  as "fresh" while the other three groups — and their famous member species — recurred
 *  from the day before (a Mon/Tue board sharing Drums, Billfish and Rockcods). Barring
 *  any single group from reappearing within a week stops that: consecutive boards no
 *  longer echo yesterday's categories. Graceful — if a tier genuinely can't avoid a
 *  group repeat, boardForDay picks the board with the FEWEST recent groups.
 *
 *  SWEPT, leave it alone: 10/12/14/16/18/21 over two independent years put distinct
 *  four-group combinations at 229·228, 230·226, 238·235, 226·241, 241·234, 233·235 — a
 *  range with no trend, i.e. window-to-window noise. Relaxing it does NOT recover the
 *  combination count against the pre-branch generator (266); the gate limits WHEN a
 *  combination may be used, not which ones exist, so loosening it only lets the scorer
 *  revisit recent groups instead of exploring. Tightening to 21 does buy the fewest
 *  near-repeats (103·111) but the most identical group returns (125·111). */
const GRID_GROUP_ANTI_REPEAT_WINDOW = 14;
// Beyond the hard window, a group still costs something, decaying linearly to zero at this
// age. This is what stops a board reassembling itself the moment its groups expire.
const GRID_GROUP_SPACING = 45;
// Missing the day's band costs the same currency as group spacing, or it may as well not
// exist: spacing reaches ~124 for a board of four recently-seen groups, so the old flat +1
// was numerically invisible once spacing replaced the small binary weights, and the weekday
// ramp inverted. One rank off band is priced like reusing a group the day its hard window expires.
// Swept against 90, which bought a slightly stronger ramp (1.20-1.36 vs 1.16-1.22) for real
// variety: 187 distinct groups over 120 days instead of 197, and set repeats at 35d not 43d.
const BAND_PENALTY_PER_RANK = 45;
const BAND_PENALTY_CAP = 135;

/** The anti-repeat replay anchor: a fixed date safely BEFORE any viewable (pre-launch
 *  preview) day, so consecutive days — including the pre-launch shakedown ones the app
 *  serves today — always have real history to avoid. Deliberately DECOUPLED from
 *  DAILY_EPOCH (the display-number origin, which "only shifts the puzzle number, never
 *  which puzzle a date resolves to"): anchoring the replay at DAILY_EPOCH short-circuited
 *  every date at-or-before it to EMPTY history, so back-to-back pre-launch days repeated. */
const ANTIREPEAT_ANCHOR = "2026-06-22";

/** One day's board. Surveys EVERY eligible container that day (tierPool) in a stable
 *  per-date order and scores each buildable board, lowest-is-best, on three ordered
 *  criteria — then returns the best (breaking ties by the stable survey order):
 *    1. RECENT-GROUP overlap — how many of the four groups appeared in the last
 *       GRID_GROUP_ANTI_REPEAT_WINDOW days. This dominates: a board must not echo the
 *       previous days' categories, even at the cost of the two criteria below.
 *    2. SET staleness — the exact four-category set reused within GRID_ANTI_REPEAT_WINDOW.
 *    3. OFF-BAND — its own separation (boardSeparation.med over the four groups) outside
 *       the day's band window (variety/freshness beats hitting the exact difficulty; the
 *       reveal mode carries most of the difficulty anyway).
 *  Boards failing either structural gate (MIN_PAIR_SEPARATION, MIN_TIGHTEST_PAIR) are not
 *  candidates at all, and are kept only as a last-resort fallback.
 *  Containers that can't field a giveaway-free board today (buildBoard → null) are
 *  skipped. `seenAt` maps a category-set, and `groupSeenAt` an individual clade id, to
 *  the day index it last appeared. Returns null only if no container fields a clean
 *  board at all. An ideal board (score 0) short-circuits the survey. */
function boardForDay(
  tree: Tree,
  pool: Container[],
  dateKey: string,
  tier: number,
  hist: History
): GridBoard | null {
  const { seenAt, groupSeenAt, classSeenAt, idx: dayIdx } = hist;
  const [bandLo, bandHi] = BAND_TIER_WINDOW[WEEKDAY_BAND[tier] ?? 0];
  // Stable per-date survey order, so the pick varies day to day.
  const order = shuffle([...pool], mulberry32(xmur3(`grebe:grid:${dateKey}:${tier}:order`)));
  let best: GridBoard | null = null;
  let bestScore = Infinity;
  // Below-floor boards are kept only as a last resort, so a class whose containers are
  // ALL trivial still yields a board rather than a blank day.
  let floorFallback: GridBoard | null = null;
  let floorFallbackScore = Infinity;
  for (const c of order) {
    const board = buildBoard(tree, c, dateKey, tier, hist);
    if (!board) continue; // container can't avoid a giveaway today
    // Group spacing, as one age-decaying cost rather than a window that switches off. The
    // old binary window let an ENTIRE board come back the day it expired: at exactly 14 days
    // all four groups stop counting at once, so the whole set returns in a single step. No
    // weighting could fix that — a 14-day set repeat had to cost MORE than one recent group
    // to be avoided, and a stale set had to cost LESS than one recent group for the reverse
    // to hold. So the window is now a hard gate (measured affordable: every day of a 140-day
    // replay had candidates free of any recent group, median 48 of them), and beyond it the
    // cost decays to zero over GRID_GROUP_SPACING, which pushes a repeat of all four groups
    // far out without ever forbidding it.
    let recentGroups = 0, spacing = 0;
    for (const g of board.groups) {
      const seen = groupSeenAt.get(g.cladeId);
      if (seen === undefined) continue;
      const age = dayIdx - seen;
      if (age < GRID_GROUP_ANTI_REPEAT_WINDOW) recentGroups++;
      else spacing += Math.max(0, GRID_GROUP_SPACING - age);
    }
    // The set penalty decays over its own declared window, exactly as group spacing does.
    // As a flat charge it was inconsistent with the rest of the score and left a boundary
    // case: an exact four-set could return at 30 days because the flat amount happened to
    // beat the alternatives that day.
    const seen = seenAt.get(groupSig(board));
    const setAge = seen === undefined ? Infinity : dayIdx - seen;
    const setTooSoon = setAge < GRID_ANTI_REPEAT_WINDOW;
    const setCost = Math.max(0, GRID_SET_SPACING - setAge);
    // How much of this board the player has seen recently, tile by tile.
    let staleTiles = 0;
    for (const g of board.groups)
      for (const m of g.memberIds) {
        const shown = hist.speciesSeenAt.get(m);
        if (shown !== undefined && dayIdx - shown < SPECIES_REPEAT_WINDOW) staleTiles++;
      }
    const speciesCost = staleTiles * SPECIES_REPEAT_COST;
    const sep = boardSeparation(tree, board.groups.map((g) => g.cladeId), c.pairSep);
    // How far outside the day's band, not merely whether — and it costs more than it used
    // to. As a flat +1 the band was decorative: with difficulty now meaning closeness, a
    // fresh board two whole ranks off still won on score, so Monday 2026-08-17 drew
    // Bos/Bovinae/Tragelaphus/Kobus at separation 6/6/6 (the tightest board possible, on
    // the easiest day) while that Saturday drew the loosest board of its week. Capped at 3
    // so it stays below one recent group (4): freshness still wins, but only just.
    // The band this CLASS has to hit, which may sit above the day's own (CLASS_BAND_SHIFT).
    const shift = CLASS_BAND_SHIFT[c.group!] ?? 0;
    const lo = Math.min(bandLo + shift, MAX_SEPARATION);
    const hi = Math.min(bandHi + shift, MAX_SEPARATION);
    const offBy = Math.max(0, lo - sep.med, sep.med - hi);
    // Ordering matters more than the exact weights, and it used to be wrong: at 2, a board
    // whose ENTIRE four-group set was a repeat scored better than one reusing a single group
    // (4), so once the difficulty gates tightened the pool the generator started preferring
    // to replay a whole board. A repeated set must cost more than a repeated group.
    const score = spacing + setCost + speciesCost + Math.min(BAND_PENALTY_CAP, offBy * BAND_PENALTY_PER_RANK);
    const gap = GROUP_MIN_GAP.get(c.group!);
    const classSeen = classSeenAt.get(c.group!);
    const classTooSoon = gap !== undefined && classSeen !== undefined && dayIdx - classSeen < gap;
    const obscureGroups = board.groups.filter((g) => (c.recog?.get(g.cladeId) ?? Infinity) < GROUP_NAMEABLE).length;
    const tooObscure = obscureGroups > MAX_OBSCURE_GROUPS;
    // Two shapes are worth playing, and a weekday accepts EITHER — a union, so both are more
    // available than the single old rule, not less:
    //   TRAP     a set of groups close enough to genuinely confuse, plus others that are
    //            still relatives but an easier read (the Connections shape).
    //   UNIFORM  no trap that sharp, but every group close to every other (the old rule).
    // Requiring the trap ALONE looked right and measured worse: three groups mutually close
    // is a stronger demand than "all six pairs >= 3" is on four, so distinct groups over a
    // year fell 214 -> 202 even as boards with no trap at all fell 102 -> 26.
    // The TRAP GROWS through the week (TRAP_SIZE): two confusable groups carry a Monday,
    // three are wanted once the reveal aids start coming off. The weekend is picture-only
    // and hard on purpose, so it demands both shapes at once.
    const coreFloor = c.tightestFloor ?? MIN_TIGHTEST_PAIR;
    const pairTrap = sep.max >= coreFloor;              // two groups you can genuinely confuse
    const tripleTrap = sep.core >= coreFloor;           // three of them
    const uniform = sep.min >= MIN_PAIR_SEPARATION;     // nothing is a giveaway
    const riderOk = sep.min >= FOURTH_GROUP_MIN;        // free groups are still relatives
    // A pair trap is required EVERY day and is never traded away — offering it as one arm of
    // a union let 69 boards through with nothing confusable on them at all. Above that floor
    // the demand grows through the week: Mon/Tue are content with the pair, Wed-Fri want
    // either a three-way trap or uniform closeness, and the picture-only weekend wants a
    // three-way trap AND no giveaway.
    // …and the rank-free gates on top, because every tier read above is blind wherever the
    // tree carries no ranks (see MAX_TIGHTEST_PAIR_DISTANCE). `hasTrap` mirrors pairTrap and
    // applies every day; `notTooWide` mirrors uniform and applies only to the picture-only
    // weekend, since a wide board with a real trap is the shape Mon-Fri wants.
    const spread = boardBranchSpread(tree, board.groups.map((g) => g.cladeId), c.pairDist);
    const hasTrap = spread.min <= MAX_TIGHTEST_PAIR_DISTANCE + (CLASS_TRAP_DISTANCE_SHIFT[c.group!] ?? 0);
    const notTooWide = spread.med <= MAX_WEEKEND_BRANCH_DISTANCE;
    const shapeOk =
      hasTrap &&
      (tier >= PICTURE_ONLY_MIN_TIER
        ? tripleTrap && uniform && notTooWide
        : (TRAP_SIZE[tier] ?? 3) >= 3
        ? pairTrap && riderOk && (tripleTrap || uniform)
        : pairTrap && riderOk);
    if (classTooSoon || recentGroups > 0 || setTooSoon || tooObscure || !shapeOk) {
      if (score < floorFallbackScore) { floorFallback = board; floorFallbackScore = score; }
      continue; // giveaway group, or nothing on the board to confuse — see the gates
    }
    if (score < bestScore) { best = board; bestScore = score; }
    if (score === 0) break; // fresh groups, fresh set, on-band → nothing beats it
  }
  return best ?? floorFallback;
}

/**
 * Build the grid board for a date at a difficulty tier (1 gentle … 7 brutal).
 * Deterministic pure function of (tree, date, tier). Avoids reusing any individual
 * group within GRID_GROUP_ANTI_REPEAT_WINDOW days (and any four-category SET within
 * GRID_ANTI_REPEAT_WINDOW), so nearby boards don't echo yesterday's categories or
 * their famous species. Returns null only if the tree can't field a board.
 *
 * Replays the boards from ANTIREPEAT_ANCHOR up to the target date, keeping rolling
 * windows of the group-sets AND the individual groups actually shown. Anchoring at a
 * fixed date BEFORE any viewable day (not the target minus a window) makes every date
 * resolve identically no matter which is asked for, so a board shown on one day is
 * visible to the days that follow it — including the pre-launch preview days. Cheap:
 * discovery is cached per tree and each replayed day is O(1).
 */
/** The containers eligible at a tier (structurally hard groups gated off the easy
 *  days), or the whole set if a tier somehow has no pool. */
function tierPoolOf(d: Discovered, tier: number): Container[] {
  return d.tierPool.get(tier) ?? [...d.byGroup.values()].flat();
}

/** The replayed anti-repeat history, as a cursor sitting just BEFORE `dk`. Every day of the
 *  replay is generated at its own weekday tier (tierForDate), never at the tier the caller
 *  asked for — only the target day uses that — so one history serves all seven tiers and
 *  every caller. Recomputing it per call made the work quadratic in days-since-anchor and
 *  paid it again for each tier: the tests ask for seven tiers across many dates and were
 *  replaying the same days dozens of times. Advancing forward is amortised O(1) per day.
 *  Never holds the target day itself, which is why the cache is safe: the target is scored
 *  at the requested tier and deliberately not committed. */
interface History {
  idx: number;
  seenAt: Map<string, number>;        // category-set → day index last shown
  groupSeenAt: Map<string, number>;   // clade id → day index last shown
  classSeenAt: Map<string, number>;   // broad group → day index last shown (see GROUP_MIN_GAP)
  speciesSeenAt: Map<string, number>; // species leaf id → day index last shown
}
interface ReplayCursor extends History {
  dk: string;
}
/** A board generated with no history to avoid — pre-anchor days and arbitrary seeds. */
const emptyHistory = (): History => ({
  idx: 0, seenAt: new Map(), groupSeenAt: new Map(), classSeenAt: new Map(), speciesSeenAt: new Map(),
});
const cloneHistory = (h: History): History => ({
  idx: h.idx,
  seenAt: new Map(h.seenAt),
  groupSeenAt: new Map(h.groupSeenAt),
  classSeenAt: new Map(h.classSeenAt),
  speciesSeenAt: new Map(h.speciesSeenAt),
});
let replayCache = new WeakMap<Tree, ReplayCursor>();
// Periodic snapshots so going BACKWARD is cheap too. A cursor only moves forward, and
// callers do jump back: asking for the same span of dates at each of the seven tiers
// restarts at the earliest date every time, which replayed the whole history seven times.
// Cloning the two maps every REPLAY_CHECKPOINT days costs a dozen clones a year and bounds
// any backward jump to that many days of replay.
const REPLAY_CHECKPOINT = 32;
let checkpoints = new WeakMap<Tree, ReplayCursor[]>();
/** date → that day's natural-weekday-tier board, the only thing a replayed day contributes. */
let dayBoards = new WeakMap<Tree, Map<string, GridBoard | null>>();

// SERVED HISTORY — the boards players were actually shown.
//
// The replay above rebuilds "what has been on recently" by REGENERATING every past day with
// the current generator. That is fine while the generator never changes, and a lie the
// moment it does: after a version bump the memory describes boards nobody ever saw. Measured
// on the v8→v9 move, all six of the most recent already-served days regenerated as something
// else, so the anti-repeat windows were protecting phantom boards while the real ones — the
// birds people had just played — counted as unseen and were free to come round again.
//
// The pinned rows are the record of what was really served, and they carry exactly what the
// history is keyed on (clade ids + member ids). Inject them and the replay commits the REAL
// board for any date it has one for, generating only the days that have never been served.
//
// Consequence, stated plainly: with a seed installed a board is a function of (date, tree,
// what was actually served) rather than (date, tree) alone, so a repin is reproducible only
// against the same database. That is the point — the past is an input, not a re-derivation.
// With nothing injected every path below behaves exactly as it did before.
export interface ServedGridDay {
  groups: { cladeId: string; memberIds: string[] }[];
}
let servedGrid: Map<string, ServedGridDay> | null = null;
/** Install (or clear, with null) the real boards to replay instead of regenerating. Drops
 *  every replay cache: they hold histories built under the previous seed. */
export function setServedGridHistory(served: Map<string, ServedGridDay> | null): void {
  servedGrid = served && served.size ? served : null;
  replayCache = new WeakMap();
  checkpoints = new WeakMap();
  dayBoards = new WeakMap();
}
/** Fold one day's groups into the rolling windows. Takes the groups rather than a GridBoard
 *  so a decoded pin (which has no labels or tiles) can be committed the same way. */
function commitDay(tree: Tree, cur: History, groups: { cladeId: string; memberIds: string[] }[]): void {
  if (!groups.length) return;
  cur.seenAt.set(groups.map((g) => g.cladeId).sort().join(","), cur.idx);
  for (const g of groups) {
    cur.groupSeenAt.set(g.cladeId, cur.idx);
    for (const m of g.memberIds) cur.speciesSeenAt.set(m, cur.idx);
  }
  // Recomputed rather than stored on the board: GridBoard is the pinned payload shape.
  cur.classSeenAt.set(broadGroupOf(tree, groups[0].cladeId), cur.idx);
}

export function generateGridBoard(tree: Tree, dateKey: string, tier: number): GridBoard | null {
  const d = getDiscovered(tree);
  if (!d) return null;
  if (dateKey < ANTIREPEAT_ANCHOR) return boardForDay(tree, tierPoolOf(d, tier), dateKey, tier, emptyHistory());

  let cur = replayCache.get(tree);
  if (!cur || cur.dk > dateKey) {
    const saved = checkpoints.get(tree) ?? [];
    // newest checkpoint at or before the target, else start over from the anchor
    const cp = saved.filter((c) => c.dk <= dateKey).pop();
    cur = cp
      ? { dk: cp.dk, ...cloneHistory(cp) }
      : { dk: ANTIREPEAT_ANCHOR, ...emptyHistory() };
  }
  // The board a replayed day CONTRIBUTES is always its natural-weekday-tier board, and that
  // is a pure function of the day and the history before it — both deterministic — so it is
  // computed at most once per date however many times the history is walked. This is what
  // makes the replay cheap: without it every tier pass recomputed the same days (a board
  // costs ~14ms, so the seven-tier test spans replayed ~800 days of identical work).
  let days = dayBoards.get(tree);
  if (!days) { days = new Map(); dayBoards.set(tree, days); }
  while (cur.dk < dateKey) {
    const t = tierForDate(cur.dk);
    // A day that was really served contributes the board that was really served. Only days
    // with no pin are generated — pre-launch dates, and any gap in the record.
    const served = servedGrid?.get(cur.dk);
    if (served) {
      commitDay(tree, cur, served.groups);
    } else {
      let board = days.get(cur.dk);
      if (board === undefined) {
        board = boardForDay(tree, tierPoolOf(d, t), cur.dk, t, cur);
        days.set(cur.dk, board);
      }
      if (board) commitDay(tree, cur, board.groups);
    }
    cur = { ...cur, dk: shiftDate(cur.dk, 1), idx: cur.idx + 1 };
    if (cur.idx % REPLAY_CHECKPOINT === 0) {
      const saved = checkpoints.get(tree) ?? [];
      if (!saved.some((c) => c.dk === cur!.dk)) {
        saved.push({ dk: cur.dk, ...cloneHistory(cur) });
        saved.sort((a, b) => (a.dk < b.dk ? -1 : 1));
        checkpoints.set(tree, saved);
      }
    }
  }
  replayCache.set(tree, cur);
  return boardForDay(tree, tierPoolOf(d, tier), dateKey, tier, cur);
}

/** A single board from an ARBITRARY seed string + tier, with no anti-repeat
 *  replay. For playtest / reshuffle, where the "seed" is not a real date and so
 *  must NOT be fed to generateGridBoard (whose epoch replay only terminates on an
 *  exact date match — a non-date seed would loop forever). Deterministic on
 *  (seed, tier); the seed is used purely to drive the RNG. */
export function gridBoardForSeed(tree: Tree, seed: string, tier: number): GridBoard | null {
  const d = getDiscovered(tree);
  return d ? boardForDay(tree, tierPoolOf(d, tier), seed, tier, emptyHistory()) : null;
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
