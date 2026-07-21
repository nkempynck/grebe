import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BranchesBoard, Tree } from "../core";
import { todayKey } from "../core/daily";
import { branchesAllowance } from "../data/score";
import { branchesBoardFor } from "../data/branchesDaily";
import { fetchPinnedPuzzle, branchesBoard as rebuildBranches } from "../data/pinnedPuzzles";
import { loadBranchesProgress, saveBranchesProgress } from "../data/branchesProgress";
import { fetchTodayBranches } from "../data/games";

export type BranchesStatus = "playing" | "done";

/** Fired once, the moment a board is resolved (never on a restored one). */
export interface BranchesComplete {
  correct: number;
  total: number;
  /** Correct slots revealed by a hint (each forfeits a full point). */
  hinted: number;
  /** Correct slots whose species was peeked on Wikipedia (each forfeits half). */
  peeked: number;
  /** Wrong submissions committed (each burns a point-slice; over budget = a loss). */
  mistakes: number;
  won: boolean; // finished with every slot correct AND within the mistake budget
  tier: number;
  date: string;
}

/** Admin playtest override: force a difficulty tier and reshuffle via `nonce`.
 *  A playtest board is ephemeral — no pin, no saved progress, no recorded result. */
export interface BranchesDevOpts {
  tier: number;
  nonce: number;
}

export interface BranchesResult {
  correct: number;
  total: number;
  hinted: number;
  peeked: number;
  mistakes: number;
}

export interface UseBranchesGame {
  board: BranchesBoard | null;
  date: string;
  tier: number;
  /** True once today's real board is resolved (restored or just now) and no
   *  playtest override is active — the daily is locked until tomorrow. */
  locked: boolean;
  /** slotId → the species id currently placed there (only filled slots present).
   *  Placements are moved around freely; nothing is graded until submit. */
  placements: Record<string, string>;
  /** Slot ids CONFIRMED correct (frozen): locked by a correct submit or a hint.
   *  A locked slot can't be moved, and its species has left the tray for good. */
  lockedSlots: string[];
  /** Slot ids revealed via a hint (a subset of lockedSlots; count against score). */
  hints: string[];
  /** Species (slot) ids the player looked up on Wikipedia while playing — each
   *  forfeits that slot's credit, like a hint. */
  peeked: string[];
  /** Wrong submissions committed so far (against the budget). */
  mistakes: number;
  /** Wrong submissions allowed before the board is lost (1 Mon–Wed, 2 Thu–Sun). */
  allowance: number;
  /** True while playing and sitting at the limit: the next wrong submit ends it. */
  oneAway: boolean;
  /** Slots that were wrong on the last submit, for a transient red flash. */
  wrongSlots: string[];
  /** Species ids still in the tray (not yet placed), in display order. */
  tray: string[];
  /** The tray species the player has picked up, or null. */
  held: string | null;
  status: BranchesStatus;
  /** Post-resolution tally (null until resolved). */
  result: BranchesResult | null;
  /** True once resolved AND every slot ended correct within budget. */
  won: boolean;
  /** Pick up / drop a tray species. */
  hold: (id: string) => void;
  /** Place the held species at a slot (or pick up the slot's current species). */
  placeAt: (slotId: string) => void;
  /** Place a specific species at a slot (drag-and-drop). */
  place: (slotId: string, speciesId: string) => void;
  /** Return a placed species to the tray (drag a filled slot away / clear it). */
  clearSlot: (slotId: string) => void;
  /** Reveal one unsolved slot's answer (locks it; costs score, not a mistake). */
  hint: () => void;
  /** Record that the player looked up a to-place species (penalises its slot). */
  peek: (speciesId: string) => void;
  /** Grade the full board: correct slots lock in, a wrong board costs a mistake,
   *  and going over the budget ends it as a loss. */
  submit: () => void;
  canSubmit: boolean;
  /** Test bench: place every species correctly and finish (never recorded). */
  solve: () => void;
}

/** Tally correct slots, split by help used: a hint forfeits the whole point, a
 *  Wikipedia peek only half (the summary may not even name the family). A slot
 *  that was both hinted and peeked counts as hinted (the stronger penalty). */
