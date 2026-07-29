import type { TaxonNode } from "./types";

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
 *       ("M. monoceros") — matched on word stems, so plurals count, and hidden in
 *       one piece.
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
 *  is harmless and the common one decisive. */

/** Fold a word to a form shared by its singular and plural, so "beetles" matches
 *  "beetle". Deliberately crude: regular -s/-es/-ies only, no irregulars. */
export function stem(word: string): string {
  let s = word.toLowerCase();
  if (s.length > 4 && s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.length > 3 && s.endsWith("s")) s = s.slice(0, -1);
  if (s.length > 3 && s.endsWith("e")) s = s.slice(0, -1);
  return s;
}

const WORD = /[\p{L}\p{N}]+/gu;

/** The stems of a name, in order, duplicates kept. */
export function nameStems(name: string | undefined): string[] {
  return (name?.match(WORD) ?? []).map(stem);
}

export interface Spoiler {
  /** Whole names, as stem runs, hidden in one piece wherever they appear. */
  phrases: string[][];
  /** Words that single this species out on the board, hidden on their own. */
  telling: Set<string>;
}

/** What to hide for a whole board: one spoiler per species still to place.
 *
 *  `context` holds the stems of the open article's OWN subject. A word the card
 *  already shows in its title can't be a giveaway, so hiding it would only shred
 *  the prose — a Chamaeleonidae page has to keep saying "chameleon". */
export function boardSpoilers(
  species: Array<TaxonNode | undefined>,
  opts?: { context?: Iterable<string> }
): Spoiler[] {
  const live = species.filter((n): n is TaxonNode => !!n);
  const shared = new Map<string, number>();
  for (const n of live) {
    for (const s of new Set(nameStems(n.common))) shared.set(s, (shared.get(s) ?? 0) + 1);
  }
  const context = new Set(opts?.context ?? []);
  // A one-letter token is the "s" left by a possessive ("Cuvier's beaked whale"),
  // never a name: treating it as telling blanks the "s" out of an unrelated
  // "Baird's". It still counts inside a whole-name phrase.
  const singles = (s: string) => s.length > 1 && shared.get(s) === 1 && !context.has(s);
  return live.map((node) => {
    const phrases: string[][] = [];
    const addPhrase = (name: string | undefined) => {
      const run = nameStems(name);
      // A one-word name is hidden only when that word singles the species out.
      // Two tray tiles sharing it (Cat and Wild cat) make every "cats" in an
      // article a match, which would black out the page and settle nothing.
      if (run.length > 1 || (run.length === 1 && !shared.has(run[0])) || (run.length === 1 && singles(run[0]))) {
        phrases.push(run);
      }
    };
    addPhrase(node.common);
    addPhrase(node.sciName);
    const [genus, epithet] = (node.sciName ?? "").trim().split(/\s+/);
    // The abbreviated binomial articles switch to after first mention. The bare
    // genus is deliberately never hidden: it is often the clade's own name.
    if (genus && epithet) addPhrase(`${genus[0]}. ${epithet}`);
    return { phrases, telling: new Set(nameStems(node.common).filter(singles)) };
  });
}

export interface RedactSegment {
  text: string;
  /** True when this segment is a hidden name (render a block, not the text). */
  hidden: boolean;
}

interface Tok { stem: string; start: number; end: number }

function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(WORD)) out.push({ stem: stem(m[0]), start: m.index, end: m.index + m[0].length });
  return out;
}

/** Character ranges of `text` that give away one of `spoilers`. */
function spoilerRanges(text: string, spoilers: Spoiler[], toks: Tok[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const sp of spoilers) {
    for (const phrase of sp.phrases) {
      for (let i = 0; i + phrase.length <= toks.length; i++) {
        let ok = true;
        for (let k = 0; k < phrase.length && ok; k++) {
          // Words of one name sit next to each other; more than a space, a hyphen
          // or "P. " between them means this is not that name.
          ok = toks[i + k].stem === phrase[k] && (k === 0 || toks[i + k].start - toks[i + k - 1].end <= 3);
        }
        if (ok) ranges.push([toks[i].start, toks[i + phrase.length - 1].end]);
      }
    }
  }
  // Telling words on their own, from any species. Neighbouring ones merge into a
  // single block so "Colorado potato" doesn't read as two.
  const telling = new Set(spoilers.flatMap((sp) => [...sp.telling]));
  for (let i = 0; i < toks.length; i++) {
    if (!telling.has(toks[i].stem)) continue;
    let end = i;
    while (end + 1 < toks.length && telling.has(toks[end + 1].stem) && /^[\s-]*$/.test(text.slice(toks[end].end, toks[end + 1].start))) end++;
    ranges.push([toks[i].start, toks[end].end]);
    i = end;
  }
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
