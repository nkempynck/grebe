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
}

/** What the server's player_badges() RPC returns (all live, no persistence). */
export interface PlayerBadges {
  daily_wins: number;
  /** Recent dates the player topped the daily (YYYY-MM-DD, newest first). */
  win_dates: string[];
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
/** Daily-winner tiers by number of days won (rank 1 on a finished day). */
const WIN_TIERS: { min: number; icon: string; label: string; tier: BadgeTier }[] = [
  { min: 25, icon: "👑", label: "25× daily winner", tier: "diamond" },
  { min: 5, icon: "👑", label: "5× daily winner", tier: "gold" },
  { min: 1, icon: "👑", label: "Daily winner", tier: "crown" },
];
/** Total puzzles completed → collector tier. */
const PLAY_TIERS: { min: number; icon: string; label: string; tier: BadgeTier }[] = [
  { min: 250, icon: "🌍", label: "250 puzzles", tier: "diamond" },
  { min: 100, icon: "🌲", label: "100 puzzles", tier: "gold" },
  { min: 50, icon: "🌿", label: "50 puzzles", tier: "silver" },
  { min: 25, icon: "🌱", label: "25 puzzles", tier: "bronze" },
  { min: 10, icon: "🌱", label: "10 puzzles", tier: "plain" },
  { min: 1, icon: "🌱", label: "First puzzle", tier: "plain" },
];
/** Streak milestones (best streak ever). */
const STREAK_TIERS: { min: number; label: string; tier: BadgeTier }[] = [
  { min: 100, label: "100-day streak", tier: "diamond" },
  { min: 30, label: "30-day streak", tier: "gold" },
  { min: 7, label: "7-day streak", tier: "silver" },
];
/** Per-clade dedication: play this many games in one group. */
const CLADE_PLAY_MIN = 25;

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

/** Milestone badges from local stats — no network, always available. Only DAILY
 *  games count toward badges; free play is unranked and earns nothing (it still
 *  shows in the account Practice stats for personal viewing). */
export function localBadges(stats: DerivedStats): Badge[] {
  const out: Badge[] = [];

  // Daily puzzles completed.
  const played = highest(PLAY_TIERS, stats.daily.played);
  if (played) out.push({ id: "played", icon: played.icon, label: played.label, tier: played.tier, desc: `${stats.daily.played} daily puzzles completed` });

  // Best streak.
  const streak = highest(STREAK_TIERS, stats.daily.maxStreak);
  if (streak) out.push({ id: "streak", icon: "🔥", label: streak.label, tier: streak.tier, desc: `Best daily streak: ${stats.daily.maxStreak}` });

  // Per-clade dedication (daily games in one group).
  for (const g of stats.daily.groups) {
    if (g.played >= CLADE_PLAY_MIN) {
      out.push({ id: `clade-${g.id}`, icon: g.icon, label: `${g.label} regular`, tier: "silver", desc: `${g.played} daily games in ${g.label}` });
    }
  }

  return out;
}

/** Competitive badges from the server standing — gated to meaningful pools. */
export function competitiveBadges(server: PlayerBadges | null): Badge[] {
  if (!server) return [];
  const out: Badge[] = [];

  const win = highest(WIN_TIERS, server.daily_wins);
  if (win) out.push({ id: "winner", icon: win.icon, label: win.label, tier: win.tier, desc: `Topped the daily leaderboard ${server.daily_wins}×` });

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

/** How many more DAILY puzzles to the next collector tier (a gentle nudge), or null. */
export function nextPlayMilestone(stats: DerivedStats): { remaining: number; label: string } | null {
  const total = stats.daily.played;
  const next = [...PLAY_TIERS].reverse().find((t) => t.min > total);
  return next ? { remaining: next.min - total, label: next.label } : null;
}
