import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BranchesBoard, Tree } from "../core";
import { todayKey } from "../core/daily";
import { branchesBoardFor } from "../data/branchesDaily";
import { fetchPinnedPuzzle, branchesBoard as rebuildBranches } from "../data/pinnedPuzzles";
import { loadBranchesProgress, saveBranchesProgress } from "../data/branchesProgress";

export type BranchesStatus = "playing" | "done";

/** Fired once, the moment a board is submitted (never on a restored one). */
export interface BranchesComplete {
  correct: number;
  total: number;
  /** Correct slots revealed by a hint (each forfeits a full point). */
  hinted: number;
  /** Correct slots whose species was peeked on Wikipedia (each forfeits half). */
  peeked: number;
  won: boolean; // every slot correct
  tier: number;
  date: string;
}

/** Admin playtest override: force a difficulty tier and reshuffle via `nonce`.
 *  A playtest board is ephemeral — no pin, no saved progress, no recorded result. */
export interface BranchesDevOpts {
  tier: number;
  nonce: number;
}

export interface UseBranchesGame {
  board: BranchesBoard | null;
  date: string;
  tier: number;
  /** True once today's real board is submitted (restored or just now) and no
   *  playtest override is active — the daily is locked until tomorrow. */
  locked: boolean;
  /** slotId → the species id placed there (only filled slots present). */
  placements: Record<string, string>;
  /** Slot ids revealed via a hint (locked, count against the score). */
  hints: string[];
  /** Species (slot) ids the player looked up on Wikipedia while playing — each
   *  forfeits that slot's credit, like a hint. */
  peeked: string[];
  /** Species ids still in the tray (not yet placed), in display order. */
  tray: string[];
  /** The tray species the player has picked up, or null. */
  held: string | null;
  status: BranchesStatus;
  /** Post-submit tally (null until submitted). */
  result: { correct: number; total: number; hinted: number; peeked: number } | null;
  /** Pick up / drop a tray species. */
  hold: (id: string) => void;
  /** Place the held species at a slot (or pick up the slot's current species). */
  placeAt: (slotId: string) => void;
  /** Place a specific species at a slot (drag-and-drop). */
  place: (slotId: string, speciesId: string) => void;
  /** Return a placed species to the tray (drag a filled slot away / clear it). */
  clearSlot: (slotId: string) => void;
  /** Reveal one unsolved slot's answer (costs score). */
  hint: () => void;
  /** Record that the player looked up a to-place species (penalises its slot). */
  peek: (speciesId: string) => void;
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
  dev?: BranchesDevOpts | null
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
  const [hints, setHints] = useState<string[]>([]);
  const [peeked, setPeeked] = useState<string[]>([]);
  const [held, setHeld] = useState<string | null>(null);
  const [status, setStatus] = useState<BranchesStatus>("playing");
  const [result, setResult] = useState<{ correct: number; total: number; hinted: number; peeked: number } | null>(null);

  // (Re)initialise when the board changes, restoring a same-day attempt. A
  // playtest board is always fresh — it ignores (and never writes) saved progress.
  useEffect(() => {
    if (!board) return;
    const prog = devActive ? null : loadBranchesProgress();
    if (prog && prog.date === date) {
      setPlacements(prog.placements ?? {});
      setHints(prog.hints ?? []);
      setPeeked(prog.peeked ?? []);
      setStatus(prog.status ?? "playing");
      if (prog.status === "done") {
        setResult(tally(board, prog.placements ?? {}, prog.hints ?? [], prog.peeked ?? []));
      }
    } else {
      setPlacements({});
      setHints([]);
      setPeeked([]);
      setStatus("playing");
      setResult(null);
    }
    setHeld(null);
  }, [board, date, devActive]);

  // Persist every change against today's board — but never a playtest board.
  useEffect(() => {
    if (!board || devActive) return;
    saveBranchesProgress({ date, placements, hints, peeked, status });
  }, [board, date, devActive, placements, hints, peeked, status]);

  // Tray = board species not yet placed anywhere.
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

  const placeAt = useCallback(
    (slotId: string) => {
      if (status !== "playing" || hints.includes(slotId)) return;
      setPlacements((prev) => {
        const next = { ...prev };
        if (held) {
          // Placing the held species here. Free it from any other slot first, and
          // return whatever sat here to the tray (by simply dropping the mapping).
          for (const k of Object.keys(next)) if (next[k] === held) delete next[k];
          next[slotId] = held;
          return next;
        }
        // Nothing held: pick up whatever is in this slot (removing it).
        if (next[slotId]) { setHeld(next[slotId]); delete next[slotId]; }
        return next;
      });
      if (held) setHeld(null);
    },
    [status, held, hints]
  );

  const place = useCallback(
    (slotId: string, speciesId: string) => {
      if (status !== "playing" || hints.includes(slotId)) return;
      setPlacements((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) if (next[k] === speciesId) delete next[k]; // move from any prior slot
        next[slotId] = speciesId;
        return next;
      });
      setHeld(null);
    },
    [status, hints]
  );

  const clearSlot = useCallback(
    (slotId: string) => {
      if (status !== "playing" || hints.includes(slotId)) return;
      setPlacements((prev) => {
        if (!prev[slotId]) return prev;
        const next = { ...prev };
        delete next[slotId];
        return next;
      });
    },
    [status, hints]
  );

  const hint = useCallback(() => {
    if (!board || status !== "playing") return;
    // Reveal the first slot that isn't already correct: place its true species.
    const target = board.slotIds.find((s) => placements[s] !== s);
    if (!target) return;
    setPlacements((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (next[k] === target) delete next[k]; // free the species if misplaced
      next[target] = target;
      return next;
    });
    setHints((h) => (h.includes(target) ? h : [...h, target]));
    setHeld(null);
  }, [board, status, placements]);

  // Looking up a to-place species while the game is live forfeits that slot. Only
  // species that must be placed count (anchors and clade labels are free context).
  const peek = useCallback(
    (speciesId: string) => {
      if (status !== "playing" || !board?.slotIds.includes(speciesId)) return;
      setPeeked((p) => (p.includes(speciesId) ? p : [...p, speciesId]));
    },
    [status, board]
  );

  // Test bench only: place every species on its correct slot and finish. onComplete
  // never fires from here, and a playtest board isn't recorded anyway.
  const solve = useCallback(() => {
    if (!board) return;
    const correct: Record<string, string> = {};
    for (const s of board.slotIds) correct[s] = s;
    setPlacements(correct);
    setHints([]);
    setPeeked([]);
    setHeld(null);
    setStatus("done");
    setResult(tally(board, correct, [], []));
  }, [board]);

  const canSubmit = Boolean(board) && status === "playing" && tray.length === 0;

  const submit = useCallback(() => {
    if (!board || status !== "playing") return;
    const t = tally(board, placements, hints, peeked);
    setStatus("done");
    setResult(t);
    // A playtest board is never recorded (it would corrupt real standings).
    if (!devActive) {
      onCompleteRef.current?.({
        correct: t.correct,
        total: t.total,
        hinted: t.hinted,
        peeked: t.peeked,
        won: t.correct === t.total,
        tier: board.tier,
        date,
      });
    }
  }, [board, status, placements, hints, peeked, date, devActive]);

  return {
    board,
    date,
    tier: board?.tier ?? 0,
    locked: !devActive && status === "done",
    placements,
    hints,
    tray,
    held,
    status,
    result,
    peeked,
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
