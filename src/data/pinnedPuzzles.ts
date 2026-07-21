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
import { DAILY_EPOCH, todayKey } from "../core/daily";
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
  // v2: the in-set tree was rebuilt Wikipedia-first (different species set, names, and
  // pageview prominence), so the daily answer a date resolves to changed.
  //   v3: the daily is now a weekday RESOLUTION ramp (family Mon/Tue → genus Wed → species
  //   Thu–Sun; assist off at the weekend), scope is a decoupled spaced variety draw, the
  //   answer pick pre-filters to rank-eligible species on family/genus days, and winTargetId
  //   no longer balloons past a mis-ranked ancestor (Sauria). Scope/winWithin/assist/answer
  //   all moved for most dates. Re-pin un-played future dates (Admin ▸ Pins ▸ Re-pin, or
  //   npm run pin -- --force); past pins stay frozen.
  version: 3,
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
  // v5: difficulty = MEDIAN PAIRWISE MRCA separation of the four groups (maxed with
  // obscurity), reveal mode (name+pic → name-only → picture-only) the primary lever;
  // the pool was expanded (augment adds out-of-set genera + whole families) and members
  // are now sampled weighted by pageviews. Board identity changed → re-pin un-played
  // future dates (Admin ▸ Pins ▸ Re-pin); past pins stay frozen.
  //   v6: anti-repeat now bars any INDIVIDUAL group (clade) from recurring within a week
  //   — not just the exact four-category SET — so back-to-back boards no longer share 3 of
  //   4 groups (and their famous species); and the anti-repeat replay is anchored before
  //   the pre-launch days (was DAILY_EPOCH, which gave pre-launch previews empty history).
  //   The board sequence shifted for most dates → re-pin un-played future dates.
  version: 6,
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
  // v2: an anchor (prefilled tree species) may no longer share a name word with any
  // answer tile ("Gould's wattled bat" beside "Chocolate wattled bat"), which gave
  // the placement away; a group with no clean anchor now goes unanchored.
  //   v2.1/2.2 (same stored version — nothing was pinned at v2 yet): worked-example
  //   anchors sit in a DIFFERENT branch of the group than the slot (never the
  //   answer's own final clade); labelled CONTEXT CLADES (non-answer families, each
  //   with a representative species) fill the tree and teach by elimination; the
  //   collision rule is now distinctive-word (only a word unique to one answer is a
  //   give-away, so all-"squid" boards still populate); and container choice is
  //   depth-biased by tier (easy = spread-out groups, hard = tight siblings).
  //   v3: the shared Kinship/Branches rich tree was expanded (augment now adds out-of-set
  //   genera AND whole families via OTL topology), so the container/species pool — and
  //   thus which boards a date produces — changed.
  //   v4: Kinship-parity + fairness overhaul. (a) NO CROSS-CLASS boards — a container
  //   spanning ≥2 classes (Amniota/Bilateria) can't host a board (broadGroupOf), and the
  //   day's class is LOCKED once & chosen uniformly so no lineage floods a tier (fixes the
  //   plant/mammal bias); plants/molluscs gated to Thu+, spiders to the weekend. (b)
  //   Difficulty by MRCA-RANK separation (shared medianSeparationTier), not raw depth. (c)
  //   SHARED-WORD FLOOR on the tray (2→4) counted on HEAD NOUNS ("sparrow", not "-tailed").
  //   (d) Slot/anchor species weighted-random by pageviews; slots are common-named only.
  //   Board identity changed at every tier.
  //   v5: worked-example anchors are placed FIRST (before context-clade decoys) and now
  //   sit in the slot's OWN final branch (slotBranchLeaves) — the strongest recognition
  //   hint — so slots are placeable by recognition instead of a cold guess; the anchor
  //   budget is bumped ×1.1 (capped one per slot) to lift easy/mid coverage. The
  //   distinctive-word give-away guard is unchanged. Fixes the near-zero in-group anchor
  //   coverage that made gentle/tricky boards (incl. Daily #1) too hard. Board identity
  //   changed at most tiers → re-pin un-played future dates.
  // Board identity changed → re-pin un-played future dates (Admin ▸ Pins ▸ Re-pin,
  // or npm run pin -- --force); past pins stay frozen.
  version: 5,
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

/** All three games, in display order. */
export const GAMES: Game[] = ["lineage", "kinship", "branches"];

/** The current generator version of every game — what a fresh pin would record. */
export const currentVersions = (): Record<Game, number> => ({
  lineage: puzzleVersion("lineage"),
  kinship: puzzleVersion("kinship"),
  branches: puzzleVersion("branches"),
});

