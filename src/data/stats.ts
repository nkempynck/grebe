/** Browser-local stats, split cleanly into two worlds:
 *   • DAILY   — the shared, ranked puzzle. Everything (streaks, points, per-clade
 *               scoring) derives from `history`, which stores one entry per date
 *               tagged with its clade group. Points mirror the leaderboard.
 *   • PRACTICE — free play. Self-chosen difficulty carries no leaderboard weight,
 *               so it has no score; we track only games + win-rate per clade.
 *  No accounts, no network — all from localStorage (optionally synced). */

import { DAILY_EPOCH } from "../core/daily";
import { CLADE_GROUPS, cladeGroup, OTHER_GROUP } from "./clades";
import { gamePoints, kinshipPoints, branchesPoints, KINSHIP_FREE_REVEALS } from "./score";
import { supabase } from "./supabase";

export interface DailyEntry {
  status: "won" | "gaveup";
  guesses: number;
  hints: number;
  tier: number;
  /** Clade group id (added v3). Optional only for entries migrated from v2. */
  group?: string;
  /** Leaderboard points FROZEN at play time (added v6). Retuning the scoring formula
   *  never moves a past game's score. Optional for entries saved before v6 (backfilled
   *  on migrate). Mirrors the server's frozen games.points. */
  points?: number;
}

/** One finished Kinship (grid) daily. Points scale down with mistakes; a loss
 *  (four mistakes) scores zero. Added in stats v4. */
export interface KinshipEntry {
  status: "won" | "lost";
  mistakes: number;
  tier: number;
  /** Picture/name reveals used (scored separately from mistakes). Optional so
   *  entries saved before this field default to none. */
  reveals?: number;
  /** How many of those reveals were PAID (billed while the free-peek balance — 3 plus
   *  one per solved group — was empty). Optional; pre-existing entries default to none. */
  paidReveals?: number;
  /** Points FROZEN at play time (added v6); see DailyEntry.points. */
  points?: number;
}

/** One finished Branches daily. `won` = every slot placed within the day's mistake
 *  budget (1 Mon–Wed, 2 Thu–Sun); over budget is a loss. A hint forfeits a whole
 *  point, a peek half, and each surviving mistake trims the win too. Added v5;
 *  `mistakes` added later (older entries default 0). */
export interface BranchesEntry {
  won: boolean;
  correct: number;
  total: number;
  hinted: number;
  peeked: number;
  /** Wrong placements committed (older entries lack it → treated as 0). */
  mistakes?: number;
  tier: number;
  /** Points FROZEN at play time (added v6); see DailyEntry.points. */
  points?: number;
}

/** Free-play tally per clade group (practice is unranked → no points). */
interface CladeFree {
  played: number;
  wins: number;
}

export interface StatsStore {
  version: 6;
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
  /** First and last winning day of the best streak ever. The start dates each
   *  streak badge: the N-day tier was reached on start + (N−1) days. */
  bestStreakStart: string | null;
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
  /** Wins with no mistake and no paid peek (perfect boards) — drives the ✨ badge. */
  flawless: number;
  winPct: number;
  currentStreak: number;
  maxStreak: number;
  /** Ascending dates behind each milestone badge's earned-on lookup. */
  playedDates: string[];
  solvedDates: string[];
  flawlessDates: string[];
  bestStreakStart: string | null;
  bestStreakEnd: string | null;
  points: { total: number; avg: number; best: number };
}

/** Branches daily performance — ranked, score-based. */
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
  bestStreakStart: string | null;
  bestStreakEnd: string | null;
  points: { total: number; avg: number; best: number };
}

export interface DerivedStats {
  daily: DailyStats;
  practice: PracticeStats;
  kinship: KinshipStats;
  branches: BranchesStats;
}

const KEY = "grebe.stats.v1"; // renamed from cladensis.* at launch (2026-07-22): the
// rename orphans every device's pre-launch local stats, so a returning beta tester can't
// re-seed the freshly-truncated player_stats from their device. Payload versioned inside.

