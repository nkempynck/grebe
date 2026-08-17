// PROTOTYPE state for Blur. Deliberately thin: no persistence, no stats, no leaderboard, no
// pinned puzzle. Those all matter and none of them tell us whether the game is fun, which is
// the only question this prototype exists to answer.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Tree } from "../core";
import { todayKey } from "../core/daily";
import {
  blurAnswerFor, scoreBlurGuess, blurRung, BLUR_LADDER, BLUR_MAX_GUESSES,
  type BlurGuess,
} from "../core/blur";

export type BlurStatus = "playing" | "won" | "lost";

export interface BlurCredit {
  artist: string | null;
  licence: string | null;
  filePage: string | null;
}

export interface UseBlurGame {
  date: string;
  answerId: string | null;
  guesses: BlurGuess[];
  status: BlurStatus;
  /** Rung currently on screen; the reveal shows the full photo instead. */
  rung: number;
  rungWidth: number;
  guessesLeft: number;
  imageUrl: string;
  credit: BlurCredit | null;
  /** Clade the guess bar is restricted to — the player's own deduction, recorded. */
  focusCladeId: string | null;
  setFocusCladeId: (id: string | null) => void;
  guess: (id: string) => void;
  giveUp: () => void;
  /** PROTOTYPE affordances: jump to another locally staged day. */
  staged: string[];
  sample: () => void;
  /** True when this date has no staged image — a prototype condition, not a game state. */
  missing: boolean;
  onImageError: () => void;
}

export function useBlurGame(tree: Tree | null, dateOverride?: string): UseBlurGame {
  // PROTOTYPE: images are staged per date under public/blur, and today is often not one of
  // them (staging a week from tomorrow left today with no picture at all, which showed up as a
  // broken-image icon rather than anything a playtester could act on). The sampler walks the
  // dates that actually exist locally.
  const [staged, setStaged] = useState<string[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/blur/index.json")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((d: string[]) => { if (live) setStaged(Array.isArray(d) ? d : []); });
    return () => { live = false; };
  }, []);
  const today = todayKey();
  const date = dateOverride ?? pick ?? (staged.includes(today) ? today : staged[0] ?? today);
  const [missing, setMissing] = useState(false);
  const [guesses, setGuesses] = useState<BlurGuess[]>([]);
  const [gaveUp, setGaveUp] = useState(false);
  const [focusCladeId, setFocusCladeId] = useState<string | null>(null);
  const [credit, setCredit] = useState<BlurCredit | null>(null);

  // A new day is a new game.
  useEffect(() => { setGuesses([]); setGaveUp(false); setFocusCladeId(null); setMissing(false); }, [date]);

  const answerId = useMemo(() => (tree ? blurAnswerFor(tree, date) : null), [tree, date]);

  const won = guesses.some((g) => g.correct);
  const status: BlurStatus = won ? "won" : gaveUp || guesses.length >= BLUR_MAX_GUESSES ? "lost" : "playing";
  const wrong = guesses.filter((g) => !g.correct).length;
  const rung = blurRung(wrong);
  const solved = status !== "playing";

  useEffect(() => {
    if (!solved) { setCredit(null); return; }
    let live = true;
    fetch(`/blur/${date}/credit.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((c) => { if (live) setCredit(c); });
    return () => { live = false; };
  }, [solved, date]);

  const guess = useCallback((id: string) => {
    if (!tree || !answerId || status !== "playing") return;
    setGuesses((prev) => {
      if (prev.some((g) => g.node.id === id)) return prev; // already tried
      const scored = scoreBlurGuess(tree, answerId, id);
      return scored ? [...prev, scored] : prev;
    });
  }, [tree, answerId, status]);

  return {
    date,
    answerId,
    guesses,
    status,
    rung,
    rungWidth: BLUR_LADDER[rung],
    guessesLeft: Math.max(0, BLUR_MAX_GUESSES - guesses.length),
    // On solve the full photo replaces the ladder; until then only the rung earned is fetched,
    // so the clearer images are never even in the browser cache.
    imageUrl: solved ? `/blur/${date}/full.jpg` : `/blur/${date}/${rung}.jpg`,
    credit,
    focusCladeId,
    setFocusCladeId,
    guess,
    giveUp: () => setGaveUp(true),
    staged,
    sample: () => {
      if (!staged.length) return;
      const i = staged.indexOf(date);
      setPick(staged[(i + 1 + staged.length) % staged.length]);
    },
    missing,
    onImageError: () => setMissing(true),
  };
}
