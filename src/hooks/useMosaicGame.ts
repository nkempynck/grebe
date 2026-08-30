// Mosaic's game state. Still no persistence, stats, leaderboard or pinned puzzle — those are
// the shipping work, and none of them is decided until the daily image pipeline is.
//
// Everything the test bench needs comes in through `dev`, and is null for the real game. The
// bench forces a difficulty tier (which for Mosaic means a set of AIDS, not a different board)
// and walks the locally staged days; the site never reads either.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Tree } from "../core";
import { isAncestor } from "../core";
import { CLADE_GROUPS } from "../data/clades";
import type { RegionScheme } from "../data/geo";
import { mosaicPoints } from "../data/score";
import { fetchMosaicGuard, mosaicGuardCached, GUARD_UNKNOWN, type MosaicGuard } from "../data/mosaicGuard";
import { todayKey } from "../core/daily";
import {
  mosaicAnswerFor, scoreMosaicGuess, mosaicRung, mosaicPool, mosaicScopeId, mosaicDrillOptions,
  mosaicCandidates, mosaicLineagePath, mosaicAids, mosaicTierForDate,
  MOSAIC_BLUR_LADDER, MOSAIC_SHUFFLE_LADDER, MOSAIC_MAX_GUESSES, MOSAIC_DEFAULT_MECHANIC,
  type MosaicGuess, type MosaicMechanic, type MosaicAids,
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
  /** What today gives you besides the picture. Drives which panels exist at all. */
  aids: MosaicAids;
  /** False until today's other boards have been read. The lookup and drill stay hidden while
   *  it is false: unprotected aids would hand Kinship and Branches their answers. */
  guardReady: boolean;
  /** What the round has scored, once it is over. */
  points: number;
  /** What naming it on the NEXT guess would still be worth, while playing. */
  pointsIfNext: number;
  /** Which region scheme the geography column speaks. Continents are what a player thinks in;
   *  realms are what the biology actually is. Both are in the data; this picks one. */
  regionScheme: RegionScheme;
  setRegionScheme: (s: RegionScheme) => void;
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
  /** Reveal the answer as a win. Test bench only. */
  solve: () => void;
  /** Locally staged days. Test bench only; empty on the site. */
  staged: string[];
  /** True when this date has no staged image. On the site that is a genuine outage; on the
   *  bench it usually just means you have not staged that far ahead. */
  missing: boolean;
  onImageError: () => void;
}

/** Test-bench overrides. Null for the real game, and the site never populates it. */
export interface MosaicDev {
  /** Force a difficulty tier 1…7. 0 = today's weekday. */
  tier: number;
  /** Bumped to walk to the next locally staged day. */
  nonce: number;
}