// Frozen per-game points: the value stored on the entry if present (stamped at play
// time), else recomputed from the entry's stored facts. Reading these everywhere means a
// scoring-formula change never moves a game already recorded — mirrors the server, whose
// games.points is frozen at submit. Backfilled onto pre-v6 entries on migrate.
const dailyPts = (e: DailyEntry) => e.points ?? gamePoints(e.status === "won", e.tier, e.guesses, e.hints);
const kinshipPts = (e: KinshipEntry) =>
  e.points ??
  kinshipPoints(
    e.status === "won",
    e.tier,
    e.mistakes,
    // kinshipPoints' 4th arg is the PAID count; legacy entries only stored the total,
    // so approximate their paid share from the end state (a win earns 4 solves' peeks).
    e.paidReveals ?? Math.max(0, (e.reveals ?? 0) - (KINSHIP_FREE_REVEALS + (e.status === "won" ? 4 : 0)))
  );
const branchesPts = (e: BranchesEntry) => e.points ?? branchesPoints(e.tier, e.won, e.total, e.correct, e.mistakes ?? 0, e.hinted, e.peeked);

/** One day's frozen points per game, or null if that game wasn't played that day.
 *  For code that needs a single day's score rather than an aggregate (the vs-field
 *  comparison in ./field), reading the same frozen values every other stat uses. */
export function pointsByDate(store: StatsStore) {
  return {
    lineage: (d: string) => (store.history?.[d] ? dailyPts(store.history[d]) : null),
    kinship: (d: string) => (store.kinship?.[d] ? kinshipPts(store.kinship[d]) : null),
    branches: (d: string) => (store.branches?.[d] ? branchesPts(store.branches[d]) : null),
  };
}

const emptyStore = (): StatsStore => ({ version: 6, history: {}, clades: {}, kinship: {}, branches: {} });

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
  // v6: freeze each entry's points once, so a later formula change can't move past games.
  for (const e of Object.values(history)) e.points = dailyPts(e);
  for (const e of Object.values(kinship)) e.points = kinshipPts(e);
  for (const e of Object.values(branches)) e.points = branchesPts(e);
  return { version: 6, history, clades, kinship, branches };
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
  setStatsOwner(null);
  return empty;
}

const OWNER_KEY = "grebe.statsOwner";

/** Which signed-in player this device's store belongs to, if any. Absent means
 *  nobody owns it — the anonymous case — and an unowned store is trusted, so
 *  playing before you register still carries into your first account.
 *
 *  A DELIBERATE sign-out wipes the device, leaving nothing to own. A session that
 *  merely vanishes (failed refresh, revoked token) now leaves the store in place,
 *  since losing a session shouldn't cost a player their stats. That's what makes
 *  this necessary: the device can then hold one player's dailies while a different
 *  account signs in next, and mergeMissingDailies() would otherwise fold them into
 *  the newcomer's stats. */
export function statsOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

/** May this device's local store be folded into the account now signing in?
 *  Unowned means anonymous play, which is exactly what SHOULD carry into a first
 *  account; the same owner is the player returning after a dropped session. Only a
 *  store belonging to somebody else is refused. */
export function localStoreTrusted(owner: string | null, userId: string): boolean {
  return owner === null || owner === userId;
}

export function setStatsOwner(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    /* storage blocked — nothing to guard, since nothing persisted either */
  }
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
 *  derive straight from history. Points are FROZEN onto the entry here. */
export function applyDaily(store: StatsStore, dateKey: string, entry: DailyEntry, groupId: string): StatsStore {
  if (!store.history[dateKey]) store.history[dateKey] = { ...entry, group: groupId, points: dailyPts(entry) };
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
  if (!store.kinship[dateKey]) store.kinship[dateKey] = { ...entry, points: kinshipPts(entry) };
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
  if (!store.branches[dateKey]) store.branches[dateKey] = { ...entry, points: branchesPts(entry) };
  return store;
}

/** Record a Branches daily result to local storage, once per date. */
export function recordBranches(dateKey: string, entry: BranchesEntry): StatsStore {
  const store = applyBranches(loadStore(), dateKey, entry);
  saveStore(store);
  return store;
}

