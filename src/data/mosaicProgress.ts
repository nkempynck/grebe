// Mosaic's in-progress board, kept across reloads.
//
// The other two progress modules (gridProgress, dailyProgress) both open by saying they store
// progress AGAINST the board and never the board itself, because the board is a pure function of
// the date. Mosaic breaks exactly that assumption: a sampled animal cannot be re-derived from
// anything, so the answer and its picture have to be in here too.
//
// The point is not convenience. Without this a reload deals a new animal, which is an unlimited
// reroll: dislike your board, refresh. That is the same hole that was deliberately closed on the
// difficulty switch, and it stays open until the board survives a page load.
//
// There is no expiry. A daily has a rollover that justifies discarding an attempt; this has
// none, and a half-guessed animal is still your game a week later. "Play another" is the way out.
import type { WikiCredit } from "./wikipedia";

export interface MosaicProgress {
  /** Bumped when the shape changes, so an old blob is discarded rather than misread. */
  v: number;
  answerId: string;
  shot: { src: string; full: string; credit: WikiCredit | null };
  /** Guesses as IDS ONLY, re-scored from the tree on load. Keeps the blob small, and means a
   *  later change to the character table or the geography data re-derives these rows rather than
   *  resurrecting cells that no longer match what the game would say today. */
  guessIds: string[];
  gaveUp: boolean;
  /** Where the narrowing was left. */
  pathIds: string[];
  /** The tier this board was dealt at. A board cannot survive a difficulty change: the obscurity
   *  floor moves with the tier, so the answer pool genuinely differs. */
  tier: number;
  /** Anti-repeat, carried across reloads so "this sitting" means this browser rather than this
   *  page load. */
  seen: string[];
  recentGroups: string[];
}

export const MOSAIC_PROGRESS_V = 1;
const KEY = "grebe.mosaic.progress";

/** How many recently dealt animals to remember. Its whole job is not handing back the one you
 *  just played, so a rolling window is enough and keeps the blob bounded. */
export const SEEN_MEMORY = 50;

const strings = (v: unknown, cap = Infinity): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x).slice(-cap) : [];

/** Shape-check a blob from storage. Returns null for anything unrecognisable rather than a
 *  half-filled object: this is whatever an older build wrote, and a board missing its answer or
 *  its picture is not a board. */
export function sanitiseProgress(raw: unknown): MosaicProgress | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<MosaicProgress>;
  if (p.v !== MOSAIC_PROGRESS_V) return null;
  if (typeof p.answerId !== "string" || !p.answerId) return null;
  const shot = p.shot;
  if (!shot || typeof shot.src !== "string" || !shot.src) return null;
  if (typeof p.tier !== "number" || !Number.isFinite(p.tier)) return null;
  return {
    v: MOSAIC_PROGRESS_V,
    answerId: p.answerId,
    shot: {
      src: shot.src,
      full: typeof shot.full === "string" && shot.full ? shot.full : shot.src,
      credit: shot.credit ?? null,
    },
    guessIds: strings(p.guessIds),
    gaveUp: p.gaveUp === true,
    pathIds: strings(p.pathIds),
    tier: Math.round(p.tier),
    seen: strings(p.seen, SEEN_MEMORY),
    recentGroups: strings(p.recentGroups),
  };
}

/** Whether a stored board can still be played, and the cleaned version of it if so.
 *
 *  Separate from the shape check because these are questions about the WORLD rather than about
 *  the blob: the tree may have been rebuilt under it, the pool may have moved, the player may
 *  have changed difficulty. Anything unusable becomes a fresh deal, never an error. */
export function usableProgress(
  p: MosaicProgress | null,
  opts: {
    tier: number;
    /** Is this species still something the current tier could have dealt? */
    canBeAnswer: (id: string) => boolean;
    /** Does the tree still know this id? */
    knows: (id: string) => boolean;
  }
): MosaicProgress | null {
  if (!p) return null;
  // A difficulty change deals a new animal, so a board from another tier is not resumable.
  if (p.tier !== opts.tier) return null;
  // A taxonomy rebuild can drop a species, and the obscurity floor can move under it.
  if (!opts.canBeAnswer(p.answerId)) return null;
  return {
    ...p,
    // Drop guesses the tree no longer knows rather than discarding the whole board: losing a row
    // off the table is a far smaller loss than losing the game you were in the middle of.
    guessIds: p.guessIds.filter(opts.knows),
    pathIds: p.pathIds.filter(opts.knows),
  };
}

export function loadMosaicProgress(): MosaicProgress | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitiseProgress(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveMosaicProgress(p: MosaicProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, seen: p.seen.slice(-SEEN_MEMORY) }));
  } catch {
    /* private mode, or the quota is full — the board just will not survive a reload */
  }
}

export function clearMosaicProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