export function useMosaicGame(
  tree: Tree | null,
  opts: { date?: string; dev?: MosaicDev | null } = {}
): UseMosaicGame {
  const { date: dateOverride, dev = null } = opts;
  // The bench walks the days that exist on disk; images are staged per date under
  // public/mosaic and today is often not one of them. The site does not need this list at all
  // — it plays today and reports a missing image as what it is.
  const [staged, setStaged] = useState<string[]>([]);
  useEffect(() => {
    if (!dev) return;
    let live = true;
    fetch("/mosaic/index.json")
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((d: string[]) => { if (live) setStaged(Array.isArray(d) ? d : []); });
    return () => { live = false; };
  }, [Boolean(dev)]);
  const today = todayKey();
  const date = dateOverride
    ?? (dev && staged.length ? staged[((dev.nonce % staged.length) + staged.length) % staged.length] : today);
  const [missing, setMissing] = useState(false);
  const [guesses, setGuesses] = useState<MosaicGuess[]>([]);
  const [gaveUp, setGaveUp] = useState(false);
  const [benchSolved, setBenchSolved] = useState(false);
  const [pathIds, setPathIds] = useState<string[]>([]);
  const [mechanic, setMechanic] = useState<MosaicMechanic>(MOSAIC_DEFAULT_MECHANIC);
  const [rungOverride, setRungOverride] = useState<number | null>(null);
  const [credit, setCredit] = useState<MosaicCredit | null>(null);
  const [regionScheme, setRegionScheme] = useState<RegionScheme>("continent");

  // The clades in play in today's Kinship and Branches boards, which Mosaic must not name.
  // Starts from the pin cache when App has already primed it, otherwise fetched here. Until it
  // resolves the aids stay shut: the failure mode to avoid is showing them unprotected.
  const [guard, setGuard] = useState<MosaicGuard | undefined>(() => mosaicGuardCached(date));
  useEffect(() => {
    const cached = mosaicGuardCached(date);
    if (cached) { setGuard(cached); return; }
    setGuard(undefined);
    let live = true;
    void fetchMosaicGuard(date).then((g) => { if (live) setGuard(g); });
    return () => { live = false; };
  }, [date]);
  const hidden = guard?.hidden ?? GUARD_UNKNOWN.hidden;
  const guardReady = guard?.known === true;

  // What today hands you besides the picture. The bench forces it; everywhere else it is the
  // weekday, which is the whole of Mosaic's difficulty ramp.
  const aids = useMemo(
    () => mosaicAids(dev && dev.tier ? dev.tier : mosaicTierForDate(date)),
    [dev?.tier, date]
  );

  // A new day is a new game — and so is a forced tier on the bench, which changes what the
  // player is working with rather than which board they are working on.
  useEffect(() => {
    setGuesses([]); setGaveUp(false); setBenchSolved(false); setPathIds([]); setMissing(false);
  }, [date, aids.tier]);

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
    if (!tree || !hereId || !aids.subset || !guardReady) return [];
    const raw = mosaicDrillOptions(tree, hereId, pool, hidden);
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
  }, [tree, hereId, pool, pathIds.length, aids.subset, guardReady, hidden]);
  const remaining = path.length ? path[path.length - 1].count : pool.size;
  // Listed once the filter is narrow enough to SCAN. Raised from 30 after drilling into
  // Perching birds (87 candidates) offered 57 genus chips holding two to four species each —
  // Corvus 4, Emberiza 3, Troglodytinae 3 — which is not a choice anyone can make, and no name
  // list either because 87 was over the old threshold. Scrolling 87 names beats picking
  // between 57 genera you have never heard of.
  const CANDIDATE_LIST_MAX = 120;
  const candidates = useMemo(
    // Gated on `subset` explicitly, not just on the threshold. Unnarrowed the pool is 942 and
    // could never reach 120 anyway, but that is an accident of two numbers rather than a rule,
    // and the weekend's whole difficulty is that this list does not exist.
    () => (tree && hereId && aids.subset && guardReady && remaining > 0 && remaining <= CANDIDATE_LIST_MAX
      ? mosaicCandidates(tree, hereId, pool) : []),
    [tree, hereId, pool, remaining, aids.subset, guardReady]
  );

  const won = benchSolved || guesses.some((g) => g.correct);
  const status: MosaicStatus = won ? "won" : gaveUp || guesses.length >= MOSAIC_MAX_GUESSES ? "lost" : "playing";
  const wrong = guesses.filter((g) => !g.correct).length;
  const rung = rungOverride ?? mosaicRung(wrong, mechanic);
  const ladder = mechanic === "shuffle" ? MOSAIC_SHUFFLE_LADDER : MOSAIC_BLUR_LADDER;
  const over = status !== "playing";

  useEffect(() => {
    if (!over) { setCredit(null); return; }
    let live = true;
    fetch(`/mosaic/${date}/credit.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((c) => { if (live) setCredit(c); });
    return () => { live = false; };
  }, [over, date]);

  const guess = useCallback((id: string) => {
    if (!tree || !answerId || status !== "playing") return;
    setGuesses((prev) => {
      if (prev.some((g) => g.node.id === id)) return prev; // already tried
      const scored = scoreMosaicGuess(tree, answerId, id, rootId ?? undefined);
      return scored ? [...prev, scored] : prev;
    });
  }, [tree, answerId, status, rootId]);

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
    aids,
    guardReady,
    // Scored on the guess that WON, so a win on the fourth pays the fourth's value. While
    // playing, the number shown is what the next guess would still be worth, which is the one
    // a player can actually act on.
    points: status === "won" ? mosaicPoints(aids.tier, true, guesses.length, MOSAIC_MAX_GUESSES) : 0,
    pointsIfNext: mosaicPoints(aids.tier, true, Math.min(guesses.length + 1, MOSAIC_MAX_GUESSES), MOSAIC_MAX_GUESSES),
    regionScheme,
    setRegionScheme,
    setPath: (ids: string[]) => setPathIds(ids),
    lineageOf: (speciesId: string) => (tree ? mosaicLineagePath(tree, speciesId, pool, undefined, hidden) : []),
    guessesLeft: Math.max(0, MOSAIC_MAX_GUESSES - guesses.length),
    // On solve the full photo replaces the ladder; until then only the rung earned is fetched,
    // so the clearer images are never even in the browser cache.
    imageUrl: over ? `/mosaic/${date}/full.jpg`
      : mechanic === "shuffle" ? `/mosaic/${date}/s${rung}.jpg` : `/mosaic/${date}/${rung}.jpg`,
    credit,
    path,
    options,
    remaining,
    drillInto: (id: string) => setPathIds((p) => [...p, id]),
    drillTo: (depth: number) => setPathIds((p) => p.slice(0, depth)),
    focusCladeId: aids.subset && guardReady && pathIds.length ? pathIds[pathIds.length - 1] : null,
    guess,
    giveUp: () => setGaveUp(true),
    solve: () => setBenchSolved(true),
    staged,
    missing,
    onImageError: () => setMissing(true),
  };
}
