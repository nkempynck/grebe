import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tree } from "../core";
import { checkGridSelection, GRID_GROUPS, GRID_GROUP_SIZE, type GridBoard, type GridGroup } from "../core";
import { todayKey } from "../core/daily";
import { gridBoardFor } from "../data/gridDaily";
import { fetchPinnedPuzzle, kinshipBoard } from "../data/pinnedPuzzles";
import { loadGridProgress, saveGridProgress } from "../data/gridProgress";
import { markCountedElsewhere } from "../data/playCount";
import { boardGroupOf } from "../data/clades";
import { fetchTodayGrid } from "../data/games";
import { kinshipFreeReveals } from "../data/score";

/** Wrong guesses allowed before the board is lost (matches Connections). */
export const GRID_MAX_MISTAKES = 4;

/** Up to this tier (Mon–Wed) every tile shows its picture AND name for free, so there
 *  are no reveals to spend the free-peek balance on. Thu (tier 4)+ hide something. */
export const PRESHOW_MAX_TIER = 3;

export type GridStatus = "playing" | "won" | "lost";

/** Fired once, the moment a board is finished (never on a restored one). */
export interface GridComplete {
  won: boolean;
  mistakes: number;
  /** How many species pictures were revealed (total, for display/share). */
  reveals: number;
  /** How many of those were PAID (billed while the free-peek balance was empty). */
  paidReveals: number;
  tier: number;
  date: string;
  /** The board's clade group (every board sits in exactly one), for per-clade stats.
   *  Null only if the tree knows none of the board's ids, which can't happen for a
   *  board this tree just built — it's the same null the history backfill uses. */
  group: string | null;
}

/** Admin playtest override: force a difficulty tier and reshuffle via `nonce`.
 *  When present, the board is ephemeral — no pin, no saved progress, no result
 *  recorded — so testing never touches the real daily or the leaderboard. */
export interface GridDevOpts {
  tier: number;
  nonce: number;
}

export interface UseGridGame {
  board: GridBoard | null;
  date: string;
  tier: number;
  /** True once today's real board is finished (restored or just now) and no
   *  playtest override is active — the daily is locked until tomorrow. */
  locked: boolean;
  /** Tile ids currently selected (max four). */
  selected: string[];
  /** Remaining (unsolved) tile ids, in display order. */
  remaining: string[];
  /** Solution groups already found, in the order solved. */
  solvedGroups: GridGroup[];
  mistakes: number;
  mistakesLeft: number;
  status: GridStatus;
  /** Transient feedback after a guess ("Not a group", "One away…"), else null. */
  feedback: string | null;
  /** Each past guess as its four tiles' true group levels — drives the share. */
  attempts: number[][];
  /** Species whose picture has been revealed this game (total, for the count shown). */
  revealed: string[];
  /** How many reveals were billed as PAID — the free-peek balance (3 + one per solved
   *  group, spent in order) makes this order-dependent, so it's tracked live. */
  paidReveals: number;
  /** The group level (0–3) a tile belongs to — for colouring. */
  levelOf: (id: string) => number;
  toggle: (id: string) => void;
  /** Reveal a tile's Wikipedia picture; the first is free, each later one costs a mistake. */
  reveal: (id: string) => void;
  submit: () => void;
  deselectAll: () => void;
  shuffle: () => void;
  /** Test bench: jump straight to a solved board (never recorded). */
  solve: () => void;
}

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Order-independent identity of a board — used to tell a frozen pin apart from
 *  the freshly computed board (so we only swap when they actually differ). */
function boardSig(b: GridBoard | null): string {
  return b ? JSON.stringify({ t: b.tier, g: b.groups.map((g) => [g.cladeId, g.memberIds, g.level]), tl: b.tiles }) : "";
}

