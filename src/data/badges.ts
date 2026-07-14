/** Badges, in two families:
 *   • MILESTONE — absolute, personal. Derived from local stats (games played,
 *     streaks). Work solo, offline, from day one.
 *   • COMPETITIVE — relative. Derived from the server's player_badges() (daily
 *     wins + live rank/total, overall and per clade). Gated so they don't show
 *     until the pool is meaningful.
 *  All thresholds live here so they can be tuned without a schema change. */

import { cladeGroup } from "./clades";
import type { DerivedStats } from "./stats";

export type BadgeTier = "bronze" | "silver" | "gold" | "diamond" | "crown" | "plain";

export interface Badge {
  id: string;
  icon: string;
  label: string;
  desc: string;
  tier: BadgeTier;
  /** Formatted dates behind the badge — a champion's winning periods (newest
   *  first) or a one-time badge's single earned-on date. Present → the UI makes
   *  the badge clickable to reveal them. */
  occurrences?: string[];
  /** Verb for the dates panel: champions were "won", milestones were "earned". */
  occLabel?: string;
}

/** What player_badges()/grid_player_badges() return (live, no persistence). Both
 *  games share this shape; Kinship leaves `groups` empty (no persistent clades). */
export interface PlayerBadges {
  /** Days finished at rank 1 (past days, ≥3 players). */
  daily_wins: number;
  /** Winning dates (YYYY-MM-DD, newest first). */
  win_dates: string[];
  /** Completed ISO weeks won, and their Monday dates. */
  week_wins: number;
  week_dates: string[];
  /** Completed calendar months won, and their first-of-month dates. */
  month_wins: number;
  month_dates: string[];
  overall: { rank: number; total: number } | null;
  groups: Record<string, { rank: number; total: number }>;
}

const SEEN_WINS_KEY = "cladensis.seenWins";

/** Compare the server's win dates against what we've already celebrated on this
 *  device, and return the newly-won dates (newest first). On the very first run
 *  it records all existing wins as a baseline and returns none — so historical
 *  wins aren't dumped as "new". Best-effort; storage failures just skip the nudge. */
export function newDailyWins(winDates: string[]): string[] {
  try {
    const raw = localStorage.getItem(SEEN_WINS_KEY);
    const merge = (all: string[]) =>
      localStorage.setItem(SEEN_WINS_KEY, JSON.stringify([...new Set(all)]));
    if (raw === null) {
      merge(winDates); // baseline — don't celebrate pre-existing wins
      return [];
    }
    const seen = new Set(JSON.parse(raw) as string[]);
    const fresh = winDates.filter((d) => !seen.has(d));
    if (fresh.length) merge([...seen, ...winDates]);
    return fresh;
  } catch {
    return [];
  }
}

// ---- tunables ----
/** A percentile pool smaller than this is too noisy to badge ("top 50% of 2"). */
const MIN_POOL = 10;
/** Percentile tiers, best first. `max` is the inclusive top-percentile cutoff. */
const PCT_TIERS: { max: number; icon: string; label: string; tier: BadgeTier }[] = [
  { max: 1, icon: "💎", label: "Top 1%", tier: "diamond" },
  { max: 5, icon: "🥇", label: "Top 5%", tier: "gold" },
  { max: 10, icon: "🥈", label: "Top 10%", tier: "silver" },
  { max: 25, icon: "🥉", label: "Top 25%", tier: "bronze" },
];
/** Champion tiers by how many periods were won (rank 1). Shared by the daily,
 *  weekly, and monthly champion badges. */
const CHAMP_TIERS: { min: number; tier: BadgeTier }[] = [
  { min: 25, tier: "diamond" },
  { min: 5, tier: "gold" },
  { min: 1, tier: "crown" },
];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Format dates for display (string-split, so no timezone drift).
const fmtDay = (d: string) => { const [, m, day] = d.split("-"); return `${MON[+m - 1]} ${+day}`; };
const fmtDayY = (d: string) => { const [y, m, day] = d.split("-"); return `${MON[+m - 1]} ${+day}, ${y}`; };
const fmtWeek = (d: string) => `Wk of ${fmtDay(d)}`;
const fmtMonth = (d: string) => { const [y, m] = d.split("-"); return `${MON[+m - 1]} ${y}`; };

/** The earned-on badge fields for the min-th event (index min-1), if reached. A
 *  milestone shows a single "earned" date (with year, since it may be long ago). */
const earnedAt = (dates: string[], min: number): Pick<Badge, "occurrences" | "occLabel"> => {
  const d = dates[min - 1];
  return d ? { occurrences: [fmtDayY(d)], occLabel: "earned" } : {};
};

