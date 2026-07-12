/** Browser-local stats, split cleanly into two worlds:
 *   • DAILY   — the shared, ranked puzzle. Everything (streaks, points, per-clade
 *               scoring) derives from `history`, which stores one entry per date
 *               tagged with its clade group. Points mirror the leaderboard.
 *   • PRACTICE — free play. Self-chosen difficulty carries no leaderboard weight,
 *               so it has no score; we track only games + win-rate per clade.
 *  No accounts, no network — all from localStorage (optionally synced). */

import { CLADE_GROUPS, cladeGroup, OTHER_GROUP } from "./clades";
import { gamePoints } from "./score";
import { supabase } from "./supabase";

export interface DailyEntry {
  status: "won" | "gaveup";
  guesses: number;
  hints: number;
  tier: number;
  /** Clade group id (added v3). Optional only for entries migrated from v2. */
  group?: string;
}

/** Free-play tally per clade group (practice is unranked → no points). */
interface CladeFree {
  played: number;
  wins: number;
}

export interface StatsStore {
  version: 3;
  /** date (YYYY-MM-DD) -> the daily result (drives ALL daily stats). */
  history: Record<string, DailyEntry>;
  /** group id -> free-play tally (drives ALL practice stats). */
  clades: Record<string, CladeFree>;
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

export interface DerivedStats {
  daily: DailyStats;
  practice: PracticeStats;
}

const KEY = "cladensis.stats.v1"; // key kept stable; payload is versioned inside

const emptyStore = (): StatsStore => ({ version: 3, history: {}, clades: {} });

/** Accept a raw payload (localStorage or DB) and coerce to a valid v3 store.
 *  v1/v2 histories carry over (their daily aggregate still works); their old
 *  clade tallies had an incompatible, daily+free-mixed shape, so they reset. */
function migrate(parsed: unknown): StatsStore {
  const s = parsed as {
    version?: number;
    history?: Record<string, DailyEntry>;
    clades?: Record<string, CladeFree>;
  } | null;
  if (!s) return emptyStore();
  if (s.version === 3 && s.history && s.clades) {
    return { version: 3, history: s.history, clades: s.clades };
  }
  if ((s.version === 1 || s.version === 2) && s.history) {
    return { version: 3, history: s.history, clades: {} };
  }
  return emptyStore();
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

/** Coerce an untrusted blob (e.g. from the DB) into a valid v3 store. */
export function coerceStore(raw: unknown): StatsStore {
  return migrate(raw);
}

export function isEmptyStore(store: StatsStore): boolean {
  return Object.keys(store.history).length === 0 && Object.keys(store.clades).length === 0;
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
  const keptSet = new Set(dates.filter((d) => keepsStreak(history[d])));
  for (const d of keptSet) {
    if (keptSet.has(prevDay(d))) continue; // only start at a run's first day
    let len = 0;
    let c: string = d;
    while (keptSet.has(c)) {
      if (history[c].status === "won") len++;
      c = nextDay(c);
    }
    maxStreak = Math.max(maxStreak, len);
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

export function derive(store: StatsStore, todayKey: string, groupForDate?: DailyGroupResolver): DerivedStats {
  return {
    daily: deriveDaily(store.history, todayKey, groupForDate),
    practice: derivePractice(store.clades),
  };
}
