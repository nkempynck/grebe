import type { TaxonNode, Tree } from "./types";

/** Spoiler control for the Wikipedia reader.
 *
 *  A clade's summary almost always names a few of its members ("Dynastinae or
 *  rhinoceros beetles … include Hercules beetles", "Aspidoscelis is a genus of
 *  whiptail lizards"), and in Branches those members are frequently the very
 *  species sitting in the tray. Peeking at a clade is free, so unedited prose can
 *  hand over a whole board.
 *
 *  Matching a name exactly is not enough: articles shorten and pluralise them
 *  ("Hercules beetles" for the Eastern Hercules Beetle), so the giveaway survives
 *  an exact search. Two mechanisms run instead:
 *
 *    1. Whole names — the common name, the binomial, the abbreviated binomial
 *       ("M. monoceros") — matched on word stems with the word breaks squashed out,
 *       so plurals and respellings count ("hover flies" for the Marmalade hoverfly),
 *       and hidden in one piece.
 *    2. Single words that identify one tray species, hidden on their own wherever
 *       they appear.
 *
 *  What makes a word identifying is judged AGAINST THE BOARD, not against the
 *  species list as a whole. A word only gives a placement away if exactly one
 *  species still to place carries it: on a tray of Western whiptail, Corn snake,
 *  Milk snake, Western hognose snake and Panther chameleon, "whiptail" and
 *  "chameleon" each single out a tile and are hidden, while "snake" is shared by
 *  three and stays. Dataset-wide rarity gets this wrong in both directions —
 *  "chameleon" appears in 6 names and "snake" in 20, yet here the rare-looking one
 *  is harmless and the common one decisive.
 *
 *  `tellingWords` is also what Branches uses to LABEL its clades: a clade whose
 *  common name carries one of these words is shown by its scientific name, since
 *  "Bottlenose Dolphin" over a tray holding the Common bottlenose dolphin hands
 *  the placement over before any article is opened. The two go together — the
 *  label stops showing the word, so the prose can hide it. */

/** Fold a word to a form shared by its singular and plural, so "beetles" matches
 *  "beetle". Deliberately crude: regular -s/-es/-ies only, no irregulars.
 *
 *  -ed goes too, because these names are full of participles the articles write as
 *  bare nouns: "Asian long-horned beetle" against "longhorn beetles", "banded" against
 *  "bands". The doubled consonant a stripped -ed leaves behind goes with it, or
 *  "spotted" would fold to "spott" and miss "spots". */
function suffixes(word: string): string {
  let s = word.toLowerCase();
  if (s.length > 4 && s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.length > 3 && s.endsWith("s")) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith("ed")) {
    s = s.slice(0, -2);
    if (s.length > 3 && /([^aeiou])\1$/.test(s)) s = s.slice(0, -1);
  }
  return s;
}

/** The trailing -e left by "foxes" → "foxe", dropped at the END of a name only.
 *  Doing it per word would break the compounds below: "house flies" folds to
 *  "hous" + "fly", which no longer spells the Housefly. */
const dropE = (s: string) => (s.length > 3 && s.endsWith("e") ? s.slice(0, -1) : s);

/** A lone word folded all the way — what the board's telling words are keyed by. */
export function stem(word: string): string {
  return dropE(suffixes(word));
}

const WORD = /[\p{L}\p{N}]+/gu;

/** The stems of a name, in order, duplicates kept. */
export function nameStems(name: string | undefined): string[] {
  return (name?.match(WORD) ?? []).map(stem);
}

/** A name folded to one key: its words run together, word breaks dropped.
 *
 *  Whether a name is written as one word, two words or hyphenated is not settled
 *  English, and articles disagree with the species list constantly: "hover flies" for
 *  the Marmalade hoverfly, "longhorn beetles" for the Asian long-horned beetle. Both
 *  slipped past a word-by-word comparison, which saw one token against two. Squashed,
 *  each side lands on the same key ("hoverfly", "longhornbeetl") and the match holds.
 *  Word breaks survive at the ends of a match, so this never matches inside a word:
 *  "lionfish" is one token and does not spell "lion". */
export function squash(name: string | undefined): string {
  return joinWords((name?.match(WORD) ?? []).map(suffixes));
}

/** Squash already-suffixed words into one key. */
const joinWords = (words: string[]) => dropE(words.join(""));

export interface Spoiler {
  /** Whole names, as squashed keys, hidden in one piece wherever they appear. */
  phrases: string[];
  /** Words that single this species out on the board, hidden on their own. */
  telling: Set<string>;
}

