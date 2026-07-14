/** Browser-local stats, split cleanly into two worlds:
 *   • DAILY   — the shared, ranked puzzle. Everything (streaks, points, per-clade
 *               scoring) derives from `history`, which stores one entry per date
 *               tagged with its clade group. Points mirror the leaderboard.
 *   • PRACTICE — free play. Self-chosen difficulty carries no leaderboard weight,
 *               so it has no score; we track only games + win-rate per clade.
 *  No accounts, no network — all from localStorage (optionally synced). */

import { CLADE_GROUPS, cladeGroup, OTHER_GROUP } from "./clades";
import { gamePoints, kinshipPoints, branchesPoints } from "./score";
import { supabase } from "./supabase";

export interface DailyEntry {
  status: "won" | "gaveup";
  guesses: number;
  hints: number;
  tier: number;
  /** Clade group id (added v3). Optional only for entries migrated from v2. */
  group?: string;
}

/** One finished Kinship (grid) daily. Points scale down with mistakes; a loss
 *  (four mistakes) scores zero. Added in stats v4. */
export interface KinshipEntry {
  status: "won" | "lost";
  mistakes: number;
  tier: number;
}

/** One finished Branches daily. Partial credit for correct placements; a hint
 *  forfeits a whole one, a peek half. `won` = every slot correct. Added v5. */
export interface BranchesEntry {
  won: boolean;
  correct: number;
  total: number;
  hinted: number;
  peeked: number;
  tier: number;
}

/** Free-play tally per clade group (practice is unranked → no points). */
interface CladeFree {
  played: number;
  wins: number;
}

export interface StatsStore {
  version: 5;
  /** date (YYYY-MM-DD) -> the Lineage daily result (drives ALL daily stats). */
  history: Record<string, DailyEntry>;
  /** group id -> free-play tally (drives ALL practice stats). */
  clades: Record<string, CladeFree>;
  /** date (YYYY-MM-DD) -> the Kinship daily result (drives ALL Kinship stats). */
  kinship: Record<string, KinshipEntry>;
  /** date (YYYY-MM-DD) -> the Branches daily result (drives ALL Branches stats). */
  branches: Record<string, BranchesEntry>;
}

/** Per-clade DAILY performance — score-based. */
export interface GroupScore {
  id: string;
  label: string;
  icon: string;
  played: number;
  wins: number;
  winPct: number;
  /** Average leaderboard points per daily game in this group. */
  avgPoints: number;
  /** Total leaderboard points earned in this group. */
  totalPoints: number;
}

/** Per-clade PRACTICE performance — win-rate only (unranked). */
export interface GroupWin {
  id: string;
  label: string;
  icon: string;
  played: number;
  wins: number;
  winPct: number;
}

export interface DailyStats {
  played: number;
  wins: number;
  winPct: number;
  currentStreak: number;
  maxStreak: number;
  /** Play dates ascending — index N-1 is when the "N puzzles" badge was earned. */
  playedDates: string[];
  /** Win dates ascending — index N-1 is when the "N solved" badge was earned. */
  solvedDates: string[];
  /** Last winning day of the best streak — when that streak badge was earned. */
  bestStreakEnd: string | null;
  /** Leaderboard points (mirrors the server): lifetime total, per-game avg, best. */
  points: { total: number; avg: number; best: number };
  /** Per-clade scoring, strongest first is marked via strengthId. */
  groups: GroupScore[];
  /** id of the group you score highest in (by avg points, ≥3 games), or null. */
  strengthId: string | null;
}

export interface PracticeStats {
  played: number;
  wins: number;
  winPct: number;
  groups: GroupWin[];
}