function tally(board: BranchesBoard, placements: Record<string, string>, hints: string[], peeked: string[]) {
  const H = new Set(hints), P = new Set(peeked);
  let correct = 0, hinted = 0, peekedCorrect = 0;
  for (const s of board.slotIds) {
    if (placements[s] !== s) continue;
    correct++;
    if (H.has(s)) hinted++;
    else if (P.has(s)) peekedCorrect++;
  }
  return { correct, total: board.slotIds.length, hinted, peeked: peekedCorrect };
}

function boardSig(b: BranchesBoard | null): string {
  return b ? JSON.stringify({ t: b.tier, r: b.rootId, s: b.slotIds, a: b.anchorIds, ry: b.tray }) : "";
}

export function useBranchesGame(
  tree: Tree | null,
  onComplete?: (r: BranchesComplete) => void,
  dev?: BranchesDevOpts | null,
  /** The signed-in player's id, or null. When set, an already-played board is
   *  restored (locked) from the server, so playing one device/domain blocks a
   *  replay on another — matching Lineage. */
  userId?: string | null
): UseBranchesGame {
  const date = todayKey();
  const devActive = !!dev;
  const devOpts = dev ? { tier: dev.tier, seed: dev.nonce > 0 ? `n${dev.nonce}` : "" } : undefined;
  const computed = useMemo(
    () => (tree ? branchesBoardFor(tree, date, devOpts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tree, date, devActive, dev?.tier, dev?.nonce]
  );
  const [pinned, setPinned] = useState<BranchesBoard | null>(null);
  const board = pinned ?? computed;
  const allowance = board ? branchesAllowance(board.tier) : 1;

  // A frozen pin takes over only if it differs from the freshly computed board —
  // and never under a playtest override (that board is generated fresh).
  useEffect(() => {
    if (!tree || devActive) { setPinned(null); return; }
    let live = true;
    fetchPinnedPuzzle("branches", date).then((p) => {
      if (!live) return;
      const frozen = p ? rebuildBranches(date, p) : null;
      setPinned(frozen && boardSig(frozen) !== boardSig(computed) ? frozen : null);
    });
    return () => { live = false; };
  }, [tree, date, computed, devActive]);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [placements, setPlacements] = useState<Record<string, string>>({});
  const [lockedSlots, setLockedSlots] = useState<string[]>([]);
  const [hints, setHints] = useState<string[]>([]);
  const [peeked, setPeeked] = useState<string[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [held, setHeld] = useState<string | null>(null);
  const [status, setStatus] = useState<BranchesStatus>("playing");
  const [result, setResult] = useState<BranchesResult | null>(null);
  const [wrongSlots, setWrongSlots] = useState<string[]>([]);
  const wrongTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Signature of the board the current state has been restored for. The save
  // effect refuses to persist until this matches the live board, so a render that
  // carries the previous board's finished state (e.g. an open tab crossing the
  // 09:00 rollover) can't write that stale result under the new day's key before
  // the restore effect below resets it.
  const [hydratedSig, setHydratedSig] = useState<string | null>(null);

  // (Re)initialise when the board changes, restoring a same-day attempt. A
  // playtest board is always fresh — it ignores (and never writes) saved progress.
  useEffect(() => {
    if (!board) return;
    const prog = devActive ? null : loadBranchesProgress();
    if (prog && prog.date === date) {
      const p = prog.placements ?? {};
      setPlacements(p);
      setLockedSlots(prog.locked ?? []);
      setHints(prog.hints ?? []);
      setPeeked(prog.peeked ?? []);
      setMistakes(prog.mistakes ?? 0);
      setStatus(prog.status ?? "playing");
      setResult(prog.status === "done"
        ? { ...tally(board, p, prog.hints ?? [], prog.peeked ?? []), mistakes: prog.mistakes ?? 0 }
        : null);
    } else {
      setPlacements({});
      setLockedSlots([]);
      setHints([]);
      setPeeked([]);
      setMistakes(0);
      setStatus("playing");
      setResult(null);
    }
    setHeld(null);
    setWrongSlots([]);
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
      const saved = loadBranchesProgress();
      if (saved && saved.date === date && saved.status === "done") return;
    }
    saveBranchesProgress({ date, placements, locked: lockedSlots, hints, peeked, mistakes, status });
  }, [board, date, devActive, placements, lockedSlots, hints, peeked, mistakes, status, hydratedSig]);

  // Signed-in players: restore an already-played board from the server (works on
  // any device/domain, where localStorage is empty). Runs once per (user, date),
  // only after local hydration so it can't be clobbered. The row stores only
  // summary stats, so we lock the board in its DONE state showing the solved tree
  // and the recorded tally, not the exact placements. onComplete is NOT re-fired.
  const cloudRestored = useRef<string | null>(null);
  useEffect(() => {
    if (devActive || !board || !userId) return;
    if (hydratedSig !== boardSig(board)) return; // wait for local hydration
    const key = `${userId}:${date}`;
    if (cloudRestored.current === key) return;
    // Local storage already has a finished board (same-device replay): keep it —
    // it carries the real placements/help used, richer than the server summary.
    if (status !== "playing") { cloudRestored.current = key; return; }
    let live = true;
    fetchTodayBranches(date).then((row) => {
      if (!live || !row) return;
      cloudRestored.current = key;
      // We don't keep which slots were left; show the board solved and let the
      // recorded tally drive the verdict.
      const solvedPlacements: Record<string, string> = {};
      for (const s of board.slotIds) solvedPlacements[s] = s;
      setPlacements(solvedPlacements);
      setLockedSlots(board.slotIds.slice());
      setHints([]);
      setPeeked([]);
      setMistakes(row.mistakes);
      setHeld(null);
      setResult({ correct: row.correct, total: row.total, hinted: row.hinted, peeked: row.peeked, mistakes: row.mistakes });
      setStatus("done");
    });
    return () => { live = false; };
  }, [devActive, board, userId, date, hydratedSig, status]);

  useEffect(() => () => { if (wrongTimer.current) clearTimeout(wrongTimer.current); }, []);

  // Tray = board species not currently placed in any slot.
  const tray = useMemo(() => {
    if (!board) return [];
    const placed = new Set(Object.values(placements));
    return board.tray.filter((id) => !placed.has(id));
  }, [board, placements]);

  const hold = useCallback(
    (id: string) => {
      if (status !== "playing") return;
      setHeld((h) => (h === id ? null : id));
    },
    [status]
  );

  const isLocked = useCallback((slotId: string) => lockedSlots.includes(slotId), [lockedSlots]);

  const placeAt = useCallback(
    (slotId: string) => {
      if (status !== "playing" || isLocked(slotId)) return;
      setPlacements((prev) => {
        const next = { ...prev };
        if (held) {
          // Placing the held species here. Free it from any other (unlocked) slot
          // first, and return whatever sat here to the tray (drop the mapping).
          for (const k of Object.keys(next)) if (next[k] === held && !lockedSlots.includes(k)) delete next[k];
          next[slotId] = held;
          return next;
        }
        // Nothing held: pick up whatever is in this slot (removing it).
        if (next[slotId]) { setHeld(next[slotId]); delete next[slotId]; }
        return next;
      });
      if (held) setHeld(null);
    },
    [status, held, lockedSlots, isLocked]
  );

  const place = useCallback(
    (slotId: string, speciesId: string) => {
      if (status !== "playing" || isLocked(slotId)) return;
      setPlacements((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) if (next[k] === speciesId && !lockedSlots.includes(k)) delete next[k];
        next[slotId] = speciesId;
        return next;
      });
      setHeld(null);
    },
    [status, lockedSlots, isLocked]
  );

  const clearSlot = useCallback(
    (slotId: string) => {
      if (status !== "playing" || isLocked(slotId)) return;
      setPlacements((prev) => {
        if (!prev[slotId]) return prev;
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
    },
    [status, isLocked]
  );

  const hint = useCallback(() => {
    if (!board || status !== "playing") return;
    // Reveal the first slot that isn't already correct: lock its true species in.
    const target = board.slotIds.find((s) => placements[s] !== s);
    if (!target) return;
    setPlacements((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (next[k] === target && !lockedSlots.includes(k)) delete next[k];
      next[target] = target;
      return next;
    });
    setLockedSlots((l) => (l.includes(target) ? l : [...l, target]));
    setHints((h) => (h.includes(target) ? h : [...h, target]));
    setHeld(null);
  }, [board, status, placements, lockedSlots]);

  // Looking up a to-place species while the game is live forfeits that slot. Only
  // species that must be placed count (anchors and clade labels are free context).
  const peek = useCallback(
    (speciesId: string) => {
      if (status !== "playing" || !board?.slotIds.includes(speciesId)) return;
      setPeeked((p) => (p.includes(speciesId) ? p : [...p, speciesId]));
    },
    [status, board]
  );

  const finish = useCallback(
    (
      finalPlacements: Record<string, string>,
      finalHints: string[],
      finalPeeked: string[],
      finalMistakes: number,
      won: boolean
    ) => {
      if (!board) return;
      setStatus("done");
      setHeld(null);
      const t = tally(board, finalPlacements, finalHints, finalPeeked);
      setResult({ ...t, mistakes: finalMistakes });
      if (!devActive) {
        onCompleteRef.current?.({
          correct: t.correct,
          total: t.total,
          hinted: t.hinted,
          peeked: t.peeked,
          mistakes: finalMistakes,
          won,
          tier: board.tier,
          date,
        });
      }
    },
    [board, date, devActive]
  );

  // Grade the whole board. Every-slot-correct → win. Otherwise it's a wrong board:
  // the correct slots lock in, the wrong tiles bounce back to the tray, and one
  // mistake is spent — going over the budget ends the board as a loss (keeping the
  // slots locked so far as partial credit). Mistakes are only ever counted here.
  const submit = useCallback(() => {
    if (!board || status !== "playing") return;
    const wrong = board.slotIds.filter((s) => placements[s] !== s);
    if (wrong.length === 0) {
      finish(placements, hints, peeked, mistakes, true); // clean board
      return;
    }
    const nextMistakes = mistakes + 1;
    setMistakes(nextMistakes);
    // Flash the wrong slots, then clear them back to the tray for another go.
    setWrongSlots(wrong);
    if (wrongTimer.current) clearTimeout(wrongTimer.current);
    wrongTimer.current = setTimeout(() => setWrongSlots([]), 750);
    if (nextMistakes > allowance) {
      finish(placements, hints, peeked, nextMistakes, false); // over budget — loss (partial credit)
      return;
    }
    // Lock the slots that WERE correct; bounce the wrong tiles back to the tray.
    setLockedSlots((l) => {
      const set = new Set(l);
      for (const s of board.slotIds) if (placements[s] === s) set.add(s);
      return [...set];
    });
    setPlacements((prev) => {
      const next = { ...prev };
      for (const s of wrong) delete next[s];
      return next;
    });
    setHeld(null);
  }, [board, status, placements, hints, peeked, mistakes, allowance, finish]);

  // Test bench only: place every species on its correct slot and finish. onComplete
  // never fires from here, and a playtest board isn't recorded anyway.
  const solve = useCallback(() => {
    if (!board) return;
    const correct: Record<string, string> = {};
    for (const s of board.slotIds) correct[s] = s;
    setPlacements(correct);
    setLockedSlots(board.slotIds.slice());
    setHints([]);
    setPeeked([]);
    setMistakes(0);
    setHeld(null);
    setStatus("done");
    setResult({ ...tally(board, correct, [], []), mistakes: 0 });
  }, [board]);

  const canSubmit = Boolean(board) && status === "playing" && !!board && board.slotIds.every((s) => placements[s]);
  const oneAway = status === "playing" && mistakes === allowance;
  const won = status === "done" && !!result && result.correct === result.total;

  return {
    board,
    date,
    tier: board?.tier ?? 0,
    locked: !devActive && status === "done",
    placements,
    lockedSlots,
    hints,
    peeked,
    mistakes,
    allowance,
    oneAway,
    wrongSlots,
    tray,
    held,
    status,
    result,
    won,
    hold,
    placeAt,
    place,
    clearSlot,
    hint,
    peek,
    submit,
    canSubmit,
    solve,
  };
}
