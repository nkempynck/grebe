// The frozen-puzzle read layer + per-game resolver registry.
//
// Puzzles are a deterministic function of (date, code, taxonomy, seeding), so
// changing any of those retroactively changes what a PAST date resolves to and
// silently breaks old leaderboards. To stop that, once a day has been played its
// puzzle is PINNED in Supabase (daily_puzzles, see supabase/puzzles.sql) and read
// back from there instead of recomputed. Future code/data changes then only move
// dates that aren't pinned yet.
//
// This module is the single source of truth for "what is a game's puzzle": the
// resolver registry is used BOTH by the client read path (below) and by the
// prefill script that writes the pins, so the two can never diverge.
//
// Read-through contract:
//   • computePuzzle(game, tree, date)  — synchronous generator result. Instant,
//     works offline / with no backend. The fallback for un-pinned/future dates.
//   • fetchPinnedPuzzle(game, date)    — the frozen row from Supabase, or null.
//     RLS returns nothing for a date whose day hasn't arrived, so players can't
//     read ahead. Prefer this over computePuzzle when it resolves non-null.

import type { BranchesBoard, GridBoard, Tree } from "../core";
import { resolveDailyRules, dailyAnswerFor } from "./dailySchedule";
import { gridBoardFor } from "./gridDaily";
import { branchesBoardFor } from "./branchesDaily";
import { supabase } from "./supabase";

export type Game = "lineage" | "kinship" | "branches";

/** A Lineage daily, fully frozen: the answer plus the rules the player faced. */
export interface LineagePuzzle {
  answerId: string;
  scopeRootId: string;
  winWithin: number;
  assist: boolean;
  tier: number;
}

/** A Kinship board, frozen by identity (species/clade ids + colour rank + tile
 *  order). Display labels are re-derived from the current tree at read time, so
 *  renaming a clade never changes which puzzle a pinned date is. */
export interface KinshipPuzzle {
  tier: number;
  groups: { cladeId: string; memberIds: string[]; level: number }[];
  tiles: string[];
}

/** A Branches board, frozen by identity (ids only); the drawn skeleton + labels
 *  are re-derived from the current tree at read time, so a relabelling never
 *  changes which puzzle a pinned date is. */
export interface BranchesPuzzle {
  tier: number;
  rootId: string;
  leafIds: string[];
  anchorIds: string[];
  slotIds: string[];
  groupIds: string[];
  tray: string[];
}

export interface PuzzleByGame {
  lineage: LineagePuzzle;
  kinship: KinshipPuzzle;
  branches: BranchesPuzzle;
}

/** How the DB stores a puzzle: the resolved payload, base64'd so a glance in the
 *  Supabase table editor doesn't spoil upcoming answers (obfuscation, not
 *  security — the RLS date-gate is the real wall). */
interface StoredPayload {
  enc: string;
}

// ---- utf8-safe base64 (payloads are a handful of ASCII ids — tiny) ----
function b64encode(s: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
function b64decode(s: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
}

interface Resolver<G extends Game> {
  game: G;
  /** Bump when this game's generation logic changes, so a pin records which
   *  version produced it (diagnostics; the pin itself stays authoritative). */
  version: number;
  /** The canonical puzzle for a date, from the committed generator. Returns null
   *  only if the tree can't field one. This is the fallback AND what the pinner
   *  freezes. */
  compute(tree: Tree, date: string): PuzzleByGame[G] | null;
  encode(p: PuzzleByGame[G]): StoredPayload;
  decode(raw: StoredPayload): PuzzleByGame[G];
}

const lineageResolver: Resolver<"lineage"> = {
  game: "lineage",
  version: 1,
  compute(tree, date) {
    const rules = resolveDailyRules(date);
    return {
      answerId: dailyAnswerFor(tree, date),
      scopeRootId: rules.config.scopeRootId,
      winWithin: rules.config.winWithin,
      assist: rules.assist,
      tier: rules.tier,
    };
  },
  encode: (p) => ({ enc: b64encode(JSON.stringify(p)) }),
  decode: (raw) => JSON.parse(b64decode(raw.enc)) as LineagePuzzle,
};

const kinshipResolver: Resolver<"kinship"> = {
  game: "kinship",
  // v2: harder brutal days — no-giveaway groups (Thu–Sat), no mammals (Sat–Sun),
  // Sunday picture-mode. Board identity changed for those weekdays, so pins written
  // by v1 differ from what v2 generates. Un-played future dates should be re-pinned
  // (npm run pin -- --force --from <today>); past/played pins stay authoritative.
  version: 2,
  compute(tree, date) {
    const board = gridBoardFor(tree, date);
    if (!board) return null;
    return {
      tier: board.tier,
      groups: board.groups.map((g) => ({ cladeId: g.cladeId, memberIds: g.memberIds, level: g.level })),
      tiles: board.tiles,
    };
  },
  encode: (p) => ({ enc: b64encode(JSON.stringify(p)) }),
  decode: (raw) => JSON.parse(b64decode(raw.enc)) as KinshipPuzzle,
};

const branchesResolver: Resolver<"branches"> = {
  game: "branches",
  version: 1,
  compute(tree, date) {
    const board = branchesBoardFor(tree, date);
    if (!board) return null;
    const { tier, rootId, leafIds, anchorIds, slotIds, groupIds, tray } = board;
    return { tier, rootId, leafIds, anchorIds, slotIds, groupIds, tray };
  },
  encode: (p) => ({ enc: b64encode(JSON.stringify(p)) }),
  decode: (raw) => JSON.parse(b64decode(raw.enc)) as BranchesPuzzle,
};

const RESOLVERS: { [G in Game]: Resolver<G> } = {
  lineage: lineageResolver,
  kinship: kinshipResolver,
  branches: branchesResolver,
};

export const puzzleVersion = (game: Game): number => RESOLVERS[game].version;

/** The synchronous generator result for a date — the fallback used for instant,
 *  offline render and for un-pinned/future dates. */
export function computePuzzle<G extends Game>(game: G, tree: Tree, date: string): PuzzleByGame[G] | null {
  return RESOLVERS[game].compute(tree, date);
}

/** Encode a computed puzzle for storage (used by the prefill script + admin edits). */
export function encodePuzzle<G extends Game>(game: G, puzzle: PuzzleByGame[G]): StoredPayload {
  return RESOLVERS[game].encode(puzzle);
}

/** The frozen puzzle for a date from Supabase, or null when there's no backend,
 *  no pinned row, or the day hasn't arrived (RLS hides future rows from players).
 *  Best-effort: never throws — a failed fetch just falls back to computePuzzle. */
export async function fetchPinnedPuzzle<G extends Game>(game: G, date: string): Promise<PuzzleByGame[G] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("daily_puzzles")
      .select("payload")
      .eq("game", game)
      .eq("puzzle_date", date)
      .maybeSingle();
    if (error || !data) return null;
    const payload = (data as { payload: StoredPayload }).payload;
    if (!payload?.enc) return null;
    return RESOLVERS[game].decode(payload);
  } catch {
    return null;
  }
}