/** The synchronous generator result for a date — the fallback used for instant,
 *  offline render and for un-pinned/future dates. */
export function computePuzzle<G extends Game>(game: G, tree: Tree, date: string): PuzzleByGame[G] | null {
  return RESOLVERS[game].compute(tree, date);
}

const shiftDateKey = (dateKey: string, delta: number): string => {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

// ---- admin: pin index + bulk re-pin (client, via the pin_puzzle RPC) ----

/** One date's pin state: the version each game is pinned at (absent = not pinned). */
export interface PinnedDay {
  date: string;
  versions: Partial<Record<Game, number>>;
}

/** Every pinned row (admin-only; RLS lets admins read future rows), folded to one
 *  entry per date with each game's pinned version. Paginated so it isn't capped at
 *  PostgREST's default 1000-row page. Best-effort — returns [] on any failure. */
export async function fetchPinnedIndex(fromDate: string = DAILY_EPOCH): Promise<PinnedDay[]> {
  if (!supabase) return [];
  const byDate = new Map<string, PinnedDay>();
  const PAGE = 1000;
  try {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabase
        .from("daily_puzzles")
        .select("game, puzzle_date, version")
        .gte("puzzle_date", fromDate)
        .order("puzzle_date")
        .range(offset, offset + PAGE - 1);
      if (error || !data) break;
      for (const r of data as { game: Game; puzzle_date: string; version: number }[]) {
        const d = byDate.get(r.puzzle_date) ?? { date: r.puzzle_date, versions: {} };
        d.versions[r.game] = r.version;
        byDate.set(r.puzzle_date, d);
      }
      if (data.length < PAGE) break;
    }
  } catch {
    return [];
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface RepinProgress {
  done: number;
  total: number;
  failed: number;
}

/** Admin-only: recompute every FUTURE daily for the chosen games with the CURRENT
 *  generators and overwrite its pin via the pin_puzzle() RPC. That RPC refuses any
 *  date ≤ today, and this also skips them client-side, so played/past puzzles (and
 *  their leaderboards) can never be touched — only the not-yet-seen horizon is
 *  refreshed after a generation-logic change. Idempotent per row, so a re-run just
 *  finishes an interrupted pass. Runs with bounded concurrency; reports progress. */
export async function repinFuture(
  tree: Tree,
  opts: {
    from?: string;
    days?: number;
    games?: Game[];
    concurrency?: number;
    onProgress?: (p: RepinProgress) => void;
    /** The rich tree (base + augment). Kinship/Branches boards are generated from
     *  it — pins MUST match what players see, and players play the rich tree. Lineage
     *  always uses the base `tree` (its answer pool is the curated in-set). */
    richTree?: Tree;
  } = {}
): Promise<RepinProgress> {
  const empty = { done: 0, total: 0, failed: 0 };
  if (!supabase) return empty;
  const days = Math.max(1, opts.days ?? 730);
  const games = opts.games?.length ? opts.games : GAMES;
  const start = opts.from ?? DAILY_EPOCH;
  const cutoff = todayKey(); // never write today or earlier (mirrors the RPC guard)

  const jobs: { game: Game; date: string; payload: StoredPayload; version: number }[] = [];
  for (let i = 0; i < days; i++) {
    const date = shiftDateKey(start, i);
    if (date <= cutoff) continue; // future only — the past is frozen
    for (const game of games) {
      // Kinship/Branches generate from the rich tree (what players play); Lineage
      // from the curated base. Fall back to base if no rich tree was supplied.
      const t = game === "lineage" ? tree : opts.richTree ?? tree;
      const p = computePuzzle(game, t, date);
      if (!p) continue;
      jobs.push({ game, date, payload: encodePuzzle(game, p), version: puzzleVersion(game) });
    }
  }

  const total = jobs.length;
  let done = 0;
  let failed = 0;
  const tick = () => opts.onProgress?.({ done, total, failed });
  tick();

  let idx = 0;
  const worker = async () => {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      try {
        const { error } = await supabase!.rpc("pin_puzzle", {
          p_game: job.game,
          p_date: job.date,
          p_payload: job.payload,
          p_version: job.version,
        });
        if (error) failed++;
      } catch {
        failed++;
      }
      done++;
      tick();
    }
  };
  const lanes = Math.max(1, Math.min(opts.concurrency ?? 6, jobs.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  return { done, total, failed };
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
