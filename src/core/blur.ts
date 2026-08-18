// BLUR — the fourth daily. Identify a species from a photograph that starts at a handful of
// pixels and gains resolution with every wrong guess, with a Mastermind-style character table
// beside it showing which traits your guess shares with the answer.
//
// Pure: tree in, board out. No React, no data layer, no image fetching — the ladder images are
// built at pin time by scripts/blur-images.mjs and addressed by rung index.
import type { TaxonNode, Tree } from "./types";
import { leavesUnder, mrca } from "./tree";
import { CHARACTERS, characterValue, NA } from "./blurChars";

/** Rung widths in pixels. Full resolution is deliberately NOT a rung: it is the reward for
 *  finishing, so the last thing you play against is still a puzzle.
 *
 *  This starts where the picture first says something, and that correction came from playing
 *  rather than from measuring. The ladder was tuned on a contact sheet where every rung sat in
 *  a row BESIDE the full-resolution photo with the name a hover away — so 3px looked readable,
 *  because the eye had already been told what it was looking at. Cold, against several hundred
 *  animals, 3px and 5px are nothing at all and simply cost two guesses before the game starts.
 *
 *  Blur is a RECOGNITION game: the picture is the information channel and the guesses are
 *  attempts at it. That only works if the opening rung carries something, so it begins where a
 *  panda reads as a black-and-white blob and a zebra as a striped quadruped. Anything blinder
 *  turns it into deduction, which is Lineage's job. */
export const BLUR_LADDER = [11, 15, 20, 27, 36, 48, 64] as const;

/** The other mechanic under test: tiles per side, hardest first. Blur and shuffle destroy
 *  opposite halves of the picture — blur keeps silhouette and loses texture, shuffle keeps
 *  every pixel of texture and loses shape. Which is the better puzzle for naming an animal is
 *  a question only playing answers, so the prototype ships both and lets you switch. */
export const BLUR_SHUFFLE_LADDER = [20, 15, 11, 8, 6, 4, 3] as const;

export type BlurMechanic = "blur" | "shuffle";

/** Guesses allowed. One more than the rungs, so the final guess is made at the clearest rung
 *  rather than the reveal being wasted on a board nobody gets to answer. */
export const BLUR_MAX_GUESSES = BLUR_LADDER.length + 1;

/** Blur is an ANIMAL game. Rye, durum wheat and a nematode all cleared the fame floor in the
 *  first staged week, and none is a puzzle: a pixelated grass is indistinguishable from any
 *  other pixelated grass, and nobody pictures a nematode. Fame selects for article popularity,
 *  which for a crop has nothing to do with whether its photograph is recognisable. Restricting
 *  the pool is the honest fix; the character table keeps its plant rules for GUESSES, which
 *  stay unrestricted. */
export const BLUR_SCOPE_SCI = "Metazoa";

/** The animal root, or the whole tree if this snapshot has no Metazoa node. */
export function blurScopeId(tree: Tree): string {
  for (const n of tree.byId.values()) if (n.sciName === BLUR_SCOPE_SCI) return n.id;
  return tree.rootId;
}

/** Below this many Wikipedia pageviews a species is not a fair answer.
 *
 *  It started at 20000 (472 animals), because naming an organism you have never met is not
 *  hard, it is unfair. The candidate list changes that calculus: once the drill is narrow the
 *  names are on screen, so an unfamiliar animal is recognisable even when it is not
 *  recallable. 9000 nearly doubles the pool to 942 and pulls the median day well off the
 *  headline species, which was making boards easy on fame alone. */
export const BLUR_MIN_VIEWS = 9000;

export interface BlurCell {
  characterId: string;
  /** The guess's own value for this character. */
  value: string;
  /** Whether it matches the answer. `null` when either side is n/a — a plant has no leg
   *  count, and scoring that as agreement or disagreement would both be lies. */
  match: boolean | null;
}

export interface BlurGuess {
  node: TaxonNode;
  correct: boolean;
  cells: BlurCell[];
  /** How far it landed. Shown only when the proximity setting is on. */
  proximity: BlurProximity;
}

export interface BlurBoard {
  date: string;
  answerId: string;
  /** Pool the guess bar offers and the answer was drawn from. */
  scopeRootId: string;
}

/** xmur3, as everywhere else in the codebase — a board must be a pure function of its date. */
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

/** Species eligible to BE the answer: famous enough to be identifiable from a photo. Sorted so
 *  the pick is stable regardless of tree iteration order. */