/** Kinship (grid) daily performance — ranked, score-based. */
export interface KinshipStats {
  played: number;
  wins: number;
  /** Wins with zero mistakes (perfect boards) — drives the ✨ flawless badge. */
  flawless: number;
  winPct: number;
  currentStreak: number;
  maxStreak: number;
  /** Ascending dates behind each milestone badge's earned-on lookup. */
  playedDates: string[];
  solvedDates: string[];
  flawlessDates: string[];
  bestStreakEnd: string | null;
  points: { total: number; avg: number; best: number };
}

/** Branches daily performance — ranked, score-based. Streak is a plain run of
 *  consecutive full-correct days (no give-up in Branches). */
export interface BranchesStats {
  played: number;
  wins: number;
  /** Full boards done with no hint and no peek — drives the ✨ flawless badge. */
  flawless: number;
  winPct: number;
  currentStreak: number;
  maxStreak: number;
  playedDates: string[];
  solvedDates: string[];
  flawlessDates: string[];
  bestStreakEnd: string | null;
  points: { total: number; avg: number; best: number };
}

export interface DerivedStats {
  daily: DailyStats;
  practice: PracticeStats;
  kinship: KinshipStats;
  branches: BranchesStats;
}

const KEY = "cladensis.stats.v1"; // key kept stable; payload is versioned inside

const emptyStore = (): StatsStore => ({ version: 5, history: {}, clades: {}, kinship: {}, branches: {} });

/** Accept a raw payload (localStorage or DB) and coerce to a valid store. Lineage
 *  history carries over from any prior version; v1/v2 clade tallies had an
 *  incompatible, daily+free-mixed shape so they reset; the Kinship history arrived
 *  in v4 and Branches in v5, so older stores just start those empty. */
function migrate(parsed: unknown): StatsStore {
  const s = parsed as {
    version?: number;
    history?: Record<string, DailyEntry>;
    clades?: Record<string, CladeFree>;
    kinship?: Record<string, KinshipEntry>;
    branches?: Record<string, BranchesEntry>;
  } | null;
  if (!s || typeof s !== "object") return emptyStore();
  const v = s.version ?? 0;
  const history = v >= 1 && s.history ? s.history : {};
  const clades = v >= 3 && s.clades ? s.clades : {};
  const kinship = v >= 4 && s.kinship ? s.kinship : {};
  const branches = v >= 5 && s.branches ? s.branches : {};
  return { version: 5, history, clades, kinship, branches };
}

export function loadStore(): StatsStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch {
    /* corrupt or unavailable storage — start fresh */
  }
  return emptyStore();
}

export function saveStore(store: StatsStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked — best-effort */
  }
}

/** Wipe this device's local stats, returning the fresh empty store. Used on
 *  sign-out: the account's data lives in the cloud, so clearing the device keeps
 *  the next account (or a brand-new registration) from inheriting these stats. */
export function clearStore(): StatsStore {
  const empty = emptyStore();
  saveStore(empty);
  return empty;
}

/** Coerce an untrusted blob (e.g. from the DB) into a valid v4 store. */
export function coerceStore(raw: unknown): StatsStore {
  return migrate(raw);
}

export function isEmptyStore(store: StatsStore): boolean {
  return (
    Object.keys(store.history).length === 0 &&
    Object.keys(store.clades).length === 0 &&
    Object.keys(store.kinship).length === 0 &&
    Object.keys(store.branches).length === 0
  );
}

// ---- Cloud sync (only when Supabase configured + signed in) ----

/** The signed-in player's stats row, or null if none/not signed in. */
export async function fetchCloudStats(): Promise<StatsStore | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from("player_stats").select("stats").maybeSingle();
    if (error || !data) return null;
    return coerceStore(data.stats);
  } catch {
    return null;
  }
}

/** Upsert the signed-in player's full stats blob. */
export async function pushCloudStats(store: StatsStore): Promise<void> {
  if (!supabase) return;
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    await supabase
      .from("player_stats")
      .upsert({ user_id: uid, stats: store, updated_at: new Date().toISOString() });
  } catch {
    /* best-effort */
  }
}

