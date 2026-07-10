/** Browser-local stats. The daily history drives streaks + guess distribution
 *  (daily puzzle only); the per-clade tallies gauge "how good are you" at each
 *  group and count every finished game (daily + free play). No accounts, no
 *  network — all derived from localStorage. */

import { CLADE_GROUPS, cladeGroup, OTHER_GROUP } from "./clades";
import { gamePoints } from "./score";
import { supabase } from "./supabase";

export interface DailyEntry {
  status: "won" | "gaveup";
  guesses: number;
  hints: number;
  tier: number;
}

interface CladeTally {
  played: number;
  wins: number;
  guessSum: number; // total guesses across wins, for an average
  dailyPlayed: number; // daily games only (points denominator)
  pointsSum: number;   // leaderboard points across daily games in this group
}

interface StatsStore {
  version: 2;
  /** date (YYYY-MM-DD) -> the daily result. */
  history: Record<string, DailyEntry>;
  /** group id -> aggregate performance across all finished games. */
  clades: Record<string, CladeTally>;
}

export interface CladeStat {
  id: string;
  label: string;
  icon: string;
  played: number;
  wins: number;
  winPct: number;
  avgGuesses: number | null;
  /** Average leaderboard points per daily game in this group (null if none). */
  avgPoints: number | null;
  /** Total leaderboard points earned in this group (daily games). */
  totalPoints: number;
}

export interface DerivedStats {
  // Daily-only (streaks make sense only for the shared daily)
  played: number;
  wins: number;
  winPct: number;
  currentStreak: number;
  maxStreak: number;
  distribution: number[];
  recordedToday: boolean;
  // Across all finished games
  overall: { played: number; wins: number; winPct: number };
  /** Daily leaderboard points (matches the server standing): total + per-game avg. */
  points: { total: number; avg: number };
  clades: CladeStat[];
  /** id of your strongest group (best win% with enough games), or null. */
  strengthId: string | null;
}

const KEY = "cladensis.stats.v1"; // key kept stable; payload is versioned inside

// Guess-count histogram buckets. A hard daily routinely runs well past 8 guesses,
// so single-guess columns (1..8+) pile everything into the last bar — bin into
// ranges instead. Lower bound of each bucket; the last one is open-ended.
const BUCKET_LOWS = [1, 6, 11, 16, 21, 31];
export const GUESS_BUCKET_LABELS = BUCKET_LOWS.map((lo, i) =>
  i === BUCKET_LOWS.length - 1 ? `${lo}+` : `${lo}–${BUCKET_LOWS[i + 1] - 1}`
);
/** Histogram bucket index for a guess count (clamped to the open-ended last). */
export function guessBucket(guesses: number): number {
  let idx = 0;
  for (let i = 0; i < BUCKET_LOWS.length; i++) if (guesses >= BUCKET_LOWS[i]) idx = i;
  return idx;
}

export function loadStore(): StatsStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as {
        version?: number;
        history?: Record<string, DailyEntry>;
        clades?: Record<string, CladeTally>;
      };
      if (parsed?.version === 2 && parsed.history && parsed.clades) {
        return { version: 2, history: parsed.history, clades: parsed.clades };
      }
      // migrate v1 (history only) → v2
      if (parsed?.version === 1 && parsed.history) {
        return { version: 2, history: parsed.history, clades: {} };
      }
    }
  } catch {
    /* corrupt or unavailable storage — start fresh */
  }
  return { version: 2, history: {}, clades: {} };
}

export function saveStore(store: StatsStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked — best-effort */
  }
}