/** How many of `species` carry each word of their common names. */
function stemCounts(species: TaxonNode[]): Map<string, number> {
  const shared = new Map<string, number>();
  for (const n of species) {
    for (const s of new Set(nameStems(n.common))) shared.set(s, (shared.get(s) ?? 0) + 1);
  }
  return shared;
}

/** Every word that singles out one species on the board. A one-letter token is the
 *  "s" left by a possessive ("Cuvier's beaked whale"), never a name: treating it as
 *  telling would blank the "s" out of an unrelated "Baird's". It still counts
 *  inside a whole-name phrase.
 *
 *  `spare` exempts words that read as ordinary English in running prose, so the
 *  Tursiops article can say "They are common, cosmopolitan members" without a
 *  block over "common" just because the Common bottlenose dolphin is in the tray.
 *  Pass `widespreadWords(tree)` for it. Labels don't spare anything: a clade
 *  label sits right next to the tray, where even a filler word is decisive. */
export function tellingWords(species: Array<TaxonNode | undefined>, spare?: Set<string>): Set<string> {
  const live = species.filter((n): n is TaxonNode => !!n);
  const counts = stemCounts(live);
  const out = new Set<string>();
  for (const [s, n] of counts) if (n === 1 && s.length > 1 && !spare?.has(s)) out.add(s);
  const singles = new Set(out);
  for (const n of live) for (const p of tellingPairs(n.common, singles)) out.add(p);
  return out;
}

/** The compound spellings of a name: two adjacent words run together, kept only when
 *  BOTH are themselves telling. "Long-horned" gives "longhorn", so a bare "longhorns"
 *  in prose — and a genus labelled "Milkweed Longhorns" — counts as the word it is.
 *
 *  Both, not either, is the whole rule. Pairing a telling word with a shared one would
 *  swallow the shared one: "Hercules beetles" would go in one block over a tray where
 *  three tiles are beetles, hiding a word that settles nothing. */
function tellingPairs(name: string | undefined, telling: Set<string>): string[] {
  const words = (name?.match(WORD) ?? []).map(suffixes);
  const out: string[] = [];
  for (let i = 0; i + 1 < words.length; i++) {
    if (telling.has(dropE(words[i])) && telling.has(dropE(words[i + 1]))) out.push(joinWords(words.slice(i, i + 2)));
  }
  return out;
}

/** Words appearing in at least `limit` of the tree's organism names.
 *
 *  Set high on purpose. Only a handful of words clear it ("common" is in 146 names,
 *  "black" 88, "red" 81) and those are the ones an article is likely to use as
 *  plain English. Dropping it far enough to also spare, say, "river" (14 names)
 *  would start sparing group nouns — "moth" is in 54, "beetle" 56, "spider" 66 —
 *  and a lone group noun IS the giveaway when only one tray species is one of
 *  those. Measured over three weeks of boards, this threshold removes noise blocks
 *  without letting a single identifying word back into visible prose. */
export const WIDESPREAD_LIMIT = 80;

const widespreadCache = new WeakMap<Tree, Set<string>>();