// ---- synchronous cache for past-date lookups ----
// Sync callers (per-clade stats grouping, the admin leaderboard label) recompute
// a PAST date's answer from the generator, which would mislabel history after a
// content change. Priming this cache lets them read the FROZEN answer instead,
// while staying synchronous. Absent key = not primed (→ generator fallback);
// a null value = primed and confirmed to have no pin.
const pinCache = new Map<string, unknown>();
const cacheKey = (game: Game, date: string) => `${game}:${date}`;

/** The cached frozen puzzle for a date: the puzzle, `null` if primed with no pin,
 *  or `undefined` if not primed yet (caller should fall back to the generator). */
export function pinnedPuzzleCached<G extends Game>(game: G, date: string): PuzzleByGame[G] | null | undefined {
  const k = cacheKey(game, date);
  return pinCache.has(k) ? (pinCache.get(k) as PuzzleByGame[G] | null) : undefined;
}

/** Prefetch pinned puzzles for many (past) dates into the sync cache above.
 *  Returns true if it cached any NOT-yet-primed date, so a caller can bump a
 *  render key to re-run dependent lookups exactly once (re-calling with the same
 *  dates then returns false — no re-render loop). Best-effort; never throws. */
export async function primePinnedPuzzles<G extends Game>(game: G, dates: string[]): Promise<boolean> {
  if (!supabase) return false;
  const missing = dates.filter((d) => !pinCache.has(cacheKey(game, d)));
  if (missing.length === 0) return false;
  try {
    const { data, error } = await supabase
      .from("daily_puzzles")
      .select("puzzle_date, payload")
      .eq("game", game)
      .in("puzzle_date", missing);
    if (error) return false;
    const found = new Map<string, StoredPayload>();
    for (const row of (data ?? []) as { puzzle_date: string; payload: StoredPayload }[]) {
      found.set(row.puzzle_date, row.payload);
    }
    // Cache a value for EVERY missing date (null when unpinned) so we don't refetch.
    for (const d of missing) {
      const p = found.get(d);
      pinCache.set(cacheKey(game, d), p?.enc ? RESOLVERS[game].decode(p) : null);
    }
    return true;
  } catch {
    return false;
  }
}

/** Rebuild a full BranchesBoard from a frozen or computed BranchesPuzzle. Ids only, so
 *  it's a straight re-hydration; the UI derives the skeleton + labels from the
 *  current tree. */
export function branchesBoard(date: string, p: BranchesPuzzle): BranchesBoard {
  return { date, tier: p.tier, rootId: p.rootId, leafIds: p.leafIds, anchorIds: p.anchorIds, slotIds: p.slotIds, groupIds: p.groupIds, tray: p.tray };
}

/** Rebuild a full GridBoard (with display labels from the current tree) from a
 *  frozen or computed KinshipPuzzle, so the game can render it unchanged. */
export function kinshipBoard(tree: Tree, date: string, p: KinshipPuzzle): GridBoard {
  return {
    date,
    tier: p.tier,
    tiles: p.tiles,
    groups: p.groups.map((g) => {
      const node = tree.byId.get(g.cladeId);
      return {
        cladeId: g.cladeId,
        label: node?.common ?? node?.sciName ?? g.cladeId,
        sciLabel: node?.sciName ?? "",
        memberIds: g.memberIds,
        level: g.level,
      };
    }),
  };
}
