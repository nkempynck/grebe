// MOSAIC — the fourth daily. Identify a species from a photograph that starts at a handful of
// pixels and gains resolution with every wrong guess, with a Mastermind-style character table
// beside it showing which traits your guess shares with the answer.
//
// Pure: tree in, board out. No React and no data layer, and it does not fetch the picture — but
// it does decide WHICH picture. Two draws live here: mosaicAnswerFor, the dated one the game
// will ship on once it is pinned like the other three, and mosaicSampleAnswer, the random one
// the beta plays on while the picture comes live off Wikipedia instead of a staged file.
import type { TaxonNode, Tree } from "./types";
import { edgeDistance, leavesUnder, mrca } from "./tree";
import { CHARACTERS, characterValue, NA } from "./mosaicChars";

/** Rung widths in pixels. Full resolution is deliberately NOT a rung: it is the reward for
 *  finishing, so the last thing you play against is still a puzzle.
 *
 *  This starts where the picture first says something, and that correction came from playing
 *  rather than from measuring. The ladder was tuned on a contact sheet where every rung sat in
 *  a row BESIDE the full-resolution photo with the name a hover away — so 3px looked readable,
 *  because the eye had already been told what it was looking at. Cold, against several hundred
 *  animals, 3px and 5px are nothing at all and simply cost two guesses before the game starts.
 *
 *  Mosaic is a RECOGNITION game: the picture is the information channel and the guesses are
 *  attempts at it. That only works if the opening rung carries something, so it begins where a
 *  panda reads as a black-and-white blob and a zebra as a striped quadruped. Anything blinder
 *  turns it into deduction, which is Lineage's job. */
export const MOSAIC_BLUR_LADDER = [11, 15, 20, 27, 36, 48, 64] as const;

/** THE SHIPPING MECHANIC: tiles per side, hardest first. Blur and shuffle destroy opposite
 *  halves of the picture — blur keeps silhouette and loses texture, shuffle keeps every pixel
 *  of texture and loses shape. Playing both settled it: a blurred animal at the hard end is a
 *  coloured smudge with nothing to look at, while a scrambled one always has fur, scales, an
 *  eye, a stripe somewhere in the frame. There is something to reason about on the first rung,
 *  which is the difference between a puzzle and a wait.
 *
 *  Opened up from 20 to 24 a side on 2026-08-30, after the live beta: 400 tiles still left a
 *  cat's eye and whiskers sitting whole in the frame, so the opening rung was reading as a
 *  picture with gaps rather than as a scramble. 576 tiles cuts each one 17% narrower, which
 *  breaks up a face without touching the end of the ladder — the last rung stays 3 because the
 *  reveal is the reward and should not get stingier.
 *
 *  The whole ladder moves with the endpoint rather than only the first rung, since mosaicLadder
 *  resamples this curve for the longer days. */
export const MOSAIC_SHUFFLE_LADDER = [24, 17, 12, 8, 6, 4, 3] as const;

export type MosaicMechanic = "blur" | "shuffle";

/** Blur is kept behind the test bench, not deleted: it is the honest comparison for any future
 *  change to the reveal, and it costs one branch to keep. */
export const MOSAIC_DEFAULT_MECHANIC: MosaicMechanic = "shuffle";

/** The baseline guess count: one more than the rungs, so the final guess is made at the clearest
 *  rung rather than the reveal being wasted on a board nobody gets to answer.
 *
 *  It is a FLOOR, not a fixed rule. Harder days get more (see MosaicAids.guesses), because the
 *  weekend takes the narrowing and the lookup away without giving anything back, and eight
 *  guesses at a scrambled animal with no way to narrow is not a harder puzzle so much as a
 *  shorter one. */
export const MOSAIC_MAX_GUESSES = MOSAIC_BLUR_LADDER.length + 1;

/** How a guess's distance is reported back.
 *
 *  "named" gives the shared RANK — "same family" — which is a instruction as much as a
 *  reading: it tells you where to go looking, and the narrowing panel is right there to go
 *  there with. "degrees" gives only Lineage's temperature, so you learn you are warmer than
 *  your last guess without learning what you are warm to. Same underlying tree, far less to
 *  act on, and neither one ever names the shared clade — that is Lineage's mechanic and
 *  handing it over would make this game a reskin. */
export type MosaicProximityMode = "named" | "degrees";

/** What the player gets besides the picture, on a given day. */
export interface MosaicAids {
  /** Mon=1 … Sun=7. */
  tier: number;
  /** Look a species up to see the clades it sits in, and jump the filter to one of them. */
  lookup: boolean;
  /** Narrow the pool by clade. Carries the candidate NAME list with it, so losing this is
   *  much more than losing a filter: the weekend is recall, not recognition. */
  subset: boolean;
  proximity: MosaicProximityMode;
  /** How many guesses the day allows. It rises as the aids fall, and the reveal ladder stretches
   *  to fill it, so the extra guesses buy TIME with the picture rather than extra shots at the
   *  clearest rung. See mosaicRung. */
  guesses: number;
}