/** One champion badge (day/week/month), tiered by how many periods were won, with
 *  the winning periods attached as clickable occurrences. Null below tier 1. */
function champBadge(
  id: string, icon: string, singular: string, periodNoun: string,
  count: number, dates: string[], fmt: (d: string) => string
): Badge | null {
  const t = highest(CHAMP_TIERS, count);
  if (!t) return null;
  return {
    id, icon, tier: t.tier,
    label: t.min === 1 ? singular : `${t.min}× ${singular}`,
    desc: `Topped the ${periodNoun} board ${count}×`,
    occurrences: dates.map(fmt),
  };
}
// Milestone tiers shared by both games. Labels are built from the count + the
// game's noun (puzzle/board), so Lineage and Kinship reuse the same thresholds.
type CountTier = { min: number; icon: string; tier: BadgeTier };

/** Puzzles/boards completed → collector tier (participation; a streak-saving
 *  give-up still counts as played). */
const PLAY_TIERS: CountTier[] = [
  { min: 250, icon: "🌍", tier: "diamond" },
  { min: 100, icon: "🌲", tier: "gold" },
  { min: 50, icon: "🌿", tier: "silver" },
  { min: 25, icon: "🌱", tier: "bronze" },
  { min: 10, icon: "🌱", tier: "plain" },
  { min: 1, icon: "🌱", tier: "plain" },
];
/** Puzzles/boards SOLVED (personal wins, any rank) → distinct from PLAY_TIERS. */
const SOLVE_TIERS: CountTier[] = [
  { min: 100, icon: "🎯", tier: "diamond" },
  { min: 50, icon: "🎯", tier: "gold" },
  { min: 10, icon: "🎯", tier: "silver" },
  { min: 1, icon: "🎯", tier: "plain" },
];
/** Kinship-only: boards solved with zero mistakes. */
const FLAWLESS_TIERS: CountTier[] = [
  { min: 25, icon: "✨", tier: "diamond" },
  { min: 10, icon: "✨", tier: "gold" },
  { min: 1, icon: "✨", tier: "plain" },
];
/** Streak milestones (best streak ever). Shared; labelled in days. */
const STREAK_TIERS: { min: number; tier: BadgeTier }[] = [
  { min: 100, tier: "diamond" },
  { min: 30, tier: "gold" },
  { min: 7, tier: "silver" },
];
/** Per-clade dedication: play this many games in one group (Lineage only). */
const CLADE_PLAY_MIN = 25;

const playLabel = (min: number, noun: string) => (min === 1 ? `First ${noun}` : `${min} ${noun}s`);

const pctOf = (rank: number, total: number) => (total > 0 ? (rank / total) * 100 : 100);

/** The single best percentile tier for a rank/total, or null if the pool is too
 *  small or the standing doesn't reach even the lowest tier. */
function pctTier(standing: { rank: number; total: number } | null) {
  if (!standing || standing.total < MIN_POOL) return null;
  const p = pctOf(standing.rank, standing.total);
  return PCT_TIERS.find((t) => p <= t.max) ?? null;
}

function highest<T extends { min: number }>(tiers: T[], value: number): T | null {
  return tiers.find((t) => value >= t.min) ?? null;
}

interface Milestone {
  /** id namespace so the two games' badges never collide ('lin' | 'kin'). */
  ns: string;
  /** singular noun for labels/descriptions ('puzzle' | 'board'). */
  noun: string;
  /** Event dates ascending — counts come from lengths, earned-on from indexes. */
  playedDates: string[];
  solvedDates: string[];
  maxStreak: number;
  bestStreakEnd: string | null;
  /** Kinship-only: perfect (zero-mistake) win dates. */
  flawlessDates?: string[];
}

/** Milestone badges common to every game: play-count (participation), solves
 *  (personal wins, any rank), best streak, and — when provided — flawless wins.
 *  Each carries the date it was earned. No network; always available. */