/** Fold any dated daily results present in `local` but missing from `base` into
 *  `base` (mutated in place), for all three games. Cloud wins on a date collision,
 *  so it never rewrites an already-synced result. Returns the number of entries
 *  carried over (0 = nothing new).
 *
 *  Used on sign-in to a RETURNING account (non-empty cloud): a daily finished
 *  while signed out is saved locally but, without this, would be dropped when the
 *  authoritative cloud store overwrites the device — leaving personal stats (and
 *  the "played today" gate) behind the leaderboard, which carries the same result
 *  over separately via pendingSubmits. Free-play (clades) is intentionally left
 *  out: it's unranked, gates nothing, and an additive merge could double-count. */
export function mergeMissingDailies(base: StatsStore, local: StatsStore): number {
  let added = 0;
  for (const [d, e] of Object.entries(local.history)) if (!base.history[d]) { base.history[d] = e; added++; }
  for (const [d, e] of Object.entries(local.kinship)) if (!base.kinship[d]) { base.kinship[d] = e; added++; }
  for (const [d, e] of Object.entries(local.branches)) if (!base.branches[d]) { base.branches[d] = e; added++; }
  return added;
}

/** `dateKey` shifted by n days (negative = back). Dates are handled as UTC
 *  midnights so the 09:00 rollover can't drift a key by a day. */