/** THE WEEK. Mosaic's difficulty is not the picture — every day runs the same ladder against
 *  the same pool — it is how much help you get turning a picture into a name. Two levers, each
 *  stepping down once:
 *
 *    Mon/Tue  lookup + subset, named proximity   (Gentle)    8 guesses
 *    Wed      lookup + subset, degrees           (Tricky)    8 guesses
 *    Thu/Fri  subset, degrees                    (Harder)    9 guesses
 *    Sat/Sun  nothing but the picture, degrees   (Brutal)   10 guesses
 *
 *  The guess count is the compensation, and it is deliberately small. A day that takes the
 *  narrowing away has removed the only tool for turning "some kind of bird" into a name, so it
 *  gives back time to look instead: the reveal is resampled onto more rungs (see mosaicLadder),
 *  so the picture comes back in finer steps rather than the player getting more attempts at the
 *  clearest one. More time with the picture, not more shots at a nearly-solved board.
 *
 *  Those are the same four bands, on the same weekdays, as Lineage's resolution ramp — see
 *  DIFFICULTY in data/dailySchedule. Not a coincidence worth engineering around, but the
 *  labels line up, so the two games describe their Wednesday the same way.
 *
 *  Note what this ramp does NOT touch: the character table is on all week. It is the game's
 *  mechanic, not an aid, and a Sunday without it is not a harder puzzle but a different and
 *  worse one. */
const AIDS_BY_TIER: ReadonlyArray<Omit<MosaicAids, "tier">> = [
  { lookup: true,  subset: true,  proximity: "named",   guesses: 8 },  // Mon
  { lookup: true,  subset: true,  proximity: "named",   guesses: 8 },  // Tue
  { lookup: true,  subset: true,  proximity: "degrees", guesses: 8 },  // Wed
  { lookup: false, subset: true,  proximity: "degrees", guesses: 9 },  // Thu
  { lookup: false, subset: true,  proximity: "degrees", guesses: 9 },  // Fri
  { lookup: false, subset: false, proximity: "degrees", guesses: 10 }, // Sat
  { lookup: false, subset: false, proximity: "degrees", guesses: 10 }, // Sun
];

/** Weekday difficulty tier for a date (Mon=1 … Sun=7) — matches dailySchedule and the other
 *  two games, so a "tier 5" board means the same weekday everywhere. */
