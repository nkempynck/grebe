import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ancestryChain,
  applyGrafts,
  evaluateGuess,
  graftTaxon,
  reconstructGraft,
  isInScope,
  randomAnswerId,
  resolveGuess,
  type GameConfig,
  type GraftTaxon,
  type GuessResult,
  type GameStatus,
  type Tree,
} from "../core";
import { resolveOutOfSet } from "../data/guessIndex";
import { loadTree } from "../data/loadTaxonomy";
import { DEFAULT_SCOPE_ID } from "../data/presets";
import { resolveDailyRules, dailyAnswerFor, type DailyRules } from "../data/dailySchedule";
import { fetchPinnedPuzzle, type LineagePuzzle } from "../data/pinnedPuzzles";
import { effectivePlan, fetchRemotePlan, type DailyPlan } from "../data/dailyPlan";
import { isSupabaseConfigured } from "../data/supabase";
import { fetchTodayDaily } from "../data/games";
import { loadDailyProgress, saveDailyProgress } from "../data/dailyProgress";
import { todayKey } from "../core/daily";

/** Daily = the shared puzzle: everyone gets the same specimen under the day's
 *  scheduled scope/resolution/difficulty (which ramps Mon→Sun). Free = you pick
 *  the settings and reroll at will. */
export type GameMode = "daily" | "free";

export interface UseGame {
  tree: Tree | null;
  mode: GameMode;
  setMode: (m: GameMode) => void;
  /** The day's difficulty schedule (only meaningful in daily mode). */
  daily: DailyRules;
  config: GameConfig;
  answerId: string | null;
  guesses: GuessResult[];
  status: GameStatus;
  error: string | null;
  setScope: (scopeRootId: string) => void;
  setWinWithin: (winWithin: number) => void;
  submit: (text: string) => void;
  /** Guess an out-of-set organism by its graft payload (from GuessInput's DB
   *  suggestions) — grafts it onto the tree as an informative probe. */
  submitGraft: (graft: GraftTaxon) => void;
  giveUp: () => void;
  newRandom: () => void;
  /** Difficulty aid: when on, the guess box only offers species inside the
   *  closest clade you've already pinned down. */
  assist: boolean;
  setAssist: (on: boolean) => void;
  /** The clade the search is currently narrowed to (deepest shared-with-answer
   *  clade so far, from guesses or hints), or null when nothing to narrow to. */
  focusCladeId: string | null;
  /** Clades on the answer's lineage revealed via the hint button. */
  hintIds: string[];
  /** Reveal one more branch of the answer's lineage (a free narrowing step). */
  revealHint: () => void;
  /** Whether there's still a deeper branch a hint could reveal. */
  canHint: boolean;
  /** True when today's daily was restored from a prior attempt (cloud or local)
   *  — it's already recorded, so it shouldn't be counted again. */
  dailyLocked: boolean;
}

const DEFAULT_CONFIG: GameConfig = { scopeRootId: DEFAULT_SCOPE_ID, winWithin: 0 };

/** @param userId  signed-in player's id (enables cross-device daily restore).
 *  @param initialMode  starting mode; pass "free" for a sandbox instance (e.g. the
 *    admin test bench) so it never touches — or persists to — the real daily. */