export function useGridGame(
  tree: Tree | null,
  onComplete?: (r: GridComplete) => void,
  dev?: GridDevOpts | null,
  /** The signed-in player's id, or null. When set, an already-played board is
   *  restored (locked) from the server, so playing one device/domain blocks a
   *  replay on another — matching Lineage. */
  userId?: string | null
): UseGridGame {
  const date = todayKey();
  const devActive = !!dev;
  // The board defaults to the deterministic generator (instant, offline). If a
  // frozen pin exists for today AND differs (i.e. the generator changed since it
  // was pinned), the pinned board takes over — the pin is the authoritative record.
  // Under a playtest override the board is generated fresh from the override seed
  // instead (no pin, no saved progress).
  const devOpts = dev ? { tier: dev.tier, reshuffle: dev.nonce } : undefined;
  const computed = useMemo(
    () => (tree ? gridBoardFor(tree, date, devOpts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, date, devActive, dev?.tier, dev?.nonce]
  );
  const [pinned, setPinned] = useState<GridBoard | null>(null);
  const board = pinned ?? computed;

  useEffect(() => {
    if (!tree || devActive) { setPinned(null); return; }
    let live = true;
    fetchPinnedPuzzle("kinship", date).then((p) => {
      if (!live) return;
      const frozen = p ? kinshipBoard(tree, date, p) : null;
      setPinned(frozen && boardSig(frozen) !== boardSig(computed) ? frozen : null);
    });
    return () => { live = false; };
  }, [tree, date, computed, devActive]);

  // Latest onComplete, held in a ref so submit() doesn't need it as a dependency
  // (and so it fires with the current closure, not a stale one).
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [order, setOrder] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [solved, setSolved] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [attempts, setAttempts] = useState<number[][]>([]);
  const [revealed, setRevealed] = useState<string[]>([]);
  // Reveals billed as PAID (spent while the free-peek balance was empty). The balance
  // is KINSHIP_FREE_REVEALS + one per solved group, spent in order; a peek already
  // billed stays billed even if a later solve tops the balance up. Tracked live
  // because it's order-dependent — see reveal().
  const [paidReveals, setPaidReveals] = useState(0);
  const [status, setStatus] = useState<GridStatus>("playing");
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Signature of the board the current state has been restored for. The save
  // effect refuses to persist until this matches the live board, so a render that
  // carries the previous board's finished state (e.g. an open tab crossing the
  // 09:00 rollover) can't write that stale result under the new day's key before
  // the restore effect below resets it.
  const [hydratedSig, setHydratedSig] = useState<string | null>(null);

  // Tile → group level, for colouring solved tiles and building the share.
  const levelById = useMemo(() => {
    const m = new Map<string, number>();
    board?.groups.forEach((g) => g.memberIds.forEach((id) => m.set(id, g.level)));
    return m;
  }, [board]);
  const levelOf = useCallback((id: string) => levelById.get(id) ?? 0, [levelById]);

  // The board's clade group, reported with the result so the stats page can bucket
  // the day. Group clade ids come first: they resolve in the base tree too, which is
  // what the history backfill has to work with (see boardGroupOf).
  const boardGroup = useMemo(
    () => (tree && board ? boardGroupOf(tree, [...board.groups.map((g) => g.cladeId), ...board.tiles]) : null),
    [tree, board]
  );

  // (Re)initialise when the board changes, restoring a same-day attempt. A
  // playtest board is always fresh — it ignores (and never writes) saved progress.
  useEffect(() => {
    if (!board) return;
    const prog = devActive ? null : loadGridProgress();
    if (prog && prog.date === date) {
      setSolved(prog.solved);
      setMistakes(prog.mistakes);
      setAttempts(prog.attempts);
      setRevealed(prog.revealed ?? []);
      // Older saves predate paidReveals — fall back to the end-state minimum.
      setPaidReveals(prog.paidReveals ?? Math.max(0, (prog.revealed?.length ?? 0) - (kinshipFreeReveals(computed?.tier ?? 0) + prog.solved.length)));
      setStatus(prog.status);
    } else {
      setSolved([]);
      setMistakes(0);
      setAttempts([]);
      setRevealed([]);
      setPaidReveals(0);
      setStatus("playing");
    }
    setSelected([]);
    setOrder(board.tiles);
    setHydratedSig(boardSig(board));
  }, [board, date, devActive]);

  // Persist every change against today's board — but never a playtest board.
  useEffect(() => {
    if (!board || devActive) return;
    // Only persist state that belongs to the live board. Until the restore effect
    // above has run for this board, the state may still be the previous board's
    // (a stale tab crossing the daily rollover), which must not be written under
    // the new day's key.
    if (hydratedSig !== boardSig(board)) return;
    // Belt-and-braces: never downgrade today's finished result back to "playing"
    // (a fast remount could still fire this with a pre-restore "playing" render).
    if (status === "playing") {
      const saved = loadGridProgress();
      if (saved && saved.date === date && saved.status !== "playing") return;
    }
    saveGridProgress({ date, solved, mistakes, attempts, revealed, paidReveals, status });
  }, [board, date, devActive, solved, mistakes, attempts, revealed, paidReveals, status, hydratedSig]);

  // Signed-in players: restore an already-played board from the server (works on
  // any device/domain, where localStorage is empty). Runs once per (user, date),
  // only after the local restore has hydrated this board so it can't be clobbered.
  // The row stores only summary stats, so we reconstruct a TERMINAL board (a win
  // reveals every group; a loss just locks) rather than the exact attempts — enough
  // to block a replay and show the finished state. onComplete is NOT re-fired.
  const cloudRestored = useRef<string | null>(null);
  useEffect(() => {
    if (devActive || !board || !userId) return;
    if (hydratedSig !== boardSig(board)) return; // wait for local hydration
    const key = `${userId}:${date}`;
    if (cloudRestored.current === key) return;
    // Local storage already has a finished board (same-device replay): keep it —
    // it carries the real attempts/reveals, richer than the server summary.
    if (status !== "playing") { cloudRestored.current = key; return; }
    let live = true;
    fetchTodayGrid(date).then((row) => {
      if (!live || !row) return;
      cloudRestored.current = key;
      // Played on another device, so it has already been counted there. Claim the day
      // locally without counting, or the persist effect above hands this board to
      // catchUpCounts on the next mount as if it had been played here.
      markCountedElsewhere("kinship", date);
      setSolved(row.won ? board.groups.map((_, i) => i) : []);
      setMistakes(row.mistakes);
      // Only the reveal COUNT is stored; a right-length sentinel array keeps the
      // score/share ("N reveals") correct without needing the real tile ids.
      setRevealed(Array.from({ length: row.reveals }, (_, i) => `__cloud_${i}__`));
      // Exact paid count stored on the row (0 for rows written before the column).
      setPaidReveals(row.paidReveals);
      setStatus(row.won ? "won" : "lost");
      setSelected([]);
    });
    return () => { live = false; };
  }, [devActive, board, userId, date, hydratedSig, status]);

  const solvedTiles = useMemo(() => {
    const s = new Set<string>();
    if (board) for (const i of solved) board.groups[i].memberIds.forEach((id) => s.add(id));
    return s;
  }, [board, solved]);

  const remaining = useMemo(() => order.filter((id) => !solvedTiles.has(id)), [order, solvedTiles]);
  const solvedGroups = useMemo(() => (board ? solved.map((i) => board.groups[i]) : []), [board, solved]);

  const flash = useCallback((msg: string) => {
    setFeedback(msg);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 2200);
  }, []);
  useEffect(() => () => { if (feedbackTimer.current) clearTimeout(feedbackTimer.current); }, []);

  const toggle = useCallback(
    (id: string) => {
      if (status !== "playing" || solvedTiles.has(id)) return;
      setSelected((sel) => {
        if (sel.includes(id)) return sel.filter((x) => x !== id);
        if (sel.length >= GRID_GROUP_SIZE) return sel;
        return [...sel, id];
      });
    },
    [status, solvedTiles]
  );

  const deselectAll = useCallback(() => setSelected([]), []);
  const shuffle = useCallback(() => setOrder((o) => shuffled(o)), []);

  // Test bench only: mark every group solved and win. onComplete never fires from
  // here, and a playtest board isn't recorded anyway.
  const solve = useCallback(() => {
    if (!board) return;
    setSolved(board.groups.map((_, i) => i));
    setSelected([]);
    setStatus("won");
  }, [board]);

  // Reveal a tile's picture. Peeking never ends the board; the first few are free
  // and each one past that shaves a flat slice of score (see kinshipPoints, which
  // takes the reveal count). We only track the count here.
  const reveal = useCallback(
    (id: string) => {
      if (!board || status !== "playing" || revealed.includes(id)) return;
      // Free-peek balance BEFORE this peek: the day's starting budget (+1 per solved group)
      // minus peeks already spent, plus those already billed. At or below zero means this
      // peek is paid. A free peek earned later never refunds one already billed.
      const balance = kinshipFreeReveals(board.tier) + solved.length + paidReveals - revealed.length;
      if (balance <= 0) setPaidReveals((p) => p + 1);
      setRevealed((r) => [...r, id]);
    },
    [board, status, revealed, solved, paidReveals]
  );

  const submit = useCallback(() => {
    if (!board || status !== "playing" || selected.length !== GRID_GROUP_SIZE) return;
    const row = selected.map((id) => levelOf(id));
    const { solvedIndex, oneAway } = checkGridSelection(board, selected);
    setAttempts((a) => [...a, row]);

    if (solvedIndex !== null) {
      const nextSolved = [...solved, solvedIndex];
      setSolved(nextSolved);
      setSelected([]);
      if (nextSolved.length === GRID_GROUPS) {
        setStatus("won");
        // A playtest board is never recorded (it would corrupt real standings).
        if (!devActive) onCompleteRef.current?.({ won: true, mistakes, reveals: revealed.length, paidReveals, tier: board.tier, date, group: boardGroup });
      } else if (board.tier > PRESHOW_MAX_TIER) {
        // Only announce it on days that actually have reveals (Thu+); Mon–Wed show
        // every tile free, so there's nothing to spend a free peek on.
        flash("+1 free peek 🔑");
      }
      return;
    }
    const nextMistakes = mistakes + 1;
    setMistakes(nextMistakes);
    if (nextMistakes >= GRID_MAX_MISTAKES) {
      setStatus("lost");
      setSelected([]);
      if (!devActive) onCompleteRef.current?.({ won: false, mistakes: nextMistakes, reveals: revealed.length, paidReveals, tier: board.tier, date, group: boardGroup });
    } else {
      flash(oneAway ? "One away…" : "Not a group");
    }
  }, [board, status, selected, solved, mistakes, revealed, paidReveals, levelOf, flash, date, devActive, boardGroup]);

  return {
    board,
    date,
    tier: board?.tier ?? 0,
    locked: !devActive && status !== "playing",
    selected,
    remaining,
    solvedGroups,
    mistakes,
    mistakesLeft: GRID_MAX_MISTAKES - mistakes,
    status,
    feedback,
    attempts,
    revealed,
    paidReveals,
    levelOf,
    toggle,
    reveal,
    submit,
    deselectAll,
    shuffle,
    solve,
  };
}
