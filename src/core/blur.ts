// BLUR — the fourth daily. Identify a species from a photograph that starts at a handful of
// pixels and gains resolution with every wrong guess, with a Mastermind-style character table
// beside it showing which traits your guess shares with the answer.
//
// Pure: tree in, board out. No React, no data layer, no image fetching — the ladder images are
// built at pin time by scripts/blur-images.mjs and addressed by rung index.
import type { TaxonNode, Tree } from "./types";
import { leavesUnder } from "./tree";
import { CHARACTERS, characterValue, NA } from "./blurChars";

/** Rung widths in pixels. A SUBSET of the research continuum in scripts/blur-images.mjs, which
 *  runs 3px to 106px in thirteen steps; the sheet built from it showed the game lives between
 *  3 and roughly 26 for a recognisable species, and that a first attempt starting at 10px with
 *  a ratio of 1.5 solved a flamingo before the first guess.
 *
 *  Full resolution is deliberately NOT a rung. It is the reward for finishing, so the last
 *  thing you play against is still a puzzle rather than a photograph. */
export const BLUR_LADDER = [3, 5, 8, 12, 18, 26, 38] as const;

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

/** Below this many Wikipedia pageviews a species is not a fair answer: the picture is the whole
 *  puzzle, so an organism most players could not name with the photo in front of them is not
 *  hard, just unfair. Deliberately far above Kinship's floor (2000), which only has to make a
 *  GROUP nameable once solved. */
export const BLUR_MIN_VIEWS = 20000;

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
  const weights = pool.map((id) => Math.sqrt(tree.byId.get(id)?.views ?? 1));
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
  return { node, correct: guessId === answerId, cells };
}

/** Which rung is on screen after `wrong` wrong guesses, clamped to the last one. */
export function blurRung(wrong: number): number {
  return Math.min(Math.max(wrong, 0), BLUR_LADDER.length - 1);
}

/** The answer's own row, for the solved/failed state. */
export function blurAnswerRow(tree: Tree, answerId: string): BlurCell[] {
  return CHARACTERS.map((c) => ({
    characterId: c.id,
    value: characterValue(tree, c, answerId),
    match: true,
  }));
}
