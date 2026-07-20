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
import { leavesUnder, mrca, separationTierOf } from "./tree";
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
 *  sharing one vernacular, "…junglefowl" ×4) so the caller drops it. */
function pickMembers(tree: Tree, pool: string[], n: number, rng: () => number, wordCap: number): string[] {
  const views = (id: string) => tree.byId.get(id)?.views ?? 0;
  // Weighted-random order: higher views → key nearer 1 → earlier, but not deterministic.
  const seq = pool
    .map((id) => ({ id, key: Math.pow(rng(), 1 / Math.max(views(id), 1)) }))
    .sort((a, b) => b.key - a.key || (a.id < b.id ? -1 : 1))
    .map((x) => x.id);
  const chosen: string[] = [];
  const wordCount = new Map<string, number>();
  for (const id of seq) {
    if (chosen.length >= n) break;
    const words = nameWords(tree, id);
    if (words.some((w) => (wordCount.get(w) ?? 0) >= wordCap)) continue;
    chosen.push(id);
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
  named: boolean; // has a common name → nicer group label
  fame: number; // median views of the four species we'd show (difficulty currency)
}

const isLeaf = (tree: Tree, id: string) => (tree.childrenOf.get(id) ?? []).length === 0;

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
    const named = leavesUnder(tree, node.id).filter((id) => tree.byId.get(id)?.common);
    if (named.length < MIN_THEME_LEAVES || named.length > MAX_THEME_LEAVES) continue;
    out.set(node.id, { cladeId: node.id, leaves: named, named: Boolean(node.common), fame: fameOf(tree, named) });
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
  /** Median pageviews of the (floored) groups this container would show — the DIFFICULTY
   *  signal. Famous species are easy to recognise however tightly grouped; obscure ones
   *  are hard however broad. Set in discover(). */
  fame?: number;
}

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

  // A container is a node offering ≥4 disjoint themes upward (offered). With
  // FAMILY_AS_CONTAINER, a named family also hosts a board of its own sub-themes (below).
  const out: Container[] = [];
  for (const [id, off] of offered) {
    const list = FAMILY_AS_CONTAINER && (belowOf.get(id)?.length ?? 0) >= off.length ? belowOf.get(id)! : off;
    if (list.length >= GRID_GROUPS) out.push({ id, depth: tree.depthOf.get(id) ?? 0, themes: list });
  }
  return out;
}

/** Seeded ordering of a container's themes, named ones first (their revealed group
 *  labels read nicely) then the rest, each block shuffled for daily variety. Returns
 *  the WHOLE list, not just four: buildBoard walks it and takes the first four themes
 *  that can field a giveaway-free group at the day's word cap, skipping any that can't. */
