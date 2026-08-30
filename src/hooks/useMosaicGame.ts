// Mosaic's game state. Still no persistence, stats, leaderboard or pinned puzzle — those are
// the shipping work.
//
// THE BOARD IS SAMPLED, NOT DATED, for the beta. It draws a species when you open the game and
// pulls that species' photograph straight from Wikipedia, which is what lets all 942 animals in
// the pool be playable instead of the twenty days that were ever staged as files. The dated draw
// (mosaicAnswerFor) is still there and is still where this is going; when Mosaic is pinned like
// the other three, the schedule supplies the opening board and this sampling becomes the button
// that deals another.
//
// The weekday still decides the AIDS. Difficulty is a function of the day even while the board
// is not, so a Sunday is brutal whichever animal you drew.
//
// Everything the test bench needs comes in through `dev`, and is null for the real game.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tree } from "../core";
import { isAncestor } from "../core";
import { CLADE_GROUPS, groupOf } from "../data/clades";
import type { RegionScheme } from "../data/geo";
import { mosaicPoints } from "../data/score";
import { fetchBoardGuard, boardGuardCached, GUARD_UNKNOWN, type BoardGuard } from "../data/boardGuard";
import { todayKey } from "../core/daily";
import {
  mosaicSampleAnswer, scoreMosaicGuess, mosaicRung, mosaicPool, mosaicScopeId, mosaicDrillOptions,
  mosaicCandidates, mosaicLineagePath, mosaicAids, mosaicTierForDate, mosaicMinViews,
  mosaicLadder,
  MOSAIC_GROUP_WINDOW,
  type MosaicGuess, type MosaicMechanic, type MosaicAids,
} from "../core/mosaic";
import { fetchWikiImage, fetchWikiShot, type WikiShot } from "../data/wikipedia";
import { setMosaicPrefs, useMosaicPrefs } from "../data/mosaicPrefs";
import {
  loadMosaicProgress, saveMosaicProgress, clearMosaicProgress, usableProgress,
  MOSAIC_PROGRESS_V,
} from "../data/mosaicProgress";
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
  /** The ladder value at this rung: tiles per side for shuffle, blur width for blur. */
  step: number;
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
  /** Named clades a species belongs to, broad to narrow, for the lookup panel. `rank` is the
   *  real taxonomic rank where there is one, and "clade" for the unranked branch points. */
  lineageOf: (speciesId: string) => Array<{ id: string; label: string; count: number; rank: string }>;
  guessesLeft: number;
  /** The picture, at a width worth downloading. Empty until a board has been dealt. */
  imageUrl: string;
  /** The original file, for the reveal and as the fallback if the sized one will not load. */
  imageFull: string;
  /** True while a species is being drawn and its photograph looked up. */
  loading: boolean;
  /** Draw another animal. The beta's board is sampled, so this is a legitimate move rather than
   *  a reroll of something scheduled; it ends the current round without scoring it. */
  newBoard: () => void;
  credit: MosaicCredit | null;
  /** Drill-down path from the game's root, deepest last. The guess bar is restricted to the
   *  deepest entry; the whole path is the breadcrumb. */
  path: Array<{ id: string; label: string; count: number; rank: string }>;
  /** Named clades one level below the current position, with candidate counts and the rank that
   *  says what kind of group each is. */
  options: Array<{ id: string; label: string; count: number; rank: string }>;
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
  /** True when no animal with a usable photograph could be dealt. Wikipedia being unreachable,
   *  in practice: the pool is large and the retry runs several times. */
  missing: boolean;
  onImageError: () => void;
}

/** Test-bench overrides. Null for the real game, and the site never populates it. */
export interface MosaicDev {
  /** Force a difficulty tier 1…7. 0 = today's weekday. */
  tier: number;
  /** Bumped to deal a fresh board, by the bench's "New board" button. */
  nonce: number;
}

/** A dealt board: the animal and the picture of it, always set together. Half of this is
 *  useless — an answer whose photograph turned out to be a range map is not a board — so they
 *  are one piece of state and the game renders nothing until both are in hand. */
interface DealtBoard {
  answerId: string;
  shot: WikiShot;
}

/** Where a stats bucket's name would mislead as a drill chip.
 *
 *  CLADE_GROUPS is the by-clade STATS bucketing every game shares, so it cannot be reshaped for
 *  a drill: changing it would rewrite what past games were filed under. Its "Reptiles" bucket
 *  resolves to Squamata, which is fine as a stats bar and wrong as a chip sitting next to
 *  Turtles — the two are siblings, and neither contains the other. */
const MOSAIC_GROUP_LABEL: Record<string, string> = { Squamata: "Lizards & snakes" };