export function widespreadWords(tree: Tree, limit = WIDESPREAD_LIMIT): Set<string> {
  const hit = limit === WIDESPREAD_LIMIT ? widespreadCache.get(tree) : undefined;
  if (hit) return hit;
  const freq = new Map<string, number>();
  for (const n of tree.byId.values()) {
    for (const s of new Set(nameStems(n.common))) freq.set(s, (freq.get(s) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [s, n] of freq) if (n >= limit) out.add(s);
  if (limit === WIDESPREAD_LIMIT) widespreadCache.set(tree, out);
  return out;
}

/** True when a name carries a word that singles out a species on the board — the
 *  test Branches applies to a clade's common label before showing it. */
export function namesTell(name: string | undefined, telling: Set<string>): boolean {
  return nameStems(name).some((s) => telling.has(s));
}

/** What to hide for a whole board: one spoiler per species still to place. `spare`
 *  is passed through to `tellingWords`. */
export function boardSpoilers(species: Array<TaxonNode | undefined>, spare?: Set<string>): Spoiler[] {
  const live = species.filter((n): n is TaxonNode => !!n);
  const shared = stemCounts(live);
  const telling = tellingWords(live, spare);
  const singles = (s: string) => telling.has(s);
  return live.map((node) => {
    const phrases: string[] = [];
    const addPhrase = (name: string | undefined) => {
      const run = nameStems(name);
      // A one-word name is hidden only when that word singles the species out.
      // Two tray tiles sharing it (Cat and Wild cat) make every "cats" in an
      // article a match, which would black out the page and settle nothing.
      if (run.length > 1 || (run.length === 1 && !shared.has(run[0])) || (run.length === 1 && singles(run[0]))) {
        phrases.push(squash(name));
      }
    };
    addPhrase(node.common);
    addPhrase(node.sciName);
    const [genus, epithet] = (node.sciName ?? "").trim().split(/\s+/);
    // The abbreviated binomial articles switch to after first mention. The bare
    // genus is deliberately never hidden: it is often the clade's own name.
    if (genus && epithet) addPhrase(`${genus[0]}. ${epithet}`);
    const stems = nameStems(node.common);
    return { phrases, telling: new Set([...stems.filter(singles), ...tellingPairs(node.common, telling)]) };
  });
}

export interface RedactSegment {
  text: string;
  /** True when this segment is a hidden name (render a block, not the text). */
  hidden: boolean;
}

/** `word` carries the suffix rules but not the final -e, which only `joinWords`
 *  applies, once a run has been squashed. */
interface Tok { word: string; start: number; end: number }

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(WORD)) out.push({ word: suffixes(m[0]), start: m.index, end: m.index + m[0].length });
  return out;
}

/** Character ranges whose words, squashed together, spell one of `keys`.
 *
 *  A run grows only while barely anything separates its words — a space, a hyphen, or
 *  the ". " of "P. leo". Anything wider is not one name. Every run both starts and ends
 *  on a word boundary, so a key is never found inside a longer word. */
function keyRanges(toks: Tok[], keys: Set<string>): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (keys.size === 0) return out;
  let cap = 0;
  for (const k of keys) cap = Math.max(cap, k.length);
  for (let i = 0; i < toks.length; i++) {
    let acc = "";
    for (let j = i; j < toks.length; j++) {
      if (j > i && toks[j].start - toks[j - 1].end > 3) break;
      acc += toks[j].word;
      if (acc.length > cap + 1) break; // + the -e joinWords may still drop
      if (keys.has(joinWords([acc]))) out.push([toks[i].start, toks[j].end]);
    }
  }
  return out;
}

/** Character ranges of `text` that give away one of `spoilers`. */
function spoilerRanges(text: string, spoilers: Spoiler[], toks: Tok[]): Array<[number, number]> {
  const ranges = keyRanges(toks, new Set(spoilers.flatMap((sp) => sp.phrases)));
  // Telling words on their own, from any species. Neighbouring ones merge into a
  // single block so "Colorado potato" doesn't read as two.
  const hits = keyRanges(toks, new Set(spoilers.flatMap((sp) => [...sp.telling])));
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let run: [number, number] | null = null;
  for (const [start, end] of hits) {
    if (run && (start <= run[1] || /^[\s-]*$/.test(text.slice(run[1], start)))) {
      run[1] = Math.max(run[1], end);
      continue;
    }
    if (run) ranges.push(run);
    run = [start, end];
  }
  if (run) ranges.push(run);
  return ranges;
}

/** Split `text` into visible and hidden segments. The hidden text is returned so
 *  callers can measure it, but the card renders a fixed-width block instead — the
 *  name never reaches the DOM. */
export function redactSpoilers(text: string, spoilers: Spoiler[]): RedactSegment[] {
  if (!text) return [];
  if (spoilers.length === 0) return [{ text, hidden: false }];
  // Longest range first at a given start, so a whole name wins over a telling word
  // inside it; ranges already covered are then skipped.
  const ranges = spoilerRanges(text, spoilers, tokens(text)).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: RedactSegment[] = [];
  let last = 0;
  for (const [start, end] of ranges) {
    if (end <= last) continue;
    if (start > last) out.push({ text: text.slice(last, start), hidden: false });
    out.push({ text: text.slice(Math.max(start, last), end), hidden: true });
    last = end;
  }
  if (last < text.length) out.push({ text: text.slice(last), hidden: false });
  return out;
}

/** True when redaction left nothing worth reading (no letters or digits survive
 *  outside the blocks), so the card can show a plain notice instead. */
export function isFullyRedacted(segments: RedactSegment[]): boolean {
  return segments.some((s) => s.hidden) && !segments.some((s) => !s.hidden && /[\p{L}\p{N}]/u.test(s.text));
}