export function addDays(dateKey: string, n: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const prevDay = (dateKey: string) => addDays(dateKey, -1);
const nextDay = (dateKey: string) => addDays(dateKey, 1);

const pct = (wins: number, played: number) => (played ? Math.round((wins / played) * 100) : 0);
const orderedIds = [...CLADE_GROUPS.map((g) => g.id), OTHER_GROUP.id];

/** Daily games a clade needs before its average can be called a strength. One
 *  lucky Amphibians day would otherwise out-rank a clade you've actually played,
 *  and the UI says so where the winner is named (see StatsPanel). */
export const STRENGTH_MIN_GAMES = 3;

/** THE streak rule, shared by all three games: a streak is a run of consecutive
 *  days WON. Anything else on a played day (a give-up, a lost board) ends it — no
 *  bridges, no partial credit. Lineage used to forgive a well-fought give-up,
 *  which made its streak mean something different from Kinship's and Branches'
 *  and diverged from the server's flame; one rule everywhere is worth the harshness.
 *
 *  The walk starts at TODAY if the day has been played, else at YESTERDAY: not
 *  having played yet leaves yesterday's run standing, but losing today ends it
 *  immediately (there's no replay, so the day is already decided).
 *
 *  MUST match public.game_streaks() in supabase/streaks.sql, which computes the
 *  same number for the flame shown beside a player's name on the leaderboard.
 *
 *  @param dates  every played date (any order)
 *  @param won    did the player win that date? */
function deriveStreaks(
  dates: string[],
  todayKey: string,
  won: (date: string) => boolean
): Pick<DailyStats, "currentStreak" | "maxStreak" | "bestStreakStart" | "bestStreakEnd"> {
  const played = new Set(dates);
  const wonSet = new Set(dates.filter(won));

  let currentStreak = 0;
  let cursor = played.has(todayKey) ? todayKey : prevDay(todayKey);
  while (wonSet.has(cursor)) {
    currentStreak++;
    cursor = prevDay(cursor);
  }

  let maxStreak = 0;
  let bestStreakStart: string | null = null;
  let bestStreakEnd: string | null = null;
  for (const d of wonSet) {
    if (wonSet.has(prevDay(d))) continue; // only start at a run's first day
    let len = 0;
    let end: string | null = null;
    let c: string = d;
    while (wonSet.has(c)) {
      len++;
      end = c;
      c = nextDay(c);
    }
    if (len > maxStreak) { maxStreak = len; bestStreakStart = d; bestStreakEnd = end; }
  }

  return { currentStreak, maxStreak, bestStreakStart, bestStreakEnd };
}

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
    const p = dailyPts(e);
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

  const { currentStreak, maxStreak, bestStreakStart, bestStreakEnd } = deriveStreaks(
    dates, todayKey, (d) => history[d].status === "won"
  );

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

  // Strength = highest average points among groups with enough games to mean it.
  let strengthId: string | null = null;
  let bestAvg = -1;
  for (const g of groups) {
    if (g.played >= STRENGTH_MIN_GAMES && g.avgPoints > bestAvg) {
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
    bestStreakStart,
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

/** Kinship (grid) daily stats. */
function deriveKinship(kinship: Record<string, KinshipEntry>, todayKey: string): KinshipStats {
  const dates = Object.keys(kinship);
  const played = dates.length;
  const wins = dates.filter((d) => kinship[d].status === "won").length;
  // ONE definition of flawless, used for both the count and the dates behind the
  // badge: won, no mistake, no PAID peek. (They used to disagree — the dates
  // ignored peeks — so a board bought with paid peeks earned the ✨ badge without
  // being counted flawless.) A won board's free budget is 3 plus one per group
  // (all four solved), so legacy entries storing only a total are flawless up to
  // KINSHIP_FREE_REVEALS + 4.
  const isFlawless = (d: string) => {
    const e = kinship[d];
    const paid = e.paidReveals ?? Math.max(0, (e.reveals ?? 0) - (KINSHIP_FREE_REVEALS + 4));
    return e.status === "won" && e.mistakes === 0 && paid === 0;
  };
  const flawless = dates.filter(isFlawless).length;

  let total = 0;
  let best = 0;
  for (const d of dates) {
    const e = kinship[d];
    const p = kinshipPts(e);
    total += p;
    if (p > best) best = p;
  }

  const { currentStreak, maxStreak, bestStreakStart, bestStreakEnd } = deriveStreaks(
    dates, todayKey, (d) => kinship[d].status === "won"
  );

  return {
    played,
    wins,
    flawless,
    winPct: pct(wins, played),
    currentStreak,
    maxStreak,
    playedDates: [...dates].sort(),
    solvedDates: dates.filter((d) => kinship[d].status === "won").sort(),
    flawlessDates: dates.filter(isFlawless).sort(),
    bestStreakStart,
    bestStreakEnd,
    points: { total, avg: played ? Math.round(total / played) : 0, best },
  };
}

/** Branches daily stats. Like Kinship: a plain run of consecutive wins (a win =
 *  solved within the day's mistake budget). "flawless" = won with no mistake, hint
 *  or peek. */
function deriveBranches(branches: Record<string, BranchesEntry>, todayKey: string): BranchesStats {
  const dates = Object.keys(branches);
  const played = dates.length;
  const isWin = (d: string) => branches[d].won;
  const isFlawless = (d: string) =>
    branches[d].won && branches[d].hinted === 0 && branches[d].peeked === 0 && (branches[d].mistakes ?? 0) === 0;
  const wins = dates.filter(isWin).length;
  const flawless = dates.filter(isFlawless).length;

  let total = 0;
  let best = 0;
  for (const d of dates) {
    const e = branches[d];
    const p = branchesPts(e);
    total += p;
    if (p > best) best = p;
  }

  const { currentStreak, maxStreak, bestStreakStart, bestStreakEnd } = deriveStreaks(dates, todayKey, isWin);

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
    bestStreakStart,
    bestStreakEnd,
    points: { total, avg: played ? Math.round(total / played) : 0, best },
  };
}

/** Days before the public launch (DAILY_EPOCH) were a shakedown: their server rows
 *  were wiped at launch (supabase/launch-reset.sql), so counting them locally would
 *  inflate streaks, totals and badges past anything the boards can corroborate.
 *  They're filtered out of every derivation rather than deleted — the entries stay
 *  in the store, they just don't count. */
export const countsForStats = (dateKey: string) => dateKey >= DAILY_EPOCH;

const sinceLaunch = <T,>(rows: Record<string, T>): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const [d, e] of Object.entries(rows)) if (countsForStats(d)) out[d] = e;
  return out;
};

export function derive(store: StatsStore, todayKey: string, groupForDate?: DailyGroupResolver): DerivedStats {
  // Tolerate partial stores (older shapes / hand-built test fixtures): a missing
  // section just derives as empty. Practice carries no dates (it's a per-clade
  // tally), so it can't be filtered by launch date and simply counts everything;
  // it's unranked and scoreless, so nothing hangs on it.
  return {
    daily: deriveDaily(sinceLaunch(store.history ?? {}), todayKey, groupForDate),
    practice: derivePractice(store.clades ?? {}),
    kinship: deriveKinship(sinceLaunch(store.kinship ?? {}), todayKey),
    branches: deriveBranches(sinceLaunch(store.branches ?? {}), todayKey),
  };
}
