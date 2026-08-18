// PROTOTYPE state for Blur. Deliberately thin: no persistence, no stats, no leaderboard, no
// pinned puzzle. Those all matter and none of them tell us whether the game is fun, which is
// the only question this prototype exists to answer.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Tree } from "../core";
import { isAncestor } from "../core";
import { CLADE_GROUPS } from "../data/clades";
import { todayKey } from "../core/daily";
import {
  blurAnswerFor, scoreBlurGuess, blurRung, blurPool, blurScopeId, blurDrillOptions,
  BLUR_LADDER, BLUR_MAX_GUESSES, type BlurGuess,
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
  /** Drill-down path from the game's root, deepest last. The guess bar is restricted to the
   *  deepest entry; the whole path is the breadcrumb. */
  path: Array<{ id: string; label: string; count: number }>;
  /** Named clades one level below the current position, with candidate counts. */
  options: Array<{ id: string; label: string; count: number }>;
  /** Candidate answers still inside the current filter. */
  remaining: number;
  drillInto: (id: string) => void;
  /** Back out to `depth` entries of the path (0 = all animals). */
  drillTo: (depth: number) => void;
  focusCladeId: string | null;
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
  const [pathIds, setPathIds] = useState<string[]>([]);
  const [credit, setCredit] = useState<BlurCredit | null>(null);

  // A new day is a new game.
  useEffect(() => { setGuesses([]); setGaveUp(false); setPathIds([]); setMissing(false); }, [date]);

  const answerId = useMemo(() => (tree ? blurAnswerFor(tree, date) : null), [tree, date]);

  // The candidate pool, and the drill-down derived from it. Counting ANSWERS rather than
  // guessable species is what makes the number mean "how many things could this be".
  const rootId = useMemo(() => (tree ? blurScopeId(tree) : null), [tree]);
  const pool = useMemo(
    () => (tree && rootId ? new Set(blurPool(tree, rootId)) : new Set<string>()),
    [tree, rootId]
  );
  const path = useMemo(() => {
    if (!tree) return [];
    return pathIds.map((id) => {
      const n = tree.byId.get(id);
      let count = 0;
      const stack = [id];
      while (stack.length) {
        const c = stack.pop()!;
        if (pool.has(c)) count++;
        for (const k of tree.childrenOf.get(c) ?? []) stack.push(k);
      }
      return { id, label: n?.common ?? n?.sciName ?? id, count };
    });
  }, [tree, pathIds, pool]);
  const hereId = pathIds.length ? pathIds[pathIds.length - 1] : rootId;
  const options = useMemo(() => {
    if (!tree || !hereId) return [];
    const raw = blurDrillOptions(tree, hereId, pool);
    if (pathIds.length) return raw;
    // FIRST STEP ONLY: the curated player-facing groups the rest of the app already uses.
    // Straight off the tree the opening move was "Chordates -> Lobe-finned fishes -> Mammal",
    // three taps through names nobody thinks in to reach the one they wanted. Below this the
    // tree's own names are fine (Rodents, Cetaceans, Weasel family, Bears).
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
    const curated = CLADE_GROUPS
      .map((g) => ({ id: g.id, label: g.label, count: countUnder(g.id) }))
      .filter((o) => o.count > 0);
    // Anything the curated list does not cover (cephalopods, jellyfish) still needs a way in.
    const rest = raw.filter((o) => !curated.some((c) => c.id === o.id || isAncestor(tree, c.id, o.id)));
    return [...curated, ...rest].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [tree, hereId, pool, pathIds.length]);
  const remaining = path.length ? path[path.length - 1].count : pool.size;

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
    path,
    options,
    remaining,
    drillInto: (id: string) => setPathIds((p) => [...p, id]),
    drillTo: (depth: number) => setPathIds((p) => p.slice(0, depth)),
    focusCladeId: pathIds.length ? pathIds[pathIds.length - 1] : null,
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
