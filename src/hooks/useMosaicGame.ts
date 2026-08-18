// PROTOTYPE state for Mosaic. Deliberately thin: no persistence, no stats, no leaderboard, no
// pinned puzzle. Those all matter and none of them tell us whether the game is fun, which is
// the only question this prototype exists to answer.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Tree } from "../core";
import { isAncestor } from "../core";
import { CLADE_GROUPS } from "../data/clades";
import { todayKey } from "../core/daily";
import {
  mosaicAnswerFor, scoreMosaicGuess, mosaicRung, mosaicPool, mosaicScopeId, mosaicDrillOptions,
  mosaicCandidates, mosaicLineagePath, MOSAIC_BLUR_LADDER, MOSAIC_SHUFFLE_LADDER, MOSAIC_MAX_GUESSES,
  type MosaicGuess, type MosaicMechanic,
} from "../core/mosaic";
import type { TaxonNode } from "../core";

export type MosaicStatus = "playing" | "won" | "lost";

export interface MosaicCredit {
  artist: string | null;
  licence: string | null;
  filePage: string | null;
}

export interface UseMosaicGame {
  date: string;
  answerId: string | null;
  guesses: MosaicGuess[];
  status: MosaicStatus;
  /** Rung currently on screen; the reveal shows the full photo instead. */
  rung: number;
  /** How this rung is described: "11px" or "64 tiles". */
  rungLabel: string;
  mechanic: MosaicMechanic;
  setMechanic: (m: MosaicMechanic) => void;
  /** SETUP: look at any rung without spending guesses. null = follow the game. */
  rungOverride: number | null;
  setRungOverride: (r: number | null) => void;
  rungCount: number;
  /** Candidate answers inside the current filter, once it is narrow enough to list. */
  candidates: TaxonNode[];
  /** SETTING: show how far each guess landed. Off by default — see mosaicProximity. */
  showProximity: boolean;
  setShowProximity: (v: boolean) => void;
  /** Jump the filter straight to a clade chain (from the species lookup). */
  setPath: (ids: string[]) => void;
  /** Named clades a species belongs to, broad to narrow, for the lookup panel. */
  lineageOf: (speciesId: string) => Array<{ id: string; label: string; count: number }>;
  guessesLeft: number;
  imageUrl: string;
  credit: MosaicCredit | null;
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

export function useMosaicGame(tree: Tree | null, dateOverride?: string): UseMosaicGame {
  // PROTOTYPE: images are staged per date under public/mosaic, and today is often not one of
  // them (staging a week from tomorrow left today with no picture at all, which showed up as a
  // broken-image icon rather than anything a playtester could act on). The sampler walks the
  // dates that actually exist locally.
  const [staged, setStaged] = useState<string[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/mosaic/index.json")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((d: string[]) => { if (live) setStaged(Array.isArray(d) ? d : []); });
    return () => { live = false; };
  }, []);
  const today = todayKey();
  const date = dateOverride ?? pick ?? (staged.includes(today) ? today : staged[0] ?? today);
  const [missing, setMissing] = useState(false);
  const [guesses, setGuesses] = useState<MosaicGuess[]>([]);
  const [gaveUp, setGaveUp] = useState(false);
  const [pathIds, setPathIds] = useState<string[]>([]);
  const [mechanic, setMechanic] = useState<MosaicMechanic>("blur");
  const [rungOverride, setRungOverride] = useState<number | null>(null);
  const [showProximity, setShowProximity] = useState(false);
  const [credit, setCredit] = useState<MosaicCredit | null>(null);

  // A new day is a new game.
  useEffect(() => { setGuesses([]); setGaveUp(false); setPathIds([]); setMissing(false); }, [date]);

  const answerId = useMemo(() => (tree ? mosaicAnswerFor(tree, date) : null), [tree, date]);

  // The candidate pool, and the drill-down derived from it. Counting ANSWERS rather than
  // guessable species is what makes the number mean "how many things could this be".
  const rootId = useMemo(() => (tree ? mosaicScopeId(tree) : null), [tree]);
  const pool = useMemo(
    () => (tree && rootId ? new Set(mosaicPool(tree, rootId)) : new Set<string>()),
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
    const raw = mosaicDrillOptions(tree, hereId, pool);
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
  // Listed once the filter is narrow enough to SCAN. Raised from 30 after drilling into
  // Perching birds (87 candidates) offered 57 genus chips holding two to four species each —
  // Corvus 4, Emberiza 3, Troglodytinae 3 — which is not a choice anyone can make, and no name
  // list either because 87 was over the old threshold. Scrolling 87 names beats picking
  // between 57 genera you have never heard of.
  const CANDIDATE_LIST_MAX = 120;
  const candidates = useMemo(
    () => (tree && hereId && remaining > 0 && remaining <= CANDIDATE_LIST_MAX
      ? mosaicCandidates(tree, hereId, pool) : []),
    [tree, hereId, pool, remaining]
  );

  const won = guesses.some((g) => g.correct);
  const status: MosaicStatus = won ? "won" : gaveUp || guesses.length >= MOSAIC_MAX_GUESSES ? "lost" : "playing";
  const wrong = guesses.filter((g) => !g.correct).length;
  const rung = rungOverride ?? mosaicRung(wrong, mechanic);
  const ladder = mechanic === "shuffle" ? MOSAIC_SHUFFLE_LADDER : MOSAIC_BLUR_LADDER;
  const solved = status !== "playing";

  useEffect(() => {
    if (!solved) { setCredit(null); return; }
    let live = true;
    fetch(`/mosaic/${date}/credit.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((c) => { if (live) setCredit(c); });
    return () => { live = false; };
  }, [solved, date]);

  const guess = useCallback((id: string) => {
    if (!tree || !answerId || status !== "playing") return;
    setGuesses((prev) => {
      if (prev.some((g) => g.node.id === id)) return prev; // already tried
      const scored = scoreMosaicGuess(tree, answerId, id);
      return scored ? [...prev, scored] : prev;
    });
  }, [tree, answerId, status]);

  return {
    date,
    answerId,
    guesses,
    status,
    rung,
    rungLabel: mechanic === "shuffle" ? `${ladder[rung] ** 2} tiles` : `${ladder[rung]}px`,
    mechanic,
    setMechanic: (m: MosaicMechanic) => { setMechanic(m); setRungOverride(null); },
    rungOverride,
    setRungOverride,
    rungCount: ladder.length,
    candidates,
    showProximity,
    setShowProximity,
    setPath: (ids: string[]) => setPathIds(ids),
    lineageOf: (speciesId: string) => (tree ? mosaicLineagePath(tree, speciesId, pool) : []),
    guessesLeft: Math.max(0, MOSAIC_MAX_GUESSES - guesses.length),
    // On solve the full photo replaces the ladder; until then only the rung earned is fetched,
    // so the clearer images are never even in the browser cache.
    imageUrl: solved ? `/mosaic/${date}/full.jpg`
      : mechanic === "shuffle" ? `/mosaic/${date}/s${rung}.jpg` : `/mosaic/${date}/${rung}.jpg`,
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