export function blurPool(tree: Tree, scopeRootId: string): string[] {
  return leavesUnder(tree, scopeRootId)
    .filter((id) => {
      const n = tree.byId.get(id);
      return n?.rank === "species" && n.common && (n.views ?? 0) >= BLUR_MIN_VIEWS;
    })
    .sort();
}

/** One weighted draw. Weighted toward the better-known end of the pool, like Lineage, so the
 *  median day is a species people have actually heard of. `attempt` re-rolls it. */
function drawFrom(pool: string[], weights: number[], total: number, seed: string): string {
  const u = (xmur3(seed) / 4294967296) * total;
  let acc = 0;
  for (let i = 0; i < pool.length; i++) {
    acc += weights[i];
    if (u < acc) return pool[i];
  }
  return pool[pool.length - 1];
}

/** No species may come round again within this many days. The pool is a few hundred animals
 *  and the draw is weighted hard toward the famous end, so without this the same headline
 *  species really does land twice in a week — a test caught the horse on two consecutive days. */
export const BLUR_ANTI_REPEAT_WINDOW = 45;
/** Fixed point the anti-repeat walk starts from, so every date resolves identically whichever
 *  one you ask for. Before it, days are drawn with no history. */
export const BLUR_ANCHOR = "2026-08-01";

const shiftDay = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** date -> answer, per (tree, scope). The walk is forward-only and each day is O(pool). */
const answerCache = new WeakMap<Tree, Map<string, Map<string, string>>>();

/** The day's answer, avoiding anything served in the previous BLUR_ANTI_REPEAT_WINDOW days.
 *
 *  This REGENERATES the history rather than reading what was really served, which is exactly
 *  the trap the other two games were fixed for. It is correct here only because Blur has never
 *  been served: there is no history to read yet. The moment it is pinned it needs the same
 *  treatment (see setServedGridHistory in ./grid). */
export function blurAnswerFor(tree: Tree, dateKey: string, scopeRootId?: string): string | null {
  const scope = scopeRootId ?? blurScopeId(tree);
  const pool = blurPool(tree, scope);
  if (!pool.length) return null;
  // Flatter than a square root. sqrt still drew the same handful of headliners over and over,
  // which is a second way of making the game easy; this keeps a lean toward the known without
  // letting the top of the pool dominate.
  const weights = pool.map((id) => Math.pow(tree.byId.get(id)?.views ?? 1, 0.3));
  let total = 0;
  for (const w of weights) total += w;

  const seedOf = (d: string, attempt: number) =>
    attempt === 0 ? `grebe:blur:${d}:${scope}` : `grebe:blur:${d}:${scope}:${attempt}`;
  if (dateKey < BLUR_ANCHOR) return drawFrom(pool, weights, total, seedOf(dateKey, 0));

  let byScope = answerCache.get(tree);
  if (!byScope) { byScope = new Map(); answerCache.set(tree, byScope); }
  let days = byScope.get(scope);
  if (!days) { days = new Map(); byScope.set(scope, days); }

  const recent: string[] = [];
  for (let d = BLUR_ANCHOR; ; d = shiftDay(d, 1)) {
    let pick = days.get(d);
    if (pick === undefined) {
      // Re-roll until the draw is not one of the recent ones. Bounded: a pool of hundreds
      // against a window of tens always has something left.
      pick = drawFrom(pool, weights, total, seedOf(d, 0));
      for (let a = 1; a <= 24 && recent.includes(pick); a++) {
        pick = drawFrom(pool, weights, total, seedOf(d, a));
      }
      days.set(d, pick);
    }
    if (d === dateKey) return pick;
    recent.push(pick);
    if (recent.length > BLUR_ANTI_REPEAT_WINDOW) recent.shift();
  }
}

/** Score one guess against the answer. */
export function scoreBlurGuess(tree: Tree, answerId: string, guessId: string): BlurGuess | null {
  const node = tree.byId.get(guessId);
  if (!node) return null;
  const cells: BlurCell[] = CHARACTERS.map((c) => {
    const mine = characterValue(tree, c, guessId);
    const theirs = characterValue(tree, c, answerId);
    return {
      characterId: c.id,
      value: mine,
      match: mine === NA || theirs === NA ? null : mine === theirs,
    };
  });
  return { node, correct: guessId === answerId, cells, proximity: blurProximity(tree, answerId, guessId) };
}