function milestoneBadges(m: Milestone): Badge[] {
  const out: Badge[] = [];

  const played = highest(PLAY_TIERS, m.playedDates.length);
  if (played) out.push({ id: `${m.ns}-played`, icon: played.icon, tier: played.tier, label: playLabel(played.min, m.noun), desc: `${m.playedDates.length} ${m.noun}s completed`, ...earnedAt(m.playedDates, played.min) });

  const solved = highest(SOLVE_TIERS, m.solvedDates.length);
  if (solved) out.push({ id: `${m.ns}-solved`, icon: solved.icon, tier: solved.tier, label: solved.min === 1 ? "First solve" : `${solved.min} solved`, desc: `${m.solvedDates.length} ${m.noun}s solved`, ...earnedAt(m.solvedDates, solved.min) });

  const streak = highest(STREAK_TIERS, m.maxStreak);
  if (streak) out.push({ id: `${m.ns}-streak`, icon: "🔥", tier: streak.tier, label: `${streak.min}-day streak`, desc: `Best ${m.noun} streak: ${m.maxStreak}`, ...(m.bestStreakEnd ? { occurrences: [fmtDayY(m.bestStreakEnd)], occLabel: "earned" } : {}) });

  if (m.flawlessDates) {
    const fl = highest(FLAWLESS_TIERS, m.flawlessDates.length);
    if (fl) out.push({ id: `${m.ns}-flawless`, icon: fl.icon, tier: fl.tier, label: fl.min === 1 ? "First flawless" : `${fl.min} flawless`, desc: `${m.flawlessDates.length} boards solved with no mistakes`, ...earnedAt(m.flawlessDates, fl.min) });
  }

  return out;
}

/** Lineage (guess-the-organism) milestones + per-clade dedication. */
export function lineageBadges(stats: DerivedStats): Badge[] {
  const d = stats.daily;
  const out = milestoneBadges({ ns: "lin", noun: "puzzle", playedDates: d.playedDates, solvedDates: d.solvedDates, maxStreak: d.maxStreak, bestStreakEnd: d.bestStreakEnd });
  for (const g of d.groups) {
    if (g.played >= CLADE_PLAY_MIN) {
      out.push({ id: `clade-${g.id}`, icon: g.icon, label: `${g.label} regular`, tier: "silver", desc: `${g.played} daily games in ${g.label}` });
    }
  }
  return out;
}

/** Kinship (grid) milestones, including flawless (zero-mistake) boards. */
export function kinshipBadges(stats: DerivedStats): Badge[] {
  const k = stats.kinship;
  return milestoneBadges({ ns: "kin", noun: "board", playedDates: k.playedDates, solvedDates: k.solvedDates, maxStreak: k.maxStreak, bestStreakEnd: k.bestStreakEnd, flawlessDates: k.flawlessDates });
}

/** Branches milestones, including flawless (no hint, no peek) full rebuilds. */
export function branchesBadges(stats: DerivedStats): Badge[] {
  const b = stats.branches;
  return milestoneBadges({ ns: "brn", noun: "board", playedDates: b.playedDates, solvedDates: b.solvedDates, maxStreak: b.maxStreak, bestStreakEnd: b.bestStreakEnd, flawlessDates: b.flawlessDates });
}

/** Competitive badges from the server standing — day/week/month champions (with
 *  the winning periods to click through) + all-time percentile. Game-agnostic:
 *  pass either player_badges() (Lineage) or grid_player_badges() (Kinship).
 *  Gated to meaningful pools server-side (≥3 entrants) and here (percentile pool). */
export function competitiveBadges(server: PlayerBadges | null): Badge[] {
  if (!server) return [];
  const out: Badge[] = [];

  const day = champBadge("champ-day", "👑", "daily winner", "daily", server.daily_wins, server.win_dates, fmtDay);
  if (day) out.push(day);
  const week = champBadge("champ-week", "🏆", "weekly champion", "weekly", server.week_wins, server.week_dates, fmtWeek);
  if (week) out.push(week);
  const month = champBadge("champ-month", "🎖️", "monthly champion", "monthly", server.month_wins, server.month_dates, fmtMonth);
  if (month) out.push(month);

  const overall = pctTier(server.overall);
  if (overall && server.overall) {
    out.push({ id: "pct-overall", icon: overall.icon, label: `${overall.label} overall`, tier: overall.tier, desc: `Rank ${server.overall.rank} of ${server.overall.total} by total score` });
  }

  for (const [id, standing] of Object.entries(server.groups)) {
    const t = pctTier(standing);
    if (t) {
      const g = cladeGroup(id);
      out.push({ id: `pct-${id}`, icon: g.icon, label: `${t.label} · ${g.label}`, tier: t.tier, desc: `Rank ${standing.rank} of ${standing.total} in ${g.label}` });
    }
  }

  return out;
}

/** How many more plays to the next collector tier (a gentle nudge), or null.
 *  `noun` labels it per game ('puzzle' for Lineage, 'board' for Kinship). */
export function nextPlayMilestone(played: number, noun = "puzzle"): { remaining: number; label: string } | null {
  const next = [...PLAY_TIERS].reverse().find((t) => t.min > played);
  return next ? { remaining: next.min - played, label: playLabel(next.min, noun) } : null;
}