/** Apply a daily result onto a store IN PLACE, once per date (so replays don't
 *  inflate). The entry is tagged with its clade group so per-clade daily stats
 *  derive straight from history. */
export function applyDaily(store: StatsStore, dateKey: string, entry: DailyEntry, groupId: string): StatsStore {
  if (!store.history[dateKey]) store.history[dateKey] = { ...entry, group: groupId };
  return store;
}

/** Apply a finished free-play game onto a store IN PLACE (practice tally only). */
export function applyFree(store: StatsStore, entry: DailyEntry, groupId: string): StatsStore {
  const c = store.clades[groupId] ?? { played: 0, wins: 0 };
  c.played++;
  if (entry.status === "won") c.wins++;
  store.clades[groupId] = c;
  return store;
}

/** Record a daily result to local storage, once per date. */
export function recordDaily(dateKey: string, entry: DailyEntry, groupId: string): StatsStore {
  const store = applyDaily(loadStore(), dateKey, entry, groupId);
  saveStore(store);
  return store;
}

/** Record a finished free-play game to local storage — practice tally only. */
export function recordFree(entry: DailyEntry, groupId: string): StatsStore {
  const store = applyFree(loadStore(), entry, groupId);
  saveStore(store);
  return store;
}

/** Apply a finished Kinship daily onto a store IN PLACE, once per date. */
export function applyKinship(store: StatsStore, dateKey: string, entry: KinshipEntry): StatsStore {
  if (!store.kinship[dateKey]) store.kinship[dateKey] = { ...entry };
  return store;
}

/** Record a Kinship daily result to local storage, once per date. */
export function recordKinship(dateKey: string, entry: KinshipEntry): StatsStore {
  const store = applyKinship(loadStore(), dateKey, entry);
  saveStore(store);
  return store;
}

/** Apply a finished Branches daily onto a store IN PLACE, once per date. */
export function applyBranches(store: StatsStore, dateKey: string, entry: BranchesEntry): StatsStore {
  if (!store.branches[dateKey]) store.branches[dateKey] = { ...entry };
  return store;
}

/** Record a Branches daily result to local storage, once per date. */
export function recordBranches(dateKey: string, entry: BranchesEntry): StatsStore {
  const store = applyBranches(loadStore(), dateKey, entry);
  saveStore(store);
  return store;
}