export function useGame(userId: string | null, initialMode: GameMode = "daily"): UseGame {
  const [tree, setTree] = useState<Tree | null>(null);
  const [mode, setModeState] = useState<GameMode>(initialMode);
  // Free-play settings, only in effect while mode === "free".
  const [freeConfig, setFreeConfig] = useState<GameConfig>(DEFAULT_CONFIG);
  const [freeAssist, setFreeAssist] = useState(false);
  const [answerId, setAnswerId] = useState<string | null>(null);
  const [guesses, setGuesses] = useState<GuessResult[]>([]);
  const [status, setStatus] = useState<GameStatus>("playing");
  const [error, setError] = useState<string | null>(null);
  const [hintIds, setHintIds] = useState<string[]>([]);
  const [dailyLocked, setDailyLocked] = useState(false);
  // Identity (date + answer) the current daily state has been restored for. The
  // save effect refuses to persist until this matches the live daily, so a render
  // carrying the previous day's finished state (e.g. an open tab crossing the
  // 09:00 rollover) can't write that stale result under the new day's key before
  // the restore effect resets it.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);

  // The plan the daily resolves against. Starts from the local (committed +
  // draft) plan for an instant first paint; if Supabase is configured, the
  // live plan replaces it once fetched.
  const [dailyPlan, setDailyPlan] = useState<DailyPlan>(() => effectivePlan());
  useEffect(() => {
    if (isSupabaseConfigured) fetchRemotePlan().then(setDailyPlan).catch(() => {});
  }, []);

  const today = todayKey();
  const daily = useMemo(() => resolveDailyRules(today, dailyPlan), [today, dailyPlan]);

  // A frozen pin for today, set only when it DIFFERS from the generator (i.e. the
  // content/seeding changed since it was pinned). When set it supersedes the
  // schedule wholesale — answer AND the rules the answer was frozen under — so a
  // hand-swapped or thematic day evaluates exactly as recorded.
  const [pinnedDaily, setPinnedDaily] = useState<LineagePuzzle | null>(null);
  useEffect(() => {
    if (mode !== "daily" || !tree) { setPinnedDaily(null); return; }
    let live = true;
    fetchPinnedPuzzle("lineage", today).then((p) => {
      if (!live) return;
      if (!p) { setPinnedDaily(null); return; }
      const r = resolveDailyRules(today, dailyPlan);
      const same =
        p.answerId === dailyAnswerFor(tree, today, dailyPlan) &&
        p.scopeRootId === r.config.scopeRootId &&
        p.winWithin === r.config.winWithin &&
        p.assist === r.assist;
      setPinnedDaily(same ? null : p);
    });
    return () => { live = false; };
  }, [mode, tree, today, dailyPlan]);

  // Daily runs on the day's scheduled rules (or a pin that overrides them); free
  // play uses your chip selections.
  const dailyConfig = pinnedDaily
    ? { scopeRootId: pinnedDaily.scopeRootId, winWithin: pinnedDaily.winWithin }
    : daily.config;
  const config = mode === "daily" ? dailyConfig : freeConfig;
  const assist = mode === "daily" ? (pinnedDaily?.assist ?? daily.assist) : freeAssist;

  // Deepest clade shared with the answer so far (via guesses OR hints) — what
  // "focused" difficulty narrows the search to.
  const focusCladeId = useMemo(() => {
    if (!tree) return null;
    const cands = [...guesses.map((g) => g.mrca.id), ...hintIds];
    let best: string | null = null;
    let bestDepth = -1;
    for (const id of cands) {
      const d = tree.depthOf.get(id) ?? -1;
      if (d > bestDepth) { bestDepth = d; best = id; }
    }
    return best;
  }, [tree, guesses, hintIds]);

  // The answer's lineage inside the current scope, shallow→deep, minus the answer
  // itself — the pool a hint draws from. Only NAMED clades (unnamed phylogenetic
  // junctions would make a meaningless hint).
  const hintLineage = useMemo(() => {
    if (!tree || !answerId) return [] as string[];
    const scopeDepth = tree.depthOf.get(config.scopeRootId) ?? 0;
    return ancestryChain(tree, answerId)
      .reverse()
      .filter((id) => id !== answerId && (tree.depthOf.get(id) ?? 0) > scopeDepth && !!tree.byId.get(id)?.sciName);
  }, [tree, answerId, config.scopeRootId]);

  // Deepest branch known so far (from guesses + hints), as a depth.
  const knownDepth = useMemo(() => {
    const scopeDepth = tree?.depthOf.get(config.scopeRootId) ?? 0;
    let d = scopeDepth;
    for (const id of [...guesses.map((g) => g.mrca.id), ...hintIds]) {
      d = Math.max(d, tree?.depthOf.get(id) ?? scopeDepth);
    }
    return d;
  }, [tree, config.scopeRootId, guesses, hintIds]);

  const nextHint = useMemo(
    () => hintLineage.find((id) => (tree?.depthOf.get(id) ?? 0) > knownDepth) ?? null,
    [hintLineage, tree, knownDepth]
  );
  const canHint = status === "playing" && nextHint !== null;

  const revealHint = useCallback(() => {
    if (nextHint) setHintIds((h) => (h.includes(nextHint) ? h : [...h, nextHint]));
  }, [nextHint]);

  useEffect(() => {
    loadTree().then(setTree).catch((e) => setError(String(e)));
  }, []);

  // (Re)start a round whenever the mode or its scope changes. Daily is
  // deterministic per day; free play draws a fresh random specimen.
  useEffect(() => {
    if (!tree) return;
    // Daily resolves via dailyAnswerFor (curator pin, else the anti-repeat pick);
    // free play is always random.
    const ans =
      mode === "daily"
        ? pinnedDaily?.answerId ?? dailyAnswerFor(tree, today, dailyPlan)
        : randomAnswerId(tree, config.scopeRootId);
    setAnswerId(ans);
    setError(null);

    // Restore this device's cached daily attempt (covers signed-out players and
    // is instant; signed-in players may then get overlaid by the cloud below).
    const prog = mode === "daily" ? loadDailyProgress() : null;
    if (prog && prog.date === today && prog.answerId === ans) {
      applyGrafts(tree, prog.grafts ?? []); // re-graft out-of-set guesses so their ids resolve
      setGuesses(prog.guessIds.filter((id) => tree.byId.has(id)).map((id) => evaluateGuess(tree, ans, id, config)));
      setHintIds(prog.hintIds.filter((id) => tree.byId.has(id)));
      setStatus(prog.status);
      setDailyLocked(prog.status !== "playing");
    } else {
      setGuesses([]);
      setHintIds([]);
      setStatus("playing");
      setDailyLocked(false);
    }
    setHydratedFor(`${today}:${ans}`);
  }, [tree, mode, config.scopeRootId, daily.answerId, pinnedDaily]);

  // Signed-in players restore an already-played daily from the cloud (works on
  // any device). Overlays the local cache; runs once per (user, answer).
  const cloudRestored = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "daily" || !tree || !answerId || !userId) return;
    const key = `${userId}:${answerId}`;
    if (cloudRestored.current === key) return;
    let live = true;
    fetchTodayDaily(today).then((row) => {
      if (!live || !row) return;
      cloudRestored.current = key;
      // The cloud row stores only ids; re-graft this device's out-of-set guesses
      // (saved locally) so grafted ids in guess_ids still resolve after a reload.
      applyGrafts(tree, loadDailyProgress()?.grafts ?? []);
      setGuesses((row.guess_ids ?? []).filter((id) => tree.byId.has(id)).map((id) => evaluateGuess(tree, answerId, id, config)));
      setHintIds((row.hint_ids ?? []).filter((id) => tree.byId.has(id)));
      setStatus(row.won ? "won" : "gaveup");
      setDailyLocked(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tree, answerId, userId, today]);

  // Persist the daily attempt on every change so a reload restores it.
  useEffect(() => {
    if (mode !== "daily" || !tree || !answerId) return;
    // Only persist state that belongs to the live daily. Until the restore effect
    // has run for this (date, answer), the state may still be the previous day's
    // (a stale tab crossing the daily rollover), which must not be written under
    // the new day's key.
    if (hydratedFor !== `${today}:${answerId}`) return;
    // Belt-and-braces: don't let a pre-restore "playing" render clobber a day
    // already finished in storage (which would silently unlock it).
    if (status === "playing") {
      const saved = loadDailyProgress();
      if (saved && saved.date === today && saved.answerId === answerId && saved.status !== "playing") return;
    }
    saveDailyProgress({
      date: today,
      answerId,
      guessIds: guesses.map((g) => g.guess.id),
      hintIds,
      status,
      // Out-of-set guesses (grafted, virtual) aren't in the baked tree — store their
      // graft payloads so a reload can rebuild them. Empty for a normal all-in-set game.
      grafts: guesses
        .map((g) => reconstructGraft(tree, g.guess.id))
        .filter((x): x is NonNullable<typeof x> => x !== null),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tree, answerId, guesses, hintIds, status, hydratedFor]);

  const setMode = useCallback((m: GameMode) => setModeState(m), []);

  const setScope = useCallback((scopeRootId: string) => {
    setFreeConfig((c) => ({ ...c, scopeRootId }));
  }, []);

  const setWinWithin = useCallback((winWithin: number) => {
    setFreeConfig((c) => ({ ...c, winWithin }));
  }, []);

  // Place an OUT-OF-SET organism: graft it (and any missing ancestor clades) onto
  // the tree, then score it as an INFORMATIVE probe — it shows where it sits and
  // how close it lands, but can never win (the daily answer is always in-set).
  const submitGraft = useCallback(
    (graft: GraftTaxon) => {
      if (!tree || !answerId || status !== "playing") return;
      const gid = graftTaxon(tree, graft);
      if (!gid) { setError(`Couldn't place ${graft.common ?? graft.sciName} on the tree.`); return; }
      if (!isInScope(tree, config, gid)) {
        setError(`${graft.common ?? graft.sciName} isn't inside the current scope.`);
        return;
      }
      if (guesses.some((g) => g.guess.id === gid)) {
        setError(`You already guessed ${graft.common ?? graft.sciName}.`);
        return;
      }
      setError(null);
      const probe = evaluateGuess(tree, answerId, gid, config);
      setGuesses((gs) => [{ ...probe, isWin: false }, ...gs]);
    },
    [tree, answerId, status, config, guesses]
  );

  const submit = useCallback(
    (text: string) => {
      if (!tree || !answerId || status !== "playing") return;
      const node = resolveGuess(tree, text);
      if (!node) {
        // Not in the playable set — try the out-of-set index (curated + DB). It's
        // async (DB), so resolve then graft.
        void resolveOutOfSet(text).then((oos) => {
          if (oos) submitGraft(oos);
          else setError(`No match for "${text.trim()}". Try a common or scientific name.`);
        });
        return;
      }
      if (!isInScope(tree, config, node.id)) {
        setError(`${node.common ?? node.sciName} isn't inside the current scope.`);
        return;
      }
      if (guesses.some((g) => g.guess.id === node.id)) {
        setError(`You already guessed ${node.common ?? node.sciName}.`);
        return;
      }
      setError(null);
      const result = evaluateGuess(tree, answerId, node.id, config);
      setGuesses((gs) => [result, ...gs]);
      if (result.isWin) setStatus("won");
    },
    [tree, answerId, status, config, guesses, submitGraft]
  );

  const giveUp = useCallback(() => setStatus("gaveup"), []);

  const newRandom = useCallback(() => {
    if (!tree) return;
    setAnswerId(randomAnswerId(tree, config.scopeRootId));
    setGuesses([]);
    setHintIds([]);
    setStatus("playing");
    setError(null);
  }, [tree, config.scopeRootId]);

  return {
    tree,
    mode,
    setMode,
    daily,
    config,
    answerId,
    guesses,
    status,
    error,
    setScope,
    setWinWithin,
    submit,
    submitGraft,
    giveUp,
    newRandom,
    assist,
    setAssist: setFreeAssist,
    focusCladeId,
    hintIds,
    revealHint,
    canHint,
    dailyLocked,
  };
}