/** Coerce an untrusted blob (e.g. from the DB) into a valid v2 store. */
export function coerceStore(raw: unknown): StatsStore {
  const s = raw as {
    version?: number;
    history?: Record<string, DailyEntry>;
    clades?: Record<string, CladeTally>;
  } | null;
  if (s && s.version === 2 && s.history && s.clades) {
    return { version: 2, history: s.history, clades: s.clades };
  }
  if (s && s.version === 1 && s.history) return { version: 2, history: s.history, clades: {} };
  return { version: 2, history: {}, clades: {} };
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

function bumpClade(store: StatsStore, groupId: string, entry: DailyEntry, isDaily: boolean): void {
  const c = store.clades[groupId] ?? { played: 0, wins: 0, guessSum: 0, dailyPlayed: 0, pointsSum: 0 };
  c.played++;
  if (entry.status === "won") {
    c.wins++;
    c.guessSum += entry.guesses;
  }
  // Points are a daily concept (leaderboard-weighted); free play carries none.
  if (isDaily) {
    c.dailyPlayed = (c.dailyPlayed ?? 0) + 1;
    c.pointsSum = (c.pointsSum ?? 0) + gamePoints(entry.status === "won", entry.tier, entry.guesses, entry.hints);
  }
  store.clades[groupId] = c;
}

/** Apply a daily result onto a store IN PLACE, once per date (so replays don't
 *  inflate). Pure w.r.t. storage — used both for local recording and for
 *  replaying a during-sync record onto the freshly-fetched cloud store. */
export function applyDaily(store: StatsStore, dateKey: string, entry: DailyEntry, groupId: string): StatsStore {
  if (!store.history[dateKey]) {
    store.history[dateKey] = entry;
    bumpClade(store, groupId, entry, true);
  }
  return store;
}

/** Apply a finished free-play game onto a store IN PLACE (clade stats only). */
export function applyFree(store: StatsStore, entry: DailyEntry, groupId: string): StatsStore {
  bumpClade(store, groupId, entry, false);
  return store;
}

/** Record a daily result to local storage, once per date. */
export function recordDaily(dateKey: string, entry: DailyEntry, groupId: string): StatsStore {
  const store = applyDaily(loadStore(), dateKey, entry, groupId);
  saveStore(store);
  return store;
}

/** Record a finished free-play game to local storage — clade stats only. */
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

export function derive(store: StatsStore, todayKey: string): DerivedStats {
  const h = store.history;
  const dates = Object.keys(h);
  const played = dates.length;
  const wins = dates.filter((d) => h[d].status === "won").length;

  const distribution = new Array(GUESS_BUCKET_LABELS.length).fill(0);
  let pointsTotal = 0;
  for (const d of dates) {
    const e = h[d];
    if (e.status === "won") distribution[guessBucket(e.guesses)]++;
    // Daily points, recomputed from stored facts — matches the server standing.
    pointsTotal += gamePoints(e.status === "won", e.tier, e.guesses, e.hints);
  }
  const points = { total: pointsTotal, avg: played ? Math.round(pointsTotal / played) : 0 };

  let currentStreak = 0;
  let cursor = h[todayKey] ? todayKey : prevDay(todayKey);
  while (h[cursor]?.status === "won") {
    currentStreak++;
    cursor = prevDay(cursor);
  }

  let maxStreak = 0;
  const wonSet = new Set(dates.filter((d) => h[d].status === "won"));
  for (const d of wonSet) {
    if (wonSet.has(prevDay(d))) continue;
    let len = 0;
    let c: string = d;
    while (wonSet.has(c)) {
      len++;
      c = nextDay(c);
    }
    maxStreak = Math.max(maxStreak, len);
  }

  // Per-clade — keep a stable order (known groups, then "other"), only groups
  // that have been played.
  const order = [...CLADE_GROUPS.map((g) => g.id), OTHER_GROUP.id];
  const clades: CladeStat[] = order
    .filter((id) => store.clades[id]?.played)
    .map((id) => {
      const t = store.clades[id];
      const g = cladeGroup(id);
      const dp = t.dailyPlayed ?? 0;
      const ps = t.pointsSum ?? 0;
      return {
        id,
        label: g.label,
        icon: g.icon,
        played: t.played,
        wins: t.wins,
        winPct: Math.round((t.wins / t.played) * 100),
        avgGuesses: t.wins ? Math.round((t.guessSum / t.wins) * 10) / 10 : null,
        avgPoints: dp ? Math.round(ps / dp) : null,
        totalPoints: Math.round(ps),
      };
    });

  const oPlayed = clades.reduce((s, c) => s + c.played, 0);
  const oWins = clades.reduce((s, c) => s + c.wins, 0);

  // Strength = best win% among groups with at least 3 games.
  let strengthId: string | null = null;
  let best = -1;
  for (const c of clades) {
    if (c.played >= 3 && c.winPct > best) {
      best = c.winPct;
      strengthId = c.id;
    }
  }

  return {
    played,
    wins,
    winPct: played ? Math.round((wins / played) * 100) : 0,
    currentStreak,
    maxStreak,
    distribution,
    recordedToday: !!h[todayKey],
    overall: { played: oPlayed, wins: oWins, winPct: oPlayed ? Math.round((oWins / oPlayed) * 100) : 0 },
    points,
    clades,
    strengthId,
  };
}