/** Which rung is on screen after `wrong` wrong guesses, clamped to the last one. */
export function blurRung(wrong: number, mechanic: BlurMechanic = "blur"): number {
  const len = mechanic === "shuffle" ? BLUR_SHUFFLE_LADDER.length : BLUR_LADDER.length;
  return Math.min(Math.max(wrong, 0), len - 1);
}

/** How far a guess landed from the answer, WITHOUT naming the shared group.
 *
 *  Deliberately coarse. Lineage's mechanic is the named most-recent common ancestor plus a
 *  temperature, and that IS its game; handing the same thing over would make this one a reskin.
 *  A rank alone says how far ("same order") without saying which order, so it confirms a
 *  direction the picture suggested rather than replacing the picture. Optional for exactly that
 *  reason: with it on, a player can tree-search and ignore the photograph, which is the failure
 *  mode to watch for. */
export type BlurProximity = "same genus" | "same family" | "same order" | "same class" | "distant";

const PROXIMITY_BY_RANK: Record<string, BlurProximity> = {
  subgenus: "same genus", "species group": "same genus", "species subgroup": "same genus", genus: "same genus",
  subtribe: "same family", tribe: "same family", subfamily: "same family", family: "same family",
  superfamily: "same order", infraorder: "same order", parvorder: "same order", suborder: "same order", order: "same order",
  infraclass: "same class", subclass: "same class", class: "same class",
  // Nothing broader gets a "same" label. superclass was mapped to "same class" and reported a
  // fennec fox and an AXOLOTL as classmates: their MRCA is unranked, the walk climbed to
  // Tetrapoda, and superclass read as class. Above class, the honest answer is "distant".
};

export function blurProximity(tree: Tree, answerId: string, guessId: string): BlurProximity {
  const m = mrca(tree, answerId, guessId);
  if (!m) return "distant";
  for (let c: string | null | undefined = m; c; c = tree.byId.get(c)?.parentId) {
    const n = tree.byId.get(c);
    const hit = PROXIMITY_BY_RANK[n?.sepRank ?? n?.rank ?? ""];
    if (hit) return hit;
  }
  return "distant";
}

/** Every named clade between the root and a species, broad to narrow, with how many candidate
 *  answers each holds. This is what lets you look a species up and jump the filter straight to
 *  the level you meant — "show me where a fennec fox sits, then scope me to foxes". */
export function blurLineagePath(
  tree: Tree,
  speciesId: string,
  pool: Set<string>,
  scopeRootId?: string
): Array<{ id: string; label: string; count: number }> {
  const scope = scopeRootId ?? blurScopeId(tree);
  const chain: string[] = [];
  for (let c: string | null | undefined = tree.byId.get(speciesId)?.parentId; c; c = tree.byId.get(c)?.parentId) {
    if (c === scope) break; // the game's own root is where the filter already starts
    chain.push(c);
  }
  chain.reverse();
  const countUnder = (id: string) => {
    let n = 0;
    const stack = [id];
    while (stack.length) {
      const c = stack.pop()!;
      if (pool.has(c)) n++;
      for (const k of tree.childrenOf.get(c) ?? []) stack.push(k);
    }
    return n;
  };
  // Straight off the tree this reads "Metazoa 942 > Bilateria 936 > Vertebrata 756 >
  // Gnathostomata 755 > Euteleostomi 729 > Tetrapoda 622 > Amniota 600 > Mammal 236 > Theria
  // 234 > Eutherians 223 > Boreoeutheria 212 > Laurasiatheria 155 > Carnivora 74 …": sixteen
  // steps, most of them narrowing by a percent or two, and named for clades nobody scopes by.
  // A level earns its place by NARROWING, and an opaque scientific name has to narrow harder
  // than a common one to be worth showing. Result: Mammal > Carnivora > Canoidea > Vulpes.
  const NARROWS = 0.75;      // must cut at least a quarter of what the last kept level held
  const NARROWS_SCIENTIFIC = 0.5; // …or half, if the only name it has is a scientific one
  const out: Array<{ id: string; label: string; count: number }> = [];
  let prev = Infinity;
  for (const id of chain) {
    const n = tree.byId.get(id);
    if (!n || !(n.common || n.sciName)) continue;
    const count = countUnder(id);
    if (count < 1) continue;
    const ratio = count / prev;
    const gate = n.common ? NARROWS : NARROWS_SCIENTIFIC;
    if (ratio > gate) continue;
    out.push({ id, label: n.common ?? n.sciName, count });
    prev = count;
  }
  return out;
}