/** How many species to try before giving up on dealing a board. Each attempt costs one summary
 *  request, and a miss means the animal has no usable photograph, which is uncommon: the pool is
 *  filtered on Wikipedia pageviews, so every member has a real article. Six is generous for a
 *  bad-luck run and short enough that a genuine outage reports itself quickly. */
const DEAL_ATTEMPTS = 6;

/** Width to ask Wikimedia for. Wide enough that the reveal is a photograph rather than a
 *  thumbnail, narrow enough that a board is not a multi-megabyte download for a picture the
 *  player first meets as four hundred scrambled squares. */
const MOSAIC_IMAGE_WIDTH = 1024;

export function useMosaicGame(
  tree: Tree | null,
  opts: { date?: string; dev?: MosaicDev | null } = {}
): UseMosaicGame {
  const { date: dateOverride, dev = null } = opts;
  // The date no longer picks the animal, only the aids and which other boards to hide. The
  // override stays because the bench and the admin previews still ask for a specific weekday.
  const date = dateOverride ?? todayKey();
  const [missing, setMissing] = useState(false);
  const [guesses, setGuesses] = useState<MosaicGuess[]>([]);
  const [gaveUp, setGaveUp] = useState(false);
  const [benchSolved, setBenchSolved] = useState(false);
  const [pathIds, setPathIds] = useState<string[]>([]);
  const [rungOverride, setRungOverride] = useState<number | null>(null);
  // The reveal mechanic, the region scheme and the forced tier are the PLAYER's settings
  // now, not this hook's state, so they survive a reload and a board change.
  const prefs = useMosaicPrefs();
  const { mechanic, regionScheme } = prefs;
  const [board, setBoard] = useState<DealtBoard | null>(null);
  // Bumped to deal again: by the player's own button, and by the bench's. Kept separate from
  // dev.nonce so the site has a way to ask for a new board without a dev setting.
  const [deal, setDeal] = useState(0);
  // Everything dealt this sitting, so "another animal" does not hand back the one just played.
  // A ref, not state: it must not itself trigger a re-deal. The same goes for the groups of the
  // last few boards, which damp the next draw so a sitting is not five birds.
  const seen = useRef<Set<string>>(new Set(loadMosaicProgress()?.seen ?? []));
  const recentGroups = useRef<string[]>(loadMosaicProgress()?.recentGroups ?? []);

  // The clades in play in today's Kinship and Branches boards, which Mosaic must not name.
  // Starts from the pin cache when App has already primed it, otherwise fetched here. Until it
  // resolves the aids stay shut: the failure mode to avoid is showing them unprotected.
  const [guard, setGuard] = useState<BoardGuard | undefined>(() => boardGuardCached(date));
  useEffect(() => {
    const cached = boardGuardCached(date);
    if (cached) { setGuard(cached); return; }
    setGuard(undefined);
    let live = true;
    void fetchBoardGuard(date).then((g) => { if (live) setGuard(g); });
    return () => { live = false; };
  }, [date]);
  const hidden = guard?.hidden ?? GUARD_UNKNOWN.hidden;
  const guardReady = guard?.known === true;

  // What today hands you besides the picture. The bench forces it; everywhere else it is the
  // weekday, which is the whole of Mosaic's difficulty ramp.
  // Precedence: the bench's forced tier, then the player's, then the weekday. Two overrides
  // rather than one because the bench has to be able to sit on top of whatever a tester left
  // in their own settings.
  const forcedTier = (dev && dev.tier) || prefs.tier;
  const aids = useMemo(
    () => mosaicAids(forcedTier || mosaicTierForDate(date)),
    [forcedTier, date]
  );

  const rootId = useMemo(() => (tree ? mosaicScopeId(tree) : null), [tree]);

  // How obscure the answer may be. It follows the candidate LIST rather than the difficulty:
  // 9000 pageviews is fair when twelve names are on screen and unfair when nothing is.
  const minViews = mosaicMinViews(aids.tier);

  // Same floor as the draw. "How many things could this be" has to count the things it could
  // actually be, or on a raised-floor day the breadcrumb would promise candidates the answer
  // was never drawn from.
  const pool = useMemo(
    () => (tree && rootId ? new Set(mosaicPool(tree, rootId, minViews)) : new Set<string>()),
    [tree, rootId, minViews]
  );

  // Species to the group the stats bars already speak (Birds, Mammals, Insects…). Walked once
  // per tree and cached: the cooldown asks for it across the whole pool on every draw, and
  // groupOf is an ancestor test against each of the eight groups in turn.
  const groupCache = useRef(new Map<string, string>());
  useEffect(() => { groupCache.current = new Map(); }, [tree]);
  const groupFor = useCallback((id: string) => {
    if (!tree) return "";
    let g = groupCache.current.get(id);
    if (g === undefined) { g = groupOf(tree, id); groupCache.current.set(id, g); }
    return g;
  }, [tree]);

  // Deal a board: draw a species, then ask Wikipedia for its picture. Both or neither, because
  // an animal whose article leads with a range map is not a puzzle — fetchWikiImage already
  // rejects those, and here a rejection just means draw again.
  //
  // It waits for the cross-game guard, which is the one thing that has to be known BEFORE the
  // draw rather than after it: the guard names today's Kinship and Branches species, and the
  // point is not to deal one of them. Waiting costs nothing the game was not already waiting
  // for, since the aids stay shut until the guard resolves either way.
  useEffect(() => {
    if (!tree || !rootId || guard === undefined) return;
    let live = true;
    setMissing(false);
    // The board a reload interrupted, if it is still playable. Tried before dealing rather than
    // after, so a resumed game never flickers through a different animal on its way back.
    const saved = usableProgress(loadMosaicProgress(), {
      tier: aids.tier,
      canBeAnswer: (id) => pool.has(id),
      knows: (id) => tree.byId.has(id),
    });
    if (saved) {
      seen.current = new Set(saved.seen);
      recentGroups.current = [...saved.recentGroups];
      setBoard({ answerId: saved.answerId, shot: saved.shot });
      // Re-scored here rather than stored: the cells are derived, and a stale copy of them would
      // outlive the rules that produced it.
      setGuesses(
        saved.guessIds
          .map((id) => scoreMosaicGuess(tree, saved.answerId, id, rootId))
          .filter((x): x is MosaicGuess => x !== null)
      );
      setGaveUp(saved.gaveUp);
      setPathIds(saved.pathIds);
      setBenchSolved(false);
      return;
    }
    // A fresh deal is a fresh game. Reset here rather than in an effect keyed on the answer:
    // that one would fire on a RESTORE too and wipe the guesses it had just put back.
    setBoard(null);
    setGuesses([]);
    setGaveUp(false);
    setBenchSolved(false);
    setPathIds([]);
    void (async () => {
      const draw = (exclude: ReadonlySet<string>) => mosaicSampleAnswer(tree, {
        scopeRootId: rootId,
        minViews,
        exclude,
        cooldown: { of: groupFor, recent: recentGroups.current },
      });
      let exclude = new Set([...guard.species, ...seen.current]);
      for (let i = 0; i < DEAL_ATTEMPTS; i++) {
        let id = draw(exclude);
        if (!id && seen.current.size) {
          // Every animal in the pool has been dealt this sitting. Start the sitting over rather
          // than reporting an outage: nine hundred boards deep, a repeat is the right answer.
          seen.current.clear();
          exclude = new Set(guard.species);
          id = draw(exclude);
        }
        const node = id ? tree.byId.get(id) : null;
        if (!id || !node) break;
        exclude.add(id);
        const image = await fetchWikiImage(node);
        if (!live) return;
        if (image?.full) {
          const shot = await fetchWikiShot(image, MOSAIC_IMAGE_WIDTH);
          if (!live) return;
          seen.current.add(id);
          recentGroups.current = [...recentGroups.current, groupFor(id)].slice(-MOSAIC_GROUP_WINDOW);
          setBoard({ answerId: id, shot });
          return;
        }
      }
      if (live) setMissing(true);
    })();
    return () => { live = false; };
  }, [tree, rootId, guard, deal, dev?.nonce, aids.tier, pool]);

  const answerId = board?.answerId ?? null;

  // The drill-down, derived from the pool above. Counting ANSWERS rather than guessable species
  // is what makes the number mean "how many things could this be".
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
      return { id, label: n?.common ?? n?.sciName ?? id, count, rank: n?.sepRank ?? n?.rank ?? "" };
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
      .map((g) => {
        const n = tree.byId.get(g.id);
        const sci = n?.sciName ?? "";
        return {
          id: g.id,
          label: MOSAIC_GROUP_LABEL[sci] ?? g.label,
          count: countUnder(g.id),
          rank: n?.sepRank ?? n?.rank ?? "",
        };
      })
      .filter((o) => o.count > 0);

    // Anything the curated list does not cover (cephalopods, jellyfish, sharks) still needs a
    // way in, and the old filter only dropped options BELOW a curated group. Options ABOVE one
    // survived, and "Chordates" is above four of them: it was the first named node on the way
    // down, so it appeared as a 756-species chip that duplicated Birds, Mammals, Fish and
    // Amphibians while being the only route to everything else in the phylum. Turtles, sharks,
    // crocodilians, the tuatara and the sea lamprey — 78 possible answers — sat behind it.
    //
    // So an option that SWALLOWS a curated group is opened up and replaced by its own named
    // children, repeatedly. Measured: first-level reach 864/942 -> 942/942, and the list stays
    // inside the 24 the panel renders.
    const covered = (id: string) => curated.some((c) => c.id === id || isAncestor(tree, c.id, id));
    const swallows = (id: string) => curated.some((c) => isAncestor(tree, id, c.id));
    const settle = (opts: typeof raw, depth: number): typeof raw => {
      if (depth > 8) return opts; // paranoia; the tree is ~25 deep and this only ever descends
      const out: typeof raw = [];
      for (const o of opts) {
        if (covered(o.id)) continue;
        if (swallows(o.id)) out.push(...settle(mosaicDrillOptions(tree, o.id, pool, hidden), depth + 1));
        else out.push(o);
      }
      return out;
    };
    const seen = new Set<string>();
    const rest = settle(raw, 0).filter((o) => !seen.has(o.id) && seen.add(o.id));
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
  const status: MosaicStatus = won ? "won" : gaveUp || guesses.length >= aids.guesses ? "lost" : "playing";
  const wrong = guesses.filter((g) => !g.correct).length;
  const rung = rungOverride ?? mosaicRung(wrong, mechanic, aids.guesses);
  // The day's own ladder: as many rungs as it has guesses, resampled onto the same curve.
  const ladder = useMemo(() => mosaicLadder(mechanic, aids.guesses), [mechanic, aids.guesses]);
  const over = status !== "playing";

  // Write the board back on every change, finished ones included: a reload after a win should
  // show what you did rather than silently swapping the animal. Only "Play another" clears it.
  //
  // The bench is exempt. Its boards are forced tiers and autosolves, and letting them overwrite
  // a real game in progress would lose it.
  useEffect(() => {
    if (!board || dev) return;
    saveMosaicProgress({
      v: MOSAIC_PROGRESS_V,
      answerId: board.answerId,
      shot: board.shot,
      guessIds: guesses.map((x) => x.node.id),
      gaveUp,
      pathIds,
      tier: aids.tier,
      seen: [...seen.current],
      recentGroups: recentGroups.current,
    });
  }, [board, guesses, gaveUp, pathIds, aids.tier, dev]);

  // Attribution came with the picture, so there is nothing to fetch. Held back until the round
  // is over all the same: the photographer's name is not a clue, but a name under a scrambled
  // picture is one more thing to read for a hint than to look at.
  const credit = over ? board?.shot.credit ?? null : null;

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
    setMechanic: (m: MosaicMechanic) => { setMosaicPrefs({ mechanic: m }); setRungOverride(null); },
    rungOverride,
    setRungOverride,
    rungCount: ladder.length,
    // The ladder VALUE at this rung: tiles per side, or the blur width. The picture takes
    // this rather than a rung index, so it needs to know nothing about how long the day is.
    step: ladder[rung],
    candidates,
    aids,
    guardReady,
    // Scored on the guess that WON, so a win on the fourth pays the fourth's value. While
    // playing, the number shown is what the next guess would still be worth, which is the one
    // a player can actually act on.
    points: status === "won" ? mosaicPoints(aids.tier, true, guesses.length, aids.guesses) : 0,
    pointsIfNext: mosaicPoints(aids.tier, true, Math.min(guesses.length + 1, aids.guesses), aids.guesses),
    regionScheme,
    setRegionScheme: (s: RegionScheme) => setMosaicPrefs({ regionScheme: s }),
    setPath: (ids: string[]) => setPathIds(ids),
    lineageOf: (speciesId: string) => (tree ? mosaicLineagePath(tree, speciesId, pool, undefined, hidden) : []),
    guessesLeft: Math.max(0, aids.guesses - guesses.length),
    // ONE file for the whole round, scrambled in the browser at whichever rung is earned. The
    // staged ladder fetched a different file per rung, which kept the clear ones out of the
    // cache until they were won; sampling live gives that up, and it is the same trade as the
    // URL naming the species. Requested at a width worth downloading rather than at the
    // original, which for a featured animal photo is regularly several megabytes.
    imageUrl: board?.shot.src ?? "",
    imageFull: board?.shot.full ?? "",
    loading: !board && !missing,
    newBoard: () => { clearMosaicProgress(); setDeal((d) => d + 1); },
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
    missing,
    // A stored picture can 404 later: Wikimedia files get renamed and deleted. Drop the
    // board rather than stranding the player on one that can never render.
    onImageError: () => { clearMosaicProgress(); setMissing(true); },
  };
}