export function mosaicTierForDate(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00Z`).getUTCDay(); // Sun=0 … Sat=6
  return ((day + 6) % 7) + 1;
}

/** The aids for a tier 1…7, clamped. Split from the date so the test bench can force one. */
export function mosaicAids(tier: number): MosaicAids {
  const t = Math.min(7, Math.max(1, Math.round(tier) || 1));
  return { tier: t, ...AIDS_BY_TIER[t - 1] };
}

/** The aids for a date. */
export function mosaicAidsFor(dateKey: string): MosaicAids {
  return mosaicAids(mosaicTierForDate(dateKey));
}

/** Mosaic is an ANIMAL game. Rye, durum wheat and a nematode all cleared the fame floor in the
 *  first staged week, and none is a puzzle: a pixelated grass is indistinguishable from any
 *  other pixelated grass, and nobody pictures a nematode. Fame selects for article popularity,
 *  which for a crop has nothing to do with whether its photograph is recognisable. Restricting
 *  the pool is the honest fix; the character table keeps its plant rules for GUESSES, which
 *  stay unrestricted. */
export const MOSAIC_SCOPE_SCI = "Metazoa";

/** The animal root, or the whole tree if this snapshot has no Metazoa node. */
export function mosaicScopeId(tree: Tree): string {
  for (const n of tree.byId.values()) if (n.sciName === MOSAIC_SCOPE_SCI) return n.id;
  return tree.rootId;
}

/** Below this many Wikipedia pageviews a species is not a fair answer.
 *
 *  It started at 20000 (472 animals), because naming an organism you have never met is not
 *  hard, it is unfair. The candidate list changes that calculus: once the drill is narrow the
 *  names are on screen, so an unfamiliar animal is recognisable even when it is not
 *  recallable. 9000 nearly doubles the pool to 942 and pulls the median day well off the
 *  headline species, which was making boards easy on fame alone. */
export const MOSAIC_MIN_VIEWS = 9000;

/** …and where the floor goes back on the days that have no candidate list.
 *
 *  9000 is only defensible BECAUSE of the list: an Amami rabbit is recognisable among twelve
 *  names and unnameable from nothing. Saturday and Sunday take the narrowing away, so on those
 *  days the animal itself has to be recallable, and the floor returns to where it sat before the
 *  list existed. Unfair is not the same as hard, and the weekend was quietly being both. */
export const MOSAIC_MIN_VIEWS_NO_LIST = 20000;

/** The obscurity floor for a tier: it tracks the candidate list, not the difficulty band. What
 *  makes an unfamiliar animal fair is being able to RECOGNISE its name in a list, so the floor
 *  rises exactly where that list is gone. */
export function mosaicMinViews(tier: number): number {
  return mosaicAids(tier).subset ? MOSAIC_MIN_VIEWS : MOSAIC_MIN_VIEWS_NO_LIST;
}

export interface MosaicCell {
  characterId: string;
  /** The guess's own value for this character. */
  value: string;
  /** Whether it matches the answer. `null` when either side is n/a — a plant has no leg
   *  count, and scoring that as agreement or disagreement would both be lies. */
  match: boolean | null;
}

export interface MosaicGuess {
  node: TaxonNode;
  correct: boolean;
  cells: MosaicCell[];
  /** How far it landed, as a named rank. Shown on the two "named" days. */
  proximity: MosaicProximity;
  /** How far it landed, as Lineage's temperature 0…100. Shown on every other day. */
  degrees: number;
}

export interface MosaicBoard {
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
export function mosaicPool(
  tree: Tree,
  scopeRootId: string,
  minViews: number = MOSAIC_MIN_VIEWS
): string[] {
  return leavesUnder(tree, scopeRootId)
    .filter((id) => {
      const n = tree.byId.get(id);
      return n?.rank === "species" && n.common && (n.views ?? 0) >= minViews;
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

/** How much one recent appearance costs a group in the next draw, and how far back "recent"
 *  reaches. Measured over 40,000 boards, against no cooldown at all:
 *
 *      penalty  window   back-to-back   longest run   five in a row   birds
 *      none              20.0%          8             1 in 288        28.5%
 *      0.5      2        11.1%          5             1 in 6667       25.8%
 *      0.25     3         6.3%          3             none            22.8%
 *      0.1      4         3.6%          3             none            19.6%
 *      0 (ban)  2         0.0%          1             none            22.4%
 *
 *  0.25 over 3 is the pick. It ends the runs without flattening the pool into a rota: an
 *  outright ban means a player never once sees two mammals together, which reads as a rule
 *  rather than as chance. No group starves, because none is above 30% to begin with. */
export const MOSAIC_GROUP_PENALTY = 0.25;
export const MOSAIC_GROUP_WINDOW = 3;

/** One answer drawn at play time instead of from the date. THE BETA'S DRAW.
 *
 *  Mosaic is meant to become a daily like the other three, pinned and the same for everyone;
 *  mosaicAnswerFor below is that draw and is what it will ship on. Until then the beta samples,
 *  because a dated board needs its images built and staged ahead of time and a sampled one can
 *  just ask Wikipedia for whichever species it drew. Nothing here is a decision against the
 *  daily: when the pin arrives this becomes the "play another" button and the schedule takes
 *  over the opening board.
 *
 *  Weighted exactly like the dated draw (views^0.3), so the median board is the same kind of
 *  animal either way and the beta's difficulty carries over.
 *
 *  `exclude` keeps the draw off species that would give something away or bore: today's Kinship
 *  and Branches tiles, and anything already dealt this sitting. They are given zero weight
 *  rather than filtered out, so pool and weights stay index-aligned.
 *
 *  `cooldown` is what stops five birds in a row. Birds are 30% of the pool and mammals another
 *  25%, so an unaided draw repeats the previous board's group 20% of the time and runs of eight
 *  turn up inside 40,000 boards. See MOSAIC_GROUP_PENALTY. */
export function mosaicSampleAnswer(
  tree: Tree,
  opts: {
    scopeRootId?: string;
    minViews?: number;
    exclude?: ReadonlySet<string>;
    cooldown?: {
      /** A species to the group it counts as. Passed in rather than imported: the groups live
       *  in the data layer, which imports core, and core must not import back. */
      of: (speciesId: string) => string;
      /** Groups of the last few boards, in any order. */
      recent: readonly string[];
      penalty?: number;
    };
    /** Injectable for the tests; the game uses Math.random. */
    rand?: () => number;
  } = {}
): string | null {
  const scope = opts.scopeRootId ?? mosaicScopeId(tree);
  const pool = mosaicPool(tree, scope, opts.minViews);
  const cool = opts.cooldown;
  const penalty = cool?.penalty ?? MOSAIC_GROUP_PENALTY;
  const hits = new Map<string, number>();
  for (const g of cool?.recent ?? []) hits.set(g, (hits.get(g) ?? 0) + 1);
  let total = 0;
  let last = -1;
  const weights = pool.map((id, i) => {
    if (opts.exclude?.has(id)) return 0;
    let w = Math.pow(tree.byId.get(id)?.views ?? 1, 0.3);
    // Damped, not banned. A hard "never the same group twice" is itself a pattern a player can
    // read, and two mammals in a row is a fine thing to happen occasionally; it is the run of
    // five that is the complaint.
    if (cool) w *= Math.pow(penalty, hits.get(cool.of(id)) ?? 0);
    total += w;
    last = i;
    return w;
  });
  if (total <= 0) return null;
  const u = (opts.rand ?? Math.random)() * total;
  let acc = 0;
  for (let i = 0; i < pool.length; i++) {
    acc += weights[i];
    if (weights[i] > 0 && u < acc) return pool[i];
  }
  // Only reachable on floating-point drift past the last bucket. Fall back to the last species
  // that actually had weight, never to pool[length-1], which may be one of the excluded.
  return last >= 0 ? pool[last] : null;
}

/** No species may come round again within this many days. The pool is a few hundred animals
 *  and the draw is weighted hard toward the famous end, so without this the same headline
 *  species really does land twice in a week — a test caught the horse on two consecutive days. */
export const MOSAIC_ANTI_REPEAT_WINDOW = 45;
/** Fixed point the anti-repeat walk starts from, so every date resolves identically whichever
 *  one you ask for. Before it, days are drawn with no history. */
export const MOSAIC_ANCHOR = "2026-08-01";

const shiftDay = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** date -> answer, per (tree, scope). The walk is forward-only and each day is O(pool). */
const answerCache = new WeakMap<Tree, Map<string, Map<string, string>>>();

/** The day's answer, avoiding anything served in the previous MOSAIC_ANTI_REPEAT_WINDOW days.
 *
 *  This REGENERATES the history rather than reading what was really served, which is exactly
 *  the trap the other two games were fixed for. It is correct here only because Mosaic has never
 *  been served: there is no history to read yet. The moment it is pinned it needs the same
 *  treatment (see setServedGridHistory in ./grid). */
export function mosaicAnswerFor(
  tree: Tree,
  dateKey: string,
  scopeRootId?: string,
  /** Species that must not be drawn on a given date, because they are on that day's Kinship or
   *  Branches board. Supplied at PIN TIME, where the other two games are already pinned and
   *  their boards are readable; the client never needs it, because it reads the frozen answer.
   *
   *  It must be a pure function of the date or the walk stops being reproducible. Measured over
   *  60 days it never actually fires — Kinship deals mostly from the augment, and only 27% of
   *  its tiles are even in Mosaic's pool — so this is a guard against the rare day, not a
   *  reshaping of the schedule. */
  avoidOn?: (dateKey: string) => ReadonlySet<string>
): string | null {
  const scope = scopeRootId ?? mosaicScopeId(tree);
  const pool = mosaicPool(tree, scope);
  if (!pool.length) return null;
  // Flatter than a square root. sqrt still drew the same handful of headliners over and over,
  // which is a second way of making the game easy; this keeps a lean toward the known without
  // letting the top of the pool dominate.
  const weights = pool.map((id) => Math.pow(tree.byId.get(id)?.views ?? 1, 0.3));
  let total = 0;
  for (const w of weights) total += w;

  const seedOf = (d: string, attempt: number) =>
    attempt === 0 ? `grebe:mosaic:${d}:${scope}` : `grebe:mosaic:${d}:${scope}:${attempt}`;
  if (dateKey < MOSAIC_ANCHOR) return drawFrom(pool, weights, total, seedOf(dateKey, 0));

  // The memo is per (tree, scope) and holds picks made under ONE set of rules. An avoider
  // changes those rules, so it gets its own map rather than reading picks drawn without it.
  let byScope = answerCache.get(tree);
  if (!byScope) { byScope = new Map(); answerCache.set(tree, byScope); }
  const cacheKey = avoidOn ? `${scope}\u0000avoid` : scope;
  let days = byScope.get(cacheKey);
  if (!days) { days = new Map(); byScope.set(cacheKey, days); }

  const recent: string[] = [];
  for (let d = MOSAIC_ANCHOR; ; d = shiftDay(d, 1)) {
    let pick = days.get(d);
    if (pick === undefined) {
      // Re-roll until the draw is neither a recent answer nor on another game's board today.
      // Bounded: a pool of hundreds against a window of tens always has something left.
      const avoid = avoidOn?.(d);
      const rejected = (id: string) => recent.includes(id) || avoid?.has(id) === true;
      pick = drawFrom(pool, weights, total, seedOf(d, 0));
      for (let a = 1; a <= 24 && rejected(pick); a++) {
        pick = drawFrom(pool, weights, total, seedOf(d, a));
      }
      days.set(d, pick);
    }
    if (d === dateKey) return pick;
    recent.push(pick);
    if (recent.length > MOSAIC_ANTI_REPEAT_WINDOW) recent.shift();
  }
}

/** Score one guess against the answer. Both proximity readings are always computed; which one
 *  reaches the player is the day's business, not this function's. */
export function scoreMosaicGuess(
  tree: Tree,
  answerId: string,
  guessId: string,
  scopeRootId?: string
): MosaicGuess | null {
  const node = tree.byId.get(guessId);
  if (!node) return null;
  const scope = scopeRootId ?? mosaicScopeId(tree);
  const cells: MosaicCell[] = CHARACTERS.map((c) => {
    const mine = characterValue(tree, c, guessId);
    const theirs = characterValue(tree, c, answerId);
    return {
      characterId: c.id,
      value: mine,
      match: mine === NA || theirs === NA ? null : mine === theirs,
    };
  });
  return {
    node,
    correct: guessId === answerId,
    cells,
    proximity: mosaicProximity(tree, answerId, guessId),
    degrees: mosaicDegrees(tree, answerId, guessId, scope),
  };
}

/** Lineage's warmth, 0…100, for a guess against the answer.
 *
 *  Rescaled to the GAME'S scope (all animals) and never to the player's current subset. Doing
 *  it against the subset would make the number answer a question the player did not ask —
 *  "is the answer even in here" — every time they narrowed, which is a leak, and it would move
 *  every earlier row on the board each time they moved the filter. Against a fixed root the
 *  reading means one thing all day: 100 is the answer, 0 shares nothing but "an animal". */
export function mosaicDegrees(
  tree: Tree,
  answerId: string,
  guessId: string,
  scopeRootId?: string
): number {
  const scope = scopeRootId ?? mosaicScopeId(tree);
  const shared = mrca(tree, guessId, answerId);
  if (!shared) return 0;
  const answerPath = edgeDistance(tree, scope, answerId);
  if (answerPath === 0) return 100;
  return Math.max(0, Math.min(100, Math.round((edgeDistance(tree, scope, shared) / answerPath) * 100)));
}

/** The day's ladder: one rung per guess bar the last, since the final guess is made at the
 *  clearest rung rather than the reveal being wasted on a board nobody gets to answer.
 *
 *  Both hand-tuned ladders are geometric. Shuffle runs 20, 15, 11, 8, 6, 4, 3, which is a
 *  constant ratio of about 0.73; blur runs 11 up to 64 at about 1.34. So a longer day does not
 *  need repeated rungs, it needs more POINTS ON THE SAME CURVE, and the curve can simply be
 *  resampled between the endpoints the tuning settled on.
 *
 *  At the baseline length this returns the tuned array verbatim rather than a reconstruction of
 *  it. The formula reproduces those numbers exactly, but rounding is rounding, and the ladder
 *  the game shipped on should not depend on that staying true. */
export function mosaicLadder(
  mechanic: MosaicMechanic = MOSAIC_DEFAULT_MECHANIC,
  maxGuesses: number = MOSAIC_MAX_GUESSES
): number[] {
  const base = mechanic === "shuffle" ? MOSAIC_SHUFFLE_LADDER : MOSAIC_BLUR_LADDER;
  const from = base[0];
  const to = base[base.length - 1];
  const want = Math.max(2, Math.round(maxGuesses) - 1);
  if (want === base.length) return [...base];
  // A rung is an integer, so there are only |from - to| + 1 of them to be had. Past that a day
  // simply gets fewer rungs than guesses and spends the extra at the clearest, which is what the
  // ladder did everywhere before it could vary. Not reachable from the shipped tiers.
  const n = Math.min(want, Math.abs(from - to) + 1);
  const down = to < from;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = Math.round(from * Math.pow(to / from, i / (n - 1)));
    // Rounding can land two neighbours on the same integer, and a rung shown twice running is a
    // guess that changes nothing on screen. So each value is held strictly past the last, and
    // also held far enough from the end that the remaining rungs still have room to land exactly
    // on `to` — without that second bound, forcing distinctness early overshoots the endpoint.
    const room = down ? to + (n - 1 - i) : to - (n - 1 - i);
    const ceil = i === 0 ? from : down ? out[i - 1] - 1 : out[i - 1] + 1;
    out.push(down ? Math.min(Math.max(v, room), ceil) : Math.max(Math.min(v, room), ceil));
  }
  return out;
}

/** Which rung is on screen after `wrong` wrong guesses, clamped to the last one. The clamp is
 *  what puts the final guess at the clearest rung. */
export function mosaicRung(
  wrong: number,
  mechanic: MosaicMechanic = MOSAIC_DEFAULT_MECHANIC,
  maxGuesses: number = MOSAIC_MAX_GUESSES
): number {
  return Math.min(Math.max(wrong, 0), mosaicLadder(mechanic, maxGuesses).length - 1);
}

/** Where each tile of a shuffled rung takes its pixels from: cell `i` on screen shows cell
 *  `order[i]` of the photograph, both counted left to right and top to bottom.
 *
 *  Seeded rather than random, because the shuffle has to survive a re-render. React redraws the
 *  stage on every guess, every filter change and every window resize, and a fresh permutation
 *  each time would rescramble a picture the player was in the middle of reading — the one thing
 *  that must not happen between two guesses at the same rung.
 *
 *  Each rung is shuffled independently. Carrying the permutation down the ladder would make the
 *  reveal a slow unshuffle, which sounds kinder and plays worse: the tiles that happened to
 *  start near home would sit there being right for six guesses. */
export function mosaicTileOrder(seed: string, tilesPerSide: number): number[] {
  const order = Array.from({ length: tilesPerSide * tilesPerSide }, (_, i) => i);
  // mulberry32 off the same xmur3 the rest of the codebase seeds with.
  let s = xmur3(seed);
  const next = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** How far a guess landed from the answer, WITHOUT naming the shared group.
 *
 *  Deliberately coarse. Lineage's mechanic is the named most-recent common ancestor plus a
 *  temperature, and that IS its game; handing the same thing over would make this one a reskin.
 *  A rank alone says how far ("same order") without saying which order, so it confirms a
 *  direction the picture suggested rather than replacing the picture. Optional for exactly that
 *  reason: with it on, a player can tree-search and ignore the photograph, which is the failure
 *  mode to watch for. */
export type MosaicProximity =
  | "found it" | "same genus" | "same family" | "same order" | "same class" | "distant";

const PROXIMITY_BY_RANK: Record<string, MosaicProximity> = {
  subgenus: "same genus", "species group": "same genus", "species subgroup": "same genus", genus: "same genus",
  subtribe: "same family", tribe: "same family", subfamily: "same family", family: "same family",
  superfamily: "same order", infraorder: "same order", parvorder: "same order", suborder: "same order", order: "same order",
  infraclass: "same class", subclass: "same class", class: "same class",
  // Nothing broader gets a "same" label. superclass was mapped to "same class" and reported a
  // fennec fox and an AXOLOTL as classmates: their MRCA is unranked, the walk climbed to
  // Tetrapoda, and superclass read as class. Above class, the honest answer is "distant".
};

export function mosaicProximity(tree: Tree, answerId: string, guessId: string): MosaicProximity {
  // The answer itself, before anything is measured. Its MRCA with itself is the species, which
  // no rank rule matches, so the walk used to climb to the genus and report the winning guess as
  // merely being in the right one.
  if (guessId === answerId) return "found it";
  const m = mrca(tree, answerId, guessId);
  if (!m) return "distant";
  for (let c: string | null | undefined = m; c; c = tree.byId.get(c)?.parentId) {
    const n = tree.byId.get(c);
    const hit = PROXIMITY_BY_RANK[n?.sepRank ?? n?.rank ?? ""];
    if (hit) return hit;
  }
  return "distant";
}

/** Clades Mosaic must not name today, because another game's answer is one of them.
 *
 *  THE PROBLEM. Mosaic is played on the same tree as Kinship and Branches, and its two aids
 *  answer their questions exactly: the lookup is species -> its clades, which is Kinship's whole
 *  question, and the drill is clade -> its species, which is Branches'. Measured over real
 *  boards, 49% of Kinship's groups had their answer clade printed in the chain of every one of
 *  their members. Type the sixteen tiles, read off the four groups.
 *
 *  WHAT WAS TRIED FIRST, and why it was wrong. A size floor: refuse to name any clade holding
 *  fewer than ~20 candidates, on the theory that Kinship groups a family of four while Mosaic
 *  only scopes into branches worth searching. It measured well on the lookup and was incoherent
 *  underneath. It applied to the lookup and not the drill, so a group was hidden if you typed a
 *  member's name and reachable if you clicked down to it. And it hid clades by SIZE when the
 *  thing that matters is whether a clade is IN PLAY today, so it routinely hid the answer's own
 *  narrow clade — the single most useful scope on the board — while protecting nothing the drill
 *  did not hand over anyway.
 *
 *  WHAT THIS DOES INSTEAD. Hide the clades actually in play in today's other two boards, in both
 *  panels, and nothing else. A hidden clade is treated as UNNAMED, which is a behaviour the tree
 *  walk already has for junction nodes: the drill descends through it to the next named level, so
 *  its species stay reachable and only the name that would give a group away is withheld.
 *
 *  It is friction, not secrecy. taxonomy.json ships to the browser, so the whole tree is already
 *  on every player's machine; what this removes is the polished UI for reading it. */
export type HiddenClades = ReadonlySet<string>;

const NONE: HiddenClades = new Set<string>();

/** Every named clade between the root and a species, broad to narrow. This is what lets you
 *  look a species up and jump the filter straight to the level you meant — "show me where a
 *  fennec fox sits, then scope me to foxes".
 *
 *  `count` is INTERNAL: it decides which levels are worth keeping (a level earns its place by
 *  narrowing) and is not for display. Showing it here was the census leak in its most
 *  convenient form — name any species and read a count off every clade above it. See
 *  mosaicDrillOptions. */
export function mosaicLineagePath(
  tree: Tree,
  speciesId: string,
  pool: Set<string>,
  scopeRootId?: string,
  hidden: HiddenClades = NONE
): Array<{ id: string; label: string; count: number; rank: string }> {
  const scope = scopeRootId ?? mosaicScopeId(tree);
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
  const NARROWS = 0.75;      // must cut at least a quarter of what the next-kept level held
  const NARROWS_SCIENTIFIC = 0.5; // …or half, if the only name it has is a scientific one
  const MAX_STEPS = 6;       // counted from the SPECIES outward, so the narrow, useful end is
                             // never the part that gets cut. At 4 a fox lost "Mammals".

  // Walked from the SPECIES OUTWARD, not from the root inward. Going inward kept whichever of
  // two similar levels came first, and for a songbird that meant keeping "Reptiles 364" and
  // dropping "Birds 279" (279/364 = 0.77, just inside the gate) — technically true, useless as
  // a button, and faintly absurd. Outward keeps the SPECIFIC one and discards the broader
  // near-duplicate.
  // sepRank BEFORE rank, the same order mosaicProximity reads them in. The family names
  // injected into unnamed clades deliberately leave `rank` as "clade" and record the real one in
  // `sepRank`, so reading `rank` alone would report Corvidae and Nymphalidae as unranked.
  const rankOf = (n: TaxonNode) => n.sepRank ?? n.rank ?? "";
  const kept: Array<{ id: string; label: string; count: number; common: boolean; rank: string }> = [];
  let next = 0; // count of the last level kept, i.e. the one below this
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = tree.byId.get(chain[i]);
    if (!n || !(n.common || n.sciName)) continue;
    // In play in another game today: skip it exactly as an unnamed junction is skipped, so the
    // chain closes over it rather than showing a gap where a group used to be.
    if (hidden.has(chain[i])) continue;
    const count = countUnder(chain[i]);
    if (count < 1) continue;
    const gate = n.common ? NARROWS : NARROWS_SCIENTIFIC;
    if (next > 0 && next / count > gate) {
      // Too close to what we already have — but if THIS one has a common name and the one we
      // kept does not, take it instead. Walking outward reached Neognathae (275) one step
      // before Birds (279) and, both being near-duplicates, showed a songbird the clade nobody
      // has heard of rather than the one everybody has.
      const last = kept[kept.length - 1];
      if (n.common && last && !last.common) {
        kept[kept.length - 1] = { id: chain[i], label: n.common, count, common: true, rank: rankOf(n) };
        next = count;
      }
      continue;
    }
    kept.push({ id: chain[i], label: n.common ?? n.sciName, count, common: Boolean(n.common), rank: rankOf(n) });
    next = count;
    if (kept.length >= MAX_STEPS) break;
  }
  return kept.reverse().map(({ id, label, count, rank }) => ({ id, label, count, rank }));
}

/** Candidate answers under a clade, for the endgame list. Recall is the wrong ask when the
 *  answer is a kinkajou: nobody names an animal they have never heard of, however clear the
 *  photo gets. Once the drill is narrow enough, showing the candidates turns it into
 *  recognition — "which of these twelve is what I am looking at" — which is winnable, and
 *  teaches you the animal instead of just failing you. */
export function mosaicCandidates(tree: Tree, cladeId: string, pool: Set<string>): TaxonNode[] {
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
 *  The count ORDERS the rows and is no longer shown on them. It used to be, on the argument
 *  that watching "Animals 487 -> Mammals 180 -> Carnivorans 44 -> Cats 12" is what gives a
 *  drill its sense of progress. It does, but a per-clade count is also a published census of
 *  the species set, and a list ranked by it tells the player which branch of the taxonomy is
 *  fattest — a fact about this database, not about the animal. The progress is carried by
 *  `remaining` in the breadcrumb instead: one number, about the player's position, saying
 *  nothing about how the set is built.
 *
 *  "Directly below" means the SHALLOWEST NAMED descendants: the tree keeps unnamed junction
 *  nodes that a player cannot reason about, so the walk descends through them and stops at the
 *  first thing with a name. */
export function mosaicDrillOptions(
  tree: Tree,
  cladeId: string,
  pool: Set<string>,
  hidden: HiddenClades = NONE
): Array<{ id: string; label: string; count: number; rank: string }> {
  // Same sepRank-before-rank reading as mosaicLineagePath: an injected family name keeps
  // `rank: "clade"` and records the real rank in `sepRank`.
  const rankOf = (n: TaxonNode) => n.sepRank ?? n.rank ?? "";
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
    const out: Array<{ id: string; label: string; count: number; rank: string }> = [];
    // Returns how many POOL SPECIES this subtree's options account for, and it is the COUNT
    // that matters. Asking merely whether a subtree produced any option is what hid the fin
    // whale: Balaenopteridae holds two anonymous clades, one of them containing the fin whale
    // beside Megaptera, and Megaptera has a common name — so the branch looked handled and the
    // fin whale had no chip anywhere in the game. Balaenoptera, the genus that would have held
    // it, is not a node in this tree.
    //
    // WHOLENESS BEATS DEPTH. When a level's children cannot between them account for everything
    // beneath it, the partial answer is thrown away and the level itself is offered instead. A
    // family that splits cleanly gives its parts; one that does not gives itself, rather than a
    // list of the parts that happened to have names next to the strays that did not. That is
    // what makes Baleen whales read as four groups instead of two genera and three loose whales.
    const visit = (c: string): number => {
      const n = tree.byId.get(c);
      if (!n || n.rank === "species") return 0;
      const count = countUnder(c);
      if (count === 0) return 0;
      // A clade in play in another game today is treated as UNNAMED: descend through it to
      // whatever it holds. Its species stay reachable, only the name is withheld — so the name
      // fallbacks below are skipped for it, but the species one is NOT, or veiling a genus whose
      // children are all species would delete them from the panel.
      const veiled = hidden.has(c);
      if (n.common && !veiled) { out.push({ id: c, label: n.common, count, rank: rankOf(n) }); return count; }

      const mark = out.length;
      let covered = 0;
      for (const k of tree.childrenOf.get(c) ?? []) covered += visit(k);
      if (covered >= count) return covered;

      // The children left something out. Prefer this level whole, under its own scientific name.
      if (n.sciName && !veiled) {
        out.length = mark;
        out.push({ id: c, label: n.sciName, count, rank: rankOf(n) });
        return count;
      }
      // Nothing here can name itself, so report the partial coverage upward and let an ancestor
      // that CAN offer itself whole. Handing back the strays as loose species here would be the
      // wrong answer twice over: it hides the family that should have been offered, and it
      // reports full coverage so no ancestor ever gets the chance.
      return covered;
    };

    let covered = 0;
    for (const k of tree.childrenOf.get(id) ?? []) covered += visit(k);
    // LAST RESORT, and only here. If the whole subtree cannot name the branch a species sits on
    // — Panthera splits into an anonymous clade holding lion, leopard and jaguar, with the tiger
    // beside it, and neither side has a name — then the species are offered as themselves. A
    // species no chip accounts for is one the panel has quietly ruled out, which is how the fin
    // whale came to be unguessable by narrowing.
    if (covered < countUnder(id)) {
      const reached = new Set<string>();
      for (const o of out) {
        const stack = [o.id];
        while (stack.length) {
          const c = stack.pop()!;
          if (pool.has(c)) reached.add(c);
          for (const k of tree.childrenOf.get(c) ?? []) stack.push(k);
        }
      }
      const stack = [id];
      while (stack.length) {
        const c = stack.pop()!;
        const n = tree.byId.get(c);
        if (pool.has(c) && !reached.has(c)) {
          out.push({ id: c, label: n?.common ?? n?.sciName ?? c, count: 1, rank: "species" });
        }
        for (const k of tree.childrenOf.get(c) ?? []) stack.push(k);
      }
    }
    return out;
  };

  // COLLAPSE PASS-THROUGH LEVELS. Straight off the tree this produced
  // "Bilateria 469 -> Deuterostomia 399 -> Chordates 399 -> Craniata 399": four taps, no
  // narrowing, and three names no player reasons with. Whenever one child holds almost
  // everything, that level is not a choice — so descend through it and CARRY the small
  // siblings along, which is what keeps Cnidaria (3) reachable instead of stranding it
  // behind a branch nobody would ever tap.
  const DOMINANT = 0.9;
  const carried: Array<{ id: string; label: string; count: number; rank: string }> = [];
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
export function mosaicAnswerRow(tree: Tree, answerId: string): MosaicCell[] {
  return CHARACTERS.map((c) => ({
    characterId: c.id,
    value: characterValue(tree, c, answerId),
    match: true,
  }));
}