function orderedThemes(list: Theme[], rng: () => number): Theme[] {
  const shuffled = shuffle([...list], rng);
  const named = shuffled.filter((t) => t.named);
  const rest = shuffled.filter((t) => !t.named);
  return [...named, ...rest];
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
// minTier gates only the STRUCTURALLY hard groups off the easy days (plants, molluscs,
// spiders — unfamiliar however famous the species). Every animal group is allowed from
// Monday; the fame band then decides which actually appear (a group only surfaces on an
// easy day if it has a famous-enough container — famous sharks/crocs/butterflies do,
// obscure ones don't). This keeps the easy end varied instead of always mammals/birds.
const BROAD_GROUPS: Array<{ group: string; minTier: number; markers: string[] }> = [
  { group: "Mammals", minTier: 1, markers: ["Mammalia"] },
  { group: "Birds", minTier: 1, markers: ["Aves"] },
  { group: "Fish", minTier: 1, markers: ["Actinopterygii", "Elasmobranchii", "Chondrichthyes"] },
  { group: "Reptiles", minTier: 1, markers: ["Squamata", "Testudines", "Crocodylia"] },
  { group: "Amphibians", minTier: 1, markers: ["Amphibia"] },
  { group: "Insects", minTier: 1, markers: ["Insecta"] },
  { group: "Plants", minTier: 4, markers: ["Magnoliopsida", "Liliopsida", "Pinopsida", "Polypodiopsida"] },
  { group: "Molluscs", minTier: 4, markers: ["Gastropoda", "Bivalvia", "Cephalopoda"] },
  { group: "Spiders", minTier: 5, markers: ["Arachnida"] },
];
const MARKER_TO_GROUP = new Map<string, string>();
for (const g of BROAD_GROUPS) for (const m of g.markers) MARKER_TO_GROUP.set(m, g.group);
const GROUP_MIN_TIER = new Map(BROAD_GROUPS.map((g) => [g.group, g.minTier]));

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

// Fame → tier (1 famous/easy … 7 obscure/hard): the ORIGINAL obscurity signal, preserved
// so our existing hard boards (obscure but well-separated families) stay hard.
const FAME_TIER_CUTS = [15000, 10000, 7500, 6000, 5000, 4000]; // ≥cut[i] → tier i+1; below all → 7
function fameToTier(fame: number): number {
  for (let i = 0; i < FAME_TIER_CUTS.length; i++) if (fame >= FAME_TIER_CUTS[i]) return i + 1;
  return 7;
}

/** A BOARD's difficulty tier (1 easy … 7 hard) from its four actual groups. TWO
 *  independent reasons a board is hard — take the stronger:
 *   • SEPARATION — the MEDIAN over the six group-pairs of their MRCA-rank separation.
 *     Median (not the single all-four MRCA) is robust to an outlier: three near-identical
 *     salmonid genera + one distant viperfish still reads as tight, because most pairs
 *     share a deep ancestor. A famous "four cat genera" board (pairs = family) is hard
 *     however recognisable the cats are.
 *   • OBSCURITY — the fame tier, so an obscure "four beetle families" board (well
 *     separated but unfamiliar) also stays hard.
 *  A famous, well-separated board (porpoise / giraffe / deer / kob — pairs at order) is
 *  easy on both counts and can no longer land on a brutal day. */
function boardDiffTier(tree: Tree, groupIds: string[], fame: number): number {
  const pairs: number[] = [];
  for (let i = 0; i < groupIds.length; i++)
    for (let j = i + 1; j < groupIds.length; j++)
      pairs.push(separationTierOf(tree, mrca(tree, groupIds[i], groupIds[j])));
  const separation = Math.round(medianOf(pairs));
  return Math.max(1, Math.min(7, Math.max(separation, fameToTier(fame))));
}

// Difficulty is carried mostly by the REVEAL MODE (GridGame: name+picture Mon–Wed →
// name-only Thu–Fri → picture-only Sat–Sun), not by a precise fame ramp — a strict
// 7-level fame curve starved the easy days of variety (too few clades are famous
// enough). So each weekday sits in one of three loose BANDS matching the reveal split,
// and each band draws from a WIDE, overlapping fame window: pools stay large, boards
// stay varied, and difficulty is a tendency rather than a knife-edge. Band by weekday
// tier (1=Mon … 7=Sun): Mon–Wed easy, Thu–Fri medium, Sat–Sun hard.
const WEEKDAY_BAND = [0, 0, 0, 0, 1, 1, 2, 2]; // index by weekday tier 1…7 (index 0 unused)
// Each band's window over a BOARD's difficulty tier (boardDiffTier: 1 easy … 7 hard —
// group separation or obscurity, whichever is stronger). Wide and overlapping on purpose:
// the band is a lean, not a gate; the reveal mode does the real work. Easy days lean to
// well-separated super-collections; hard days to tight sub-collections + obscure groups,
// but each can still run the other since the picture/name aids recognition.
const BAND_TIER_WINDOW: Array<[number, number]> = [
  [1, 4], // easy  (Mon–Wed, name + picture)
  [3, 6], // medium (Thu–Fri, name only)
  [4, 7], // hard  (Sat–Sun, picture only)
];
// A GROUP whose four shown species have a median below this is never used — so no board
// ever contains a brutally obscure, unplaceable group (e.g. an obscure salamander
// family). Kept modest (not high): difficulty now comes from the reveal mode, not fame,
// so a moderately-obscure but still-nameable group is fair game — especially on the
// picture-only weekend, where you recognise by sight. Lowering this widens the container
// pool (more reptile/amphibian/plant variety). (Applied per theme in discover.)
const MIN_BOARD_FAME = 2000;

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
  const candidates = containers(tree, allThemes(tree)).filter((c) => broadGroupOf(tree, c.id) !== "other");
  if (candidates.length === 0) return null;

  const byGroup = new Map<string, Container[]>();
  for (const c of candidates) {
    // Drop themes below the floor so no OBSCURE group is ever shown (an unplaceable
    // group is what makes a board brutal). A container needs four survivors to field a
    // board; its fame is then the median of the groups it can actually show.
    c.themes = c.themes.filter((t) => t.fame >= MIN_BOARD_FAME);
    if (c.themes.length < GRID_GROUPS) continue;
    c.group = broadGroupOf(tree, c.id);
    c.fame = containerFame(c);
    (byGroup.get(c.group) ?? byGroup.set(c.group, []).get(c.group)!).push(c);
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
    tierPool.set(tier, all.filter((c) => (GROUP_MIN_TIER.get(c.group!) ?? 1) <= tier));
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

/** Build the board for a specific CONTAINER on a date, or null if this container can't
 *  field four giveaway-free groups at the day's word cap. Deterministic on (date,
 *  container) so a container yields the same board whenever it's the day's pick, but a
 *  different board on a different date (themes/members re-sampled). Walks the container's
 *  themes in preference order and takes the first four that each fill four members
 *  WITHOUT exceeding the word cap; a theme that can't (a whole genus sharing one word) is
 *  skipped. If fewer than four survive, the container is unusable today → null. */
function buildBoard(tree: Tree, container: Container, dateKey: string, tier: number): GridBoard | null {
  const rng = mulberry32(xmur3(`grebe:grid:${dateKey}:${container.id}`));
  // Shared-word cap: at most 2 members share a distinctive word on the easy early-week
  // days (their species are famous and recognisable, so a shared name would only hand the
  // group away), loosening to 3 on the harder days (tier ≥ 4) where the species are
  // obscurer and a little name overlap is fair help — and on the picture-only weekend the
  // names are hidden during play anyway.
  const wordCap = tier >= 4 ? 3 : 2;
  const groups: GridGroup[] = [];
  for (const t of orderedThemes(container.themes, rng)) {
    if (groups.length >= GRID_GROUPS) break;
    const memberIds = pickMembers(tree, themePool(tree, t.leaves), GRID_GROUP_SIZE, rng, wordCap);
    if (memberIds.length < GRID_GROUP_SIZE) continue; // theme would self-label — skip it
    groups.push({
      cladeId: t.cladeId,
      label: label(tree, t.cladeId),
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

/** Days a board's group-set should stay clear of its recent predecessors (member
 *  species vary daily regardless). Some tiers have only a handful of on-difficulty
 *  category-sets, so a repeat inside the window is sometimes unavoidable — when it is,
 *  we repeat the LEAST-recently-used set, never a recent one. */
const GRID_ANTI_REPEAT_WINDOW = 90;

/** Board fame: the median across the four groups of each group's shown-member fame. */
function boardFame(tree: Tree, board: GridBoard): number {
  return medianOf(board.groups.map((g) => fameOf(tree, g.memberIds)));
}

/** One day's board. Surveys EVERY eligible container that day (tierPool) in a stable
 *  per-date order and returns the first that (a) matches the day's BAND — its own
 *  difficulty (boardDiffTier over the four groups) sits in the band window — and (b) is
 *  fresh (category-set unused within the window). Containers that can't field a
 *  giveaway-free board today (buildBoard → null) are skipped. Falls back, in order, to:
 *  the first fresh OUT-of-band board (variety over exact difficulty), then the globally
 *  least-recently-used set. `seenAt` maps a category-set to the day index it last
 *  appeared. Returns null only if no container can field a clean board at all. */
function boardForDay(tree: Tree, d: Discovered, dateKey: string, tier: number, seenAt: Map<string, number>, dayIdx: number): GridBoard | null {
  const [lo, hi] = BAND_TIER_WINDOW[WEEKDAY_BAND[tier] ?? 0];
  const pool = d.tierPool.get(tier) ?? [...d.byGroup.values()].flat();
  // Stable per-date survey order, so the pick varies day to day.
  const order = shuffle([...pool], mulberry32(xmur3(`grebe:grid:${dateKey}:${tier}:order`)));
  let freshOffBand: GridBoard | null = null;
  let lru: GridBoard | null = null;
  let lruSeen = Infinity;
  for (const c of order) {
    const board = buildBoard(tree, c, dateKey, tier);
    if (!board) continue; // container can't avoid a giveaway today
    const seen = seenAt.get(groupSig(board));
    const fresh = seen === undefined || dayIdx - seen >= GRID_ANTI_REPEAT_WINDOW;
    if (fresh) {
      const bd = boardDiffTier(tree, board.groups.map((g) => g.cladeId), boardFame(tree, board));
      if (bd >= lo && bd <= hi) return board;    // fresh AND on-band → ideal
      if (!freshOffBand) freshOffBand = board;   // fresh but wrong difficulty → fallback
    } else if (seen! < lruSeen) {
      lruSeen = seen!; lru = board;              // oldest-seen, last-resort repeat
    }
  }
  return freshOffBand ?? lru;
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
  if (dateKey <= DAILY_EPOCH) return boardForDay(tree, d, dateKey, tier, new Map(), 0);

  const seenAt = new Map<string, number>(); // category-set → day index last shown
  let idx = 0;
  for (let dk = DAILY_EPOCH; ; dk = shiftDate(dk, 1), idx++) {
    const t = dk === dateKey ? tier : tierForDate(dk);
    const board = boardForDay(tree, d, dk, t, seenAt, idx);
    if (dk === dateKey) return board;
    if (board) seenAt.set(groupSig(board), idx);
  }
}

/** A single board from an ARBITRARY seed string + tier, with no anti-repeat
 *  replay. For playtest / reshuffle, where the "seed" is not a real date and so
 *  must NOT be fed to generateGridBoard (whose epoch replay only terminates on an
 *  exact date match — a non-date seed would loop forever). Deterministic on
 *  (seed, tier); the seed is used purely to drive the RNG. */
export function gridBoardForSeed(tree: Tree, seed: string, tier: number): GridBoard | null {
  const d = getDiscovered(tree);
  return d ? boardForDay(tree, d, seed, tier, new Map(), 0) : null;
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