/** Candidate answers under a clade, for the endgame list. Recall is the wrong ask when the
 *  answer is a kinkajou: nobody names an animal they have never heard of, however clear the
 *  photo gets. Once the drill is narrow enough, showing the candidates turns it into
 *  recognition — "which of these twelve is what I am looking at" — which is winnable, and
 *  teaches you the animal instead of just failing you. */
export function blurCandidates(tree: Tree, cladeId: string, pool: Set<string>): TaxonNode[] {
  const out: TaxonNode[] = [];
  const stack = [cladeId];
  while (stack.length) {
    const c = stack.pop()!;
    if (pool.has(c)) { const n = tree.byId.get(c); if (n) out.push(n); }
    for (const k of tree.childrenOf.get(c) ?? []) stack.push(k);
  }
  return out.sort((a, b) =>
    (a.common ?? a.sciName).localeCompare(b.common ?? b.sciName));
}

/** One step of the drill-down filter: the named clades directly below `cladeId`, with how many
 *  candidate ANSWERS sit under each.
 *
 *  The count is the point. Seven class chips barely narrow anything — you pick Mammals and are
 *  still choosing between a hundred and eighty animals with no sense of progress. Watching
 *  "Animals 487 -> Mammals 180 -> Carnivorans 44 -> Cats 12" is the progress, and at twelve the
 *  endgame is actually winnable.
 *
 *  "Directly below" means the SHALLOWEST NAMED descendants: the tree keeps unnamed junction
 *  nodes that a player cannot reason about, so the walk descends through them and stops at the
 *  first thing with a name. */
export function blurDrillOptions(
  tree: Tree,
  cladeId: string,
  pool: Set<string>
): Array<{ id: string; label: string; count: number }> {
  const countUnder = (id: string): number => {
    let n = 0;
    const stack = [id];
    while (stack.length) {
      const c = stack.pop()!;
      if (pool.has(c)) n++;
      for (const k of tree.childrenOf.get(c) ?? []) stack.push(k);
    }
    return n;
  };
  /** The clades immediately below `id` that a PLAYER can reason about.
   *
   *  Stopping at any named node offered "Laurasiatheria", "Euarchontoglires", "Deuterostomia".
   *  Those are real clades and useless as buttons. So the walk prefers a COMMON name and
   *  descends through bare scientific ones, falling back to the scientific name only when
   *  there is nothing common-named below it — better a "Cercopithecidae" button than a dead
   *  end. */
  const rawBelow = (id: string) => {
    const out: Array<{ id: string; label: string; count: number }> = [];
    const visit = (c: string) => {
      const n = tree.byId.get(c);
      if (!n || n.rank === "species") return;
      const count = countUnder(c);
      if (count === 0) return;
      if (n.common) { out.push({ id: c, label: n.common, count }); return; }
      const before = out.length;
      for (const k of tree.childrenOf.get(c) ?? []) visit(k);
      if (out.length === before && n.sciName) out.push({ id: c, label: n.sciName, count });
    };
    for (const k of tree.childrenOf.get(id) ?? []) visit(k);
    return out;
  };

  // COLLAPSE PASS-THROUGH LEVELS. Straight off the tree this produced
  // "Bilateria 469 -> Deuterostomia 399 -> Chordates 399 -> Craniata 399": four taps, no
  // narrowing, and three names no player reasons with. Whenever one child holds almost
  // everything, that level is not a choice — so descend through it and CARRY the small
  // siblings along, which is what keeps Cnidaria (3) reachable instead of stranding it
  // behind a branch nobody would ever tap.
  const DOMINANT = 0.9;
  const carried: Array<{ id: string; label: string; count: number }> = [];
  let options = rawBelow(cladeId);
  for (let guard = 0; guard < 24; guard++) {
    if (options.length === 0) break;
    const total = options.reduce((a, o) => a + o.count, 0);
    const big = options.reduce((a, o) => (o.count > a.count ? o : a));
    if (options.length > 1 && big.count / total < DOMINANT) break;
    const below = rawBelow(big.id);
    if (!below.length) break; // nothing finer — offer this level as it stands
    for (const o of options) if (o.id !== big.id) carried.push(o);
    options = below;
  }
  return [...options, ...carried].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** The answer's own row, for the solved/failed state. */
export function blurAnswerRow(tree: Tree, answerId: string): BlurCell[] {
  return CHARACTERS.map((c) => ({
    characterId: c.id,
    value: characterValue(tree, c, answerId),
    match: true,
  }));
}