function prevDay(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function nextDay(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const pct = (wins: number, played: number) => (played ? Math.round((wins / played) * 100) : 0);
const orderedIds = [...CLADE_GROUPS.map((g) => g.id), OTHER_GROUP.id];

/** A give-up keeps (doesn't break) the daily streak once the player has made a
 *  real attempt — this many guesses. Some dailies are genuinely hard, so a
 *  well-fought give-up shouldn't wipe a long streak. Tunable in one place. */
export const STREAK_SAVE_MIN_GUESSES = 5;

/** Does this day keep the streak alive? A win always does; a give-up does only
 *  after a real attempt. Either way it doesn't *add* to the streak (only wins
 *  do) — a qualifying give-up just bridges the run instead of breaking it. */
const keepsStreak = (e: DailyEntry) =>
  e.status === "won" || (e.status === "gaveup" && e.guesses >= STREAK_SAVE_MIN_GUESSES);

/** Resolve a daily's clade group from its date (the daily is deterministic, so
 *  this recovers the group for history entries recorded before groups were
 *  stored). Returns null when it can't (e.g. tree not loaded yet). */
export type DailyGroupResolver = (dateKey: string) => string | null;

function deriveDaily(
  history: Record<string, DailyEntry>,
  todayKey: string,
  groupForDate?: DailyGroupResolver
): DailyStats {
  const dates = Object.keys(history);
  const played = dates.length;
  const wins = dates.filter((d) => history[d].status === "won").length;

  let total = 0;
  let best = 0;
  // Accumulate per-clade daily scoring from the tagged history entries.
  const tally: Record<string, { played: number; wins: number; pts: number }> = {};
  for (const d of dates) {
    const e = history[d];
    const p = gamePoints(e.status === "won", e.tier, e.guesses, e.hints);
    total += p;
    if (p > best) best = p;
    // Prefer the group tagged at play time; fall back to recomputing from the
    // date for entries recorded before groups were stored.
    const gid = e.group ?? groupForDate?.(d) ?? null;
    if (gid) {
      const t = (tally[gid] ??= { played: 0, wins: 0, pts: 0 });
      t.played++;
      if (e.status === "won") t.wins++;
      t.pts += p;
    }
  }

  // Walk back over an unbroken run of streak-keeping days; only wins add to the
  // count, so a qualifying give-up bridges the run without inflating it.
  let currentStreak = 0;
  let cursor = history[todayKey] ? todayKey : prevDay(todayKey);
  while (history[cursor] && keepsStreak(history[cursor])) {
    if (history[cursor].status === "won") currentStreak++;
    cursor = prevDay(cursor);
  }

  let maxStreak = 0;
  let bestStreakEnd: string | null = null;
  const keptSet = new Set(dates.filter((d) => keepsStreak(history[d])));
  for (const d of keptSet) {
    if (keptSet.has(prevDay(d))) continue; // only start at a run's first day
    let len = 0;
    let lastWin: string | null = null;
    let c: string = d;
    while (keptSet.has(c)) {
      if (history[c].status === "won") { len++; lastWin = c; }
      c = nextDay(c);
    }
    if (len > maxStreak) { maxStreak = len; bestStreakEnd = lastWin; }
  }

  const groups: GroupScore[] = orderedIds
    .filter((id) => tally[id]?.played)
    .map((id) => {
      const t = tally[id];
      const g = cladeGroup(id);
      return {
        id,
        label: g.label,
        icon: g.icon,
        played: t.played,
        wins: t.wins,
        winPct: pct(t.wins, t.played),
        avgPoints: Math.round(t.pts / t.played),
        totalPoints: Math.round(t.pts),
      };
    });

  // Strength = highest average points among groups with at least 3 daily games.
  let strengthId: string | null = null;
  let bestAvg = -1;
  for (const g of groups) {
    if (g.played >= 3 && g.avgPoints > bestAvg) {
      bestAvg = g.avgPoints;
      strengthId = g.id;
    }
  }

  return {
    played,
    wins,
    winPct: pct(wins, played),
    currentStreak,
    maxStreak,
    playedDates: [...dates].sort(),
    solvedDates: dates.filter((d) => history[d].status === "won").sort(),
    bestStreakEnd,
    points: { total, avg: played ? Math.round(total / played) : 0, best },
    groups,
    strengthId,
  };
}

function derivePractice(clades: Record<string, CladeFree>): PracticeStats {
  const groups: GroupWin[] = orderedIds
    .filter((id) => clades[id]?.played)
    .map((id) => {
      const t = clades[id];
      const g = cladeGroup(id);
      return { id, label: g.label, icon: g.icon, played: t.played, wins: t.wins, winPct: pct(t.wins, t.played) };
    });
  const played = groups.reduce((s, g) => s + g.played, 0);
  const wins = groups.reduce((s, g) => s + g.wins, 0);
  return { played, wins, winPct: pct(wins, played), groups };
}

/** Kinship (grid) daily stats. Streak is a plain run of consecutive daily wins —
 *  there's no give-up in Kinship, so no streak-save nuance. */
function deriveKinship(kinship: Record<string, KinshipEntry>, todayKey: string): KinshipStats {
  const dates = Object.keys(kinship);
  const played = dates.length;
  const wins = dates.filter((d) => kinship[d].status === "won").length;
  const flawless = dates.filter((d) => kinship[d].status === "won" && kinship[d].mistakes === 0).length;

  let total = 0;
  let best = 0;
  for (const d of dates) {
    const e = kinship[d];
    const p = kinshipPoints(e.status === "won", e.tier, e.mistakes);
    total += p;
    if (p > best) best = p;
  }

  let currentStreak = 0;
  let cursor = kinship[todayKey] ? todayKey : prevDay(todayKey);
  while (kinship[cursor]?.status === "won") {
    currentStreak++;
    cursor = prevDay(cursor);
  }

  let maxStreak = 0;
  let bestStreakEnd: string | null = null;
  const wonSet = new Set(dates.filter((d) => kinship[d].status === "won"));
  for (const d of wonSet) {
    if (wonSet.has(prevDay(d))) continue;
    let len = 0;
    let end: string | null = null;
    let c: string = d;
    while (wonSet.has(c)) {
      len++;
      end = c;
      c = nextDay(c);
    }
    if (len > maxStreak) { maxStreak = len; bestStreakEnd = end; }
  }

  return {
    played,
    wins,
    flawless,
    winPct: pct(wins, played),
    currentStreak,
    maxStreak,
    playedDates: [...dates].sort(),
    solvedDates: dates.filter((d) => kinship[d].status === "won").sort(),
    flawlessDates: dates.filter((d) => kinship[d].status === "won" && kinship[d].mistakes === 0).sort(),
    bestStreakEnd,
    points: { total, avg: played ? Math.round(total / played) : 0, best },
  };
}

/** Branches daily stats. Like Kinship: a plain run of consecutive full-correct
 *  wins (there's no give-up in Branches). "flawless" = won with no hint or peek. */
function deriveBranches(branches: Record<string, BranchesEntry>, todayKey: string): BranchesStats {
  const dates = Object.keys(branches);
  const played = dates.length;
  const isWin = (d: string) => branches[d].won;
  const isFlawless = (d: string) => branches[d].won && branches[d].hinted === 0 && branches[d].peeked === 0;
  const wins = dates.filter(isWin).length;
  const flawless = dates.filter(isFlawless).length;

  let total = 0;
  let best = 0;
  for (const d of dates) {
    const e = branches[d];
    const p = branchesPoints(e.tier, e.correct, e.total, e.hinted + 0.5 * e.peeked);
    total += p;
    if (p > best) best = p;
  }

  let currentStreak = 0;
  let cursor = branches[todayKey] ? todayKey : prevDay(todayKey);
  while (branches[cursor]?.won) {
    currentStreak++;
    cursor = prevDay(cursor);
  }

  let maxStreak = 0;
  let bestStreakEnd: string | null = null;
  const wonSet = new Set(dates.filter(isWin));
  for (const d of wonSet) {
    if (wonSet.has(prevDay(d))) continue;
    let len = 0;
    let end: string | null = null;
    let c: string = d;
    while (wonSet.has(c)) {
      len++;
      end = c;
      c = nextDay(c);
    }
    if (len > maxStreak) { maxStreak = len; bestStreakEnd = end; }
  }

  return {
    played,
    wins,
    flawless,
    winPct: pct(wins, played),
    currentStreak,
    maxStreak,
    playedDates: [...dates].sort(),
    solvedDates: dates.filter(isWin).sort(),
    flawlessDates: dates.filter(isFlawless).sort(),
    bestStreakEnd,
    points: { total, avg: played ? Math.round(total / played) : 0, best },
  };
}

export function derive(store: StatsStore, todayKey: string, groupForDate?: DailyGroupResolver): DerivedStats {
  // Tolerate partial stores (older shapes / hand-built test fixtures): a missing
  // section just derives as empty.
  return {
    daily: deriveDaily(store.history ?? {}, todayKey, groupForDate),
    practice: derivePractice(store.clades ?? {}),
    kinship: deriveKinship(store.kinship ?? {}, todayKey),
    branches: deriveBranches(store.branches ?? {}, todayKey),
  };
}
