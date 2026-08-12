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
 *  sharing one vernacular, "…junglefowl" ×4) so the caller drops it.
 *
 *  Also skips a candidate whose FULL common name is already on the board's group: the tree
 *  carries a few distinct taxa under one vernacular ("Pitcher plant" ×3 Nepenthes) and even
 *  true synonym duplicates (Alpaca = Lama pacos & Vicugna pacos), and two tiles with the
 *  identical label is a confusing, unsolvable giveaway. */
function pickMembers(tree: Tree, pool: string[], n: number, rng: () => number, wordCap: number): string[] {
  const views = (id: string) => tree.byId.get(id)?.views ?? 0;
  // Weighted-random order: higher views → key nearer 1 → earlier, but not deterministic.
  const seq = pool
    .map((id) => ({ id, key: Math.pow(rng(), 1 / Math.max(views(id), 1)) }))
    .sort((a, b) => b.key - a.key || (a.id < b.id ? -1 : 1))
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
  /** max(fame, the clade's own article views) — "would a player recognise this group?",
   *  which is NOT the same question as "are its species individually famous". Read only by
   *  the MIN_BOARD_FAME / MIN_BOARD_FAME_RELAXED floors, never by difficulty tiering. */
  recognisability: number;
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
    out.set(node.id, {
      cladeId: node.id,
      leaves: named,
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
  /** The confusable-pair floor that applies to this container's class (see discover). */
  tightestFloor?: number;
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
 *  that can field a giveaway-free group at the day's word cap, skipping any that can't.
 *
 *  Above-floor themes come before relaxed (500-2000 fame) ones regardless of naming, so a
 *  board takes its best three or four first and only reaches into the relaxed band when it
 *  is short a slot. Without this the relaxed theme would be just as likely to land in slot
 *  one, which is not what it is for. */
function orderedThemes(list: Theme[], rng: () => number): Theme[] {
  const shuffled = shuffle([...list], rng);
  const rank = (t: Theme) => (t.recognisability >= MIN_BOARD_FAME ? 0 : 1) * 2 + (t.named ? 0 : 1);
  return shuffled.sort((a, b) => rank(a) - rank(b));
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
): { med: number; min: number; max: number } {
  const pairs: number[] = [];
  for (let i = 0; i < groupIds.length; i++)
    for (let j = i + 1; j < groupIds.length; j++) {
      const memo = pairSep?.get(sepKey(groupIds[i], groupIds[j]));
      pairs.push(memo ?? separationTierOf(tree, mrca(tree, groupIds[i], groupIds[j])));
    }
  pairs.sort((a, b) => a - b);
  return { med: medianOf(pairs), min: pairs[0], max: pairs[pairs.length - 1] };
}

// Difficulty is carried mostly by the REVEAL MODE (GridGame: name+picture Mon–Wed →
// name-only Thu–Fri → picture-only Sat–Sun), not by a precise fame ramp — a strict
// 7-level fame curve starved the easy days of variety (too few clades are famous
// enough). So each weekday sits in one of three loose BANDS matching the reveal split,
// and each band draws from a WIDE, overlapping fame window: pools stay large, boards
// stay varied, and difficulty is a tendency rather than a knife-edge. Band by weekday
// tier (1=Mon … 7=Sun): Mon–Wed easy, Thu–Fri medium, Sat–Sun hard.
const WEEKDAY_BAND = [0, 0, 0, 0, 1, 1, 2, 2]; // index by weekday tier 1…7 (index 0 unused)
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
// …and at least one pair must be genuinely close, so every board has two groups you can
// honestly mix up. Without this a board can clear the floor above while still being four
// mutually-distant groups, none of them confusable with any other.
const MIN_TIGHTEST_PAIR = 4;
// …relaxed to this for a class whose tree simply isn't ranked finely enough to reach it
// (plants), rather than dropping the class. Still a real demand: at 3 the two groups share
// an order, e.g. four families inside Asparagales.
const MIN_TIGHTEST_PAIR_RELAXED = 3;
// A class keeps the full floor only if it can still field this many containers under it.
// Chosen so no class is left with a handful of containers cycling on repeat: plants clear
// 4 on 13 containers, which the anti-repeat window would grind into the same few boards.
const MIN_VIABLE_CONTAINERS = 25;
// A GROUP whose four shown species have a median below this is never used — so no board
// ever contains a brutally obscure, unplaceable group (e.g. an obscure salamander
// family). Kept modest (not high): difficulty now comes from the reveal mode, not fame,
// so a moderately-obscure but still-nameable group is fair game — especially on the
// picture-only weekend, where you recognise by sight. Lowering this widens the container
// pool (more reptile/amphibian/plant variety). (Applied per theme in discover.)
const MIN_BOARD_FAME = 2000;

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
    c.pairSep = new Map();
    let tightest = 0;
    for (let i = 0; i < c.themes.length; i++)
      for (let j = i + 1; j < c.themes.length; j++) {
        const s = separationTierOf(tree, mrca(tree, c.themes[i].cladeId, c.themes[j].cladeId));
        c.pairSep.set(sepKey(c.themes[i].cladeId, c.themes[j].cladeId), s);
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
    tightestFloor.set(g, viable >= MIN_VIABLE_CONTAINERS ? MIN_TIGHTEST_PAIR : MIN_TIGHTEST_PAIR_RELAXED);
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
function buildBoard(tree: Tree, container: Container, dateKey: string, tier: number): GridBoard | null {
  const rng = mulberry32(xmur3(`grebe:grid:${dateKey}:${container.id}`));
  // Shared-word cap: at most 2 members share a distinctive word on the easy early-week
  // days (their species are famous and recognisable, so a shared name would only hand the
  // group away), loosening to 3 on the harder days (tier ≥ 4) where the species are
  // obscurer and a little name overlap is fair help — and on the picture-only weekend the
  // names are hidden during play anyway.
  const wordCap = tier >= 4 ? 3 : 2;
  const groups: GridGroup[] = [];
  let subFloor = 0; // groups taken from the relaxed fame band — at most MAX_SUB_FLOOR_GROUPS
  const accepted: number[] = []; // recognisability of each group already on the board
  for (const t of orderedThemes(container.themes, rng)) {
    if (groups.length >= GRID_GROUPS) break;
    const relaxed = t.recognisability < MIN_BOARD_FAME;
    if (relaxed && subFloor >= MAX_SUB_FLOOR_GROUPS) continue;
    // An odd group only works if its companions are ones a player can actually name — that
    // is what makes the leftovers identifiable. Tested against the groups accepted SO FAR,
    // which is sound because orderedThemes puts every above-floor theme first.
    if (relaxed && accepted.some((f) => f < RELAXED_COMPANION_MIN)) continue;
    const memberIds = pickMembers(tree, themePool(tree, t.leaves), GRID_GROUP_SIZE, rng, wordCap);
    if (memberIds.length < GRID_GROUP_SIZE) continue; // theme would self-label — skip it
    // Two groups may not carry the SAME label. The tree still holds ~49 duplicate scientific
    // names as base-vs-augment pairs (the base "Colobus" and the augment's auggen_Colobus),
    // which no taxonomy rebuild fixes because the augment is not rebuilt, and a board
    // offering "Cebidae" twice is unsolvable by inspection.
    const lbl = label(tree, t.cladeId);
    if (groups.some((g) => g.label === lbl)) continue;
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

/** Days a board's group-SET should stay clear of its recent predecessors. */
const GRID_ANTI_REPEAT_WINDOW = 90;

/** Days an INDIVIDUAL group (clade) should stay clear of its recent predecessors —
 *  the dominant anti-repeat rule. The set-level window above only forbids the exact
 *  same four categories; on its own it let a board swap ONE of four groups and read
 *  as "fresh" while the other three groups — and their famous member species — recurred
 *  from the day before (a Mon/Tue board sharing Drums, Billfish and Rockcods). Barring
 *  any single group from reappearing within a week stops that: consecutive boards no
 *  longer echo yesterday's categories. Graceful — if a tier genuinely can't avoid a
 *  group repeat, boardForDay picks the board with the FEWEST recent groups. */
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
  seenAt: Map<string, number>,
  groupSeenAt: Map<string, number>,
  dayIdx: number
): GridBoard | null {
  const [lo, hi] = BAND_TIER_WINDOW[WEEKDAY_BAND[tier] ?? 0];
  // Stable per-date survey order, so the pick varies day to day.
  const order = shuffle([...pool], mulberry32(xmur3(`grebe:grid:${dateKey}:${tier}:order`)));
  let best: GridBoard | null = null;
  let bestScore = Infinity;
  // Below-floor boards are kept only as a last resort, so a class whose containers are
  // ALL trivial still yields a board rather than a blank day.
  let floorFallback: GridBoard | null = null;
  let floorFallbackScore = Infinity;
  for (const c of order) {
    const board = buildBoard(tree, c, dateKey, tier);
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
    const seen = seenAt.get(groupSig(board));
    const setStale = seen !== undefined && dayIdx - seen < GRID_ANTI_REPEAT_WINDOW;
    const sep = boardSeparation(tree, board.groups.map((g) => g.cladeId), c.pairSep);
    // How far outside the day's band, not merely whether — and it costs more than it used
    // to. As a flat +1 the band was decorative: with difficulty now meaning closeness, a
    // fresh board two whole ranks off still won on score, so Monday 2026-08-17 drew
    // Bos/Bovinae/Tragelaphus/Kobus at separation 6/6/6 (the tightest board possible, on
    // the easiest day) while that Saturday drew the loosest board of its week. Capped at 3
    // so it stays below one recent group (4): freshness still wins, but only just.
    const offBy = Math.max(0, lo - sep.med, sep.med - hi);
    // Ordering matters more than the exact weights, and it used to be wrong: at 2, a board
    // whose ENTIRE four-group set was a repeat scored better than one reusing a single group
    // (4), so once the difficulty gates tightened the pool the generator started preferring
    // to replay a whole board. A repeated set must cost more than a repeated group.
    const score = spacing + (setStale ? GRID_GROUP_SPACING : 0) + Math.min(BAND_PENALTY_CAP, offBy * BAND_PENALTY_PER_RANK);
    if (recentGroups > 0 || sep.min < MIN_PAIR_SEPARATION || sep.max < (c.tightestFloor ?? MIN_TIGHTEST_PAIR)) {
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
interface ReplayCursor {
  dk: string;
  idx: number;
  seenAt: Map<string, number>;      // category-set → day index last shown
  groupSeenAt: Map<string, number>; // clade id → day index last shown
}
const replayCache = new WeakMap<Tree, ReplayCursor>();
// Periodic snapshots so going BACKWARD is cheap too. A cursor only moves forward, and
// callers do jump back: asking for the same span of dates at each of the seven tiers
// restarts at the earliest date every time, which replayed the whole history seven times.
// Cloning the two maps every REPLAY_CHECKPOINT days costs a dozen clones a year and bounds
// any backward jump to that many days of replay.
const REPLAY_CHECKPOINT = 32;
const checkpoints = new WeakMap<Tree, ReplayCursor[]>();
/** date → that day's natural-weekday-tier board, the only thing a replayed day contributes. */
const dayBoards = new WeakMap<Tree, Map<string, GridBoard | null>>();

export function generateGridBoard(tree: Tree, dateKey: string, tier: number): GridBoard | null {
  const d = getDiscovered(tree);
  if (!d) return null;
  if (dateKey < ANTIREPEAT_ANCHOR) return boardForDay(tree, tierPoolOf(d, tier), dateKey, tier, new Map(), new Map(), 0);

  let cur = replayCache.get(tree);
  if (!cur || cur.dk > dateKey) {
    const saved = checkpoints.get(tree) ?? [];
    // newest checkpoint at or before the target, else start over from the anchor
    const cp = saved.filter((c) => c.dk <= dateKey).pop();
    cur = cp
      ? { dk: cp.dk, idx: cp.idx, seenAt: new Map(cp.seenAt), groupSeenAt: new Map(cp.groupSeenAt) }
      : { dk: ANTIREPEAT_ANCHOR, idx: 0, seenAt: new Map(), groupSeenAt: new Map() };
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
    let board = days.get(cur.dk);
    if (board === undefined) {
      board = boardForDay(tree, tierPoolOf(d, t), cur.dk, t, cur.seenAt, cur.groupSeenAt, cur.idx);
      days.set(cur.dk, board);
    }
    if (board) {
      cur.seenAt.set(groupSig(board), cur.idx);
      for (const g of board.groups) cur.groupSeenAt.set(g.cladeId, cur.idx);
    }
    cur = { ...cur, dk: shiftDate(cur.dk, 1), idx: cur.idx + 1 };
    if (cur.idx % REPLAY_CHECKPOINT === 0) {
      const saved = checkpoints.get(tree) ?? [];
      if (!saved.some((c) => c.dk === cur!.dk)) {
        saved.push({ dk: cur.dk, idx: cur.idx, seenAt: new Map(cur.seenAt), groupSeenAt: new Map(cur.groupSeenAt) });
        saved.sort((a, b) => (a.dk < b.dk ? -1 : 1));
        checkpoints.set(tree, saved);
      }
    }
  }
  replayCache.set(tree, cur);
  return boardForDay(tree, tierPoolOf(d, tier), dateKey, tier, cur.seenAt, cur.groupSeenAt, cur.idx);
}

/** A single board from an ARBITRARY seed string + tier, with no anti-repeat
 *  replay. For playtest / reshuffle, where the "seed" is not a real date and so
 *  must NOT be fed to generateGridBoard (whose epoch replay only terminates on an
 *  exact date match — a non-date seed would loop forever). Deterministic on
 *  (seed, tier); the seed is used purely to drive the RNG. */
export function gridBoardForSeed(tree: Tree, seed: string, tier: number): GridBoard | null {
  const d = getDiscovered(tree);
  return d ? boardForDay(tree, tierPoolOf(d, tier), seed, tier, new Map(), new Map(), 0) : null;
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
