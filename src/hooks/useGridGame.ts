import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tree } from "../core";
import { checkGridSelection, GRID_GROUPS, GRID_GROUP_SIZE, type GridBoard, type GridGroup } from "../core";
import { todayKey } from "../core/daily";
import { gridBoardFor } from "../data/gridDaily";
import { fetchPinnedPuzzle, kinshipBoard } from "../data/pinnedPuzzles";
import { loadGridProgress, saveGridProgress } from "../data/gridProgress";

/** Wrong guesses allowed before the board is lost (matches Connections). */
export const GRID_MAX_MISTAKES = 4;

export type GridStatus = "playing" | "won" | "lost";

/** Fired once, the moment a board is finished (never on a restored one). */
export interface GridComplete {
  won: boolean;
  mistakes: number;
  /** How many species pictures were revealed (drives the gentle score penalty). */
  reveals: number;
  tier: number;
  date: string;
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
  /** Species whose picture has been revealed this game (first free, rest a mistake). */
  revealed: string[];
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
  dev?: GridDevOpts | null
): UseGridGame {
  const date = todayKey();
  const devActive = !!dev;
  // The board defaults to the deterministic generator (instant, offline). If a
  // frozen pin exists for today AND differs (i.e. the generator changed since it
  // was pinned), the pinned board takes over — the pin is the authoritative record.
  // Under a playtest override the board is generated fresh from the override seed
  // instead (no pin, no saved progress).
  const devOpts = dev ? { tier: dev.tier, seed: dev.nonce > 0 ? `n${dev.nonce}` : "" } : undefined;
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
  const [status, setStatus] = useState<GridStatus>("playing");
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tile → group level, for colouring solved tiles and building the share.
  const levelById = useMemo(() => {
    const m = new Map<string, number>();
    board?.groups.forEach((g) => g.memberIds.forEach((id) => m.set(id, g.level)));
    return m;
  }, [board]);
  const levelOf = useCallback((id: string) => levelById.get(id) ?? 0, [levelById]);

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
      setStatus(prog.status);
    } else {
      setSolved([]);
      setMistakes(0);
      setAttempts([]);
      setRevealed([]);
      setStatus("playing");
    }
    setSelected([]);
    setOrder(board.tiles);
  }, [board, date, devActive]);

  // Persist every change against today's board — but never a playtest board.
  useEffect(() => {
    if (!board || devActive) return;
    // Guard the mount window: this effect can fire once with the pre-restore
    // "playing" state (before the restore effect above rehydrates it). Writing
    // that would clobber a day already finished in storage and silently unlock
    // it. So never downgrade today's finished result back to "playing". A real
    // new day (different date) still writes normally.
    if (status === "playing") {
      const saved = loadGridProgress();
      if (saved && saved.date === date && saved.status !== "playing") return;
    }
    saveGridProgress({ date, solved, mistakes, attempts, revealed, status });
  }, [board, date, devActive, solved, mistakes, attempts, revealed, status]);

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
      setRevealed((r) => [...r, id]);
    },
    [board, status, revealed]
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
        if (!devActive) onCompleteRef.current?.({ won: true, mistakes, reveals: revealed.length, tier: board.tier, date });
      }
      return;
    }
    const nextMistakes = mistakes + 1;
    setMistakes(nextMistakes);
    if (nextMistakes >= GRID_MAX_MISTAKES) {
      setStatus("lost");
      setSelected([]);
      if (!devActive) onCompleteRef.current?.({ won: false, mistakes: nextMistakes, reveals: revealed.length, tier: board.tier, date });
    } else {
      flash(oneAway ? "One away…" : "Not a group");
    }
  }, [board, status, selected, solved, mistakes, revealed, levelOf, flash, date, devActive]);

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
    levelOf,
    toggle,
    reveal,
    submit,
    deselectAll,
    shuffle,
    solve,
  };
}
