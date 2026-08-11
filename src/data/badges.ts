/** Badges, in two families:
 *   • MILESTONE — absolute, personal. Derived from local stats (games played,
 *     streaks). Work solo, offline, from day one.
 *   • COMPETITIVE — relative. Derived from the server's player_badges() (daily
 *     wins + live rank/total, overall and per clade). Gated so they don't show
 *     until the pool is meaningful.
 *  All thresholds live here so they can be tuned without a schema change. */

import { cladeGroup } from "./clades";
import { addDays, type DerivedStats } from "./stats";

export type BadgeTier = "bronze" | "silver" | "gold" | "diamond" | "crown" | "plain";

export interface Badge {
  id: string;
  icon: string;
  label: string;
  /** What YOU did for it, in numbers ("27 puzzles completed"). */
  desc: string;
  /** How the badge is earned, in general ("Awarded at 25 puzzles played"). Every
   *  badge carries one: they're all clickable, and a medal nobody can explain is
   *  just decoration. */
  criteria: string;
  tier: BadgeTier;
  /** Formatted dates behind the badge — a champion's winning periods (newest
   *  first) or a one-time badge's single earned-on date. */
  occurrences?: string[];
  /** Verb for the dates panel: champions were "won", milestones were "earned". */
  occLabel?: string;
}

/** Human name for a tier, shown in the badge's detail panel ("Gold"). */
export const TIER_LABEL: Record<BadgeTier, string> = {
  crown: "Crown", diamond: "Diamond", gold: "Gold", silver: "Silver", bronze: "Bronze", plain: "",
};

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

/** What overall_player_badges() returns for the combined board. Unlike a single
 *  game's daily win, a tie at the top is SHARED: everyone level on the day keeps
 *  it, and `shared_dates` is the subset of `win_dates` somebody else matched
 *  exactly. Empty on a backend that predates the shared crown. */
export interface OverallBadges {
  daily_wins: number;
  win_dates: string[];
  shared_dates: string[];
  /** Completed weeks/months topped on the combined board, and their start dates
   *  (Monday / the 1st). Optional: a backend that predates the period crowns
   *  returns neither, and the badges simply don't render. */
  week_wins?: number;
  week_dates?: string[];
  month_wins?: number;
  month_dates?: string[];
}

/** Where a celebrated win came from: one of the three games, or the combined board. */
export type WinSource = "lineage" | "kinship" | "branches" | "overall";

/** Celebrated-wins storage, one key per source so each game's banner is tracked
 *  independently. Lineage keeps the original un-suffixed key: it was the only
 *  celebrated source before, and reusing it means a device that has already seen
 *  its Lineage wins doesn't get them dumped again as new. */
const SEEN_WINS_KEY: Record<WinSource, string> = {
  lineage: "grebe.seenWins",
  kinship: "grebe.seenWins.kinship",
  branches: "grebe.seenWins.branches",
  overall: "grebe.seenWins.overall",
};

/** Compare a source's win dates against what we've already celebrated on this
 *  device, and return the newly-won dates (newest first). On the very first run
 *  it records all existing wins as a baseline and returns none — so historical
 *  wins aren't dumped as "new". Best-effort; storage failures just skip the nudge.
 *
 *  Only call this with dates the server actually returned: passing an empty list
 *  because a fetch failed would write an EMPTY baseline, and every past win would
 *  then be celebrated as new on the next successful load. */
export function newDailyWins(source: WinSource, winDates: string[]): string[] {
  const key = SEEN_WINS_KEY[source];
  try {
    const raw = localStorage.getItem(key);
    const merge = (all: string[]) =>
      localStorage.setItem(key, JSON.stringify([...new Set(all)]));
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
/** Entrants a period needs before topping it counts as a championship. Display
 *  only — the gate itself lives server-side; MUST match supabase/badges.sql. */
const MIN_DAY_PLAYERS = 3;
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
  count: number, dates: string[], fmt: (d: string) => string,
  criteria: string
): Badge | null {
  const t = highest(CHAMP_TIERS, count);
  if (!t) return null;
  return {
    id, icon, tier: t.tier,
    label: t.min === 1 ? singular : `${t.min}× ${singular}`,
    desc: `Topped the ${periodNoun} board ${count}×`,
    criteria,
    occurrences: dates.map(fmt),
  };
}
// Milestone tiers shared by both games. Labels are built from the count + the
// game's noun (puzzle/board), so Lineage and Kinship reuse the same thresholds.
type CountTier = { min: number; icon: string; tier: BadgeTier };

/** Puzzles/boards completed → collector tier (participation; a give-up or a lost
 *  board still counts as played, it just doesn't count as solved). */
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
/** Boards solved with no help at all — what counts as "no help" is the game's
 *  business (Kinship: no mistake, no paid peek; Branches: no mistake, hint or peek),
 *  so each game passes its own dates and its own wording. */
const FLAWLESS_TIERS: CountTier[] = [
  { min: 25, icon: "✨", tier: "diamond" },
  { min: 10, icon: "✨", tier: "gold" },
  { min: 1, icon: "✨", tier: "plain" },
];
/** Streak milestones (best streak ever). Shared by all three games; labelled in
 *  days. A streak is now a run of days WON, with no give-up bridge and no
 *  forgiveness for a lost board (see deriveStreaks in ./stats), so the ladder
 *  starts low: three clean days in a row is a real result, and the long tiers are
 *  correspondingly rarer than they were. */
const STREAK_TIERS: { min: number; tier: BadgeTier }[] = [
  { min: 365, tier: "crown" },
  { min: 100, tier: "diamond" },
  { min: 30, tier: "gold" },
  { min: 14, tier: "silver" },
  { min: 7, tier: "silver" },
  { min: 3, tier: "bronze" },
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
  /** First day of the best streak — every day of a streak is a win, so the N-day
   *  tier was reached exactly N−1 days after it. */
  bestStreakStart: string | null;
  /** Perfect (unaided) win dates, for the games that have such a notion. */
  flawlessDates?: string[];
  /** How this game words a flawless board, e.g. "no mistakes or paid peeks". */
  flawlessDesc?: string;
}

/** Milestone badges common to every game: play-count (participation), solves
 *  (personal wins, any rank), best streak, and — when provided — flawless wins.
 *  Each carries the date it was earned. No network; always available. */
function milestoneBadges(m: Milestone): Badge[] {
  const out: Badge[] = [];

  const played = highest(PLAY_TIERS, m.playedDates.length);
  if (played) out.push({ id: `${m.ns}-played`, icon: played.icon, tier: played.tier, label: playLabel(played.min, m.noun), desc: `${m.playedDates.length} ${m.noun}s completed`, criteria: `Awarded for finishing ${played.min} daily ${m.noun}${played.min === 1 ? "" : "s"}. Any finish counts, solved or not.`, ...earnedAt(m.playedDates, played.min) });

  const solved = highest(SOLVE_TIERS, m.solvedDates.length);
  if (solved) out.push({ id: `${m.ns}-solved`, icon: solved.icon, tier: solved.tier, label: solved.min === 1 ? "First solve" : `${solved.min} solved`, desc: `${m.solvedDates.length} ${m.noun}s solved`, criteria: `Awarded for solving ${solved.min} daily ${m.noun}${solved.min === 1 ? "" : "s"}, at any rank.`, ...earnedAt(m.solvedDates, solved.min) });

  const streak = highest(STREAK_TIERS, m.maxStreak);
  if (streak) {
    // The day the tier was actually reached, not the day the run ended: on a
    // 40-day best run the 7-day badge was earned 33 days before the run finished.
    const on = m.bestStreakStart ? addDays(m.bestStreakStart, streak.min - 1) : null;
    out.push({ id: `${m.ns}-streak`, icon: "🔥", tier: streak.tier, label: `${streak.min}-day streak`, desc: `Best ${m.noun} streak: ${m.maxStreak}`, criteria: `Awarded for winning ${streak.min} days in a row. Any day not won ends a run, and only your best run ever counts here.`, ...(on ? { occurrences: [fmtDayY(on)], occLabel: "earned" } : {}) });
  }

  if (m.flawlessDates) {
    const fl = highest(FLAWLESS_TIERS, m.flawlessDates.length);
    if (fl) out.push({ id: `${m.ns}-flawless`, icon: fl.icon, tier: fl.tier, label: fl.min === 1 ? "First flawless" : `${fl.min} flawless`, desc: `${m.flawlessDates.length} ${m.noun}s solved with ${m.flawlessDesc ?? "no help"}`, criteria: `Awarded for solving ${fl.min} ${m.noun}${fl.min === 1 ? "" : "s"} with ${m.flawlessDesc ?? "no help"}.`, ...earnedAt(m.flawlessDates, fl.min) });
  }

  return out;
}

/** Lineage (guess-the-organism) milestones + per-clade dedication. */
export function lineageBadges(stats: DerivedStats): Badge[] {
  const d = stats.daily;
  const out = milestoneBadges({ ns: "lin", noun: "puzzle", playedDates: d.playedDates, solvedDates: d.solvedDates, maxStreak: d.maxStreak, bestStreakStart: d.bestStreakStart });
  for (const g of d.groups) {
    if (g.played >= CLADE_PLAY_MIN) {
      out.push({ id: `clade-${g.id}`, icon: g.icon, label: `${g.label} regular`, tier: "silver", desc: `${g.played} daily games in ${g.label}`, criteria: `Awarded for playing ${CLADE_PLAY_MIN} daily puzzles whose answer was in ${g.label}. Which clade a day belongs to is set by its answer, not by you.` });
    }
  }
  return out;
}

/** Kinship (grid) milestones, including flawless (no mistake, no paid peek) boards. */
export function kinshipBadges(stats: DerivedStats): Badge[] {
  const k = stats.kinship;
  return milestoneBadges({ ns: "kin", noun: "board", playedDates: k.playedDates, solvedDates: k.solvedDates, maxStreak: k.maxStreak, bestStreakStart: k.bestStreakStart, flawlessDates: k.flawlessDates, flawlessDesc: "no mistakes or paid peeks" });
}

/** Branches milestones, including flawless (no mistake, hint or peek) full rebuilds. */
export function branchesBadges(stats: DerivedStats): Badge[] {
  const b = stats.branches;
  return milestoneBadges({ ns: "brn", noun: "board", playedDates: b.playedDates, solvedDates: b.solvedDates, maxStreak: b.maxStreak, bestStreakStart: b.bestStreakStart, flawlessDates: b.flawlessDates, flawlessDesc: "no mistakes, hints or peeks" });
}

/** Competitive badges from the server standing — day/week/month champions (with
 *  the winning periods to click through) + all-time percentile. Game-agnostic:
 *  pass either player_badges() (Lineage) or grid_player_badges() (Kinship).
 *  Gated to meaningful pools server-side (≥3 entrants) and here (percentile pool). */
export function competitiveBadges(server: PlayerBadges | null): Badge[] {
  if (!server) return [];
  const out: Badge[] = [];

  const day = champBadge("champ-day", "👑", "daily winner", "daily", server.daily_wins, server.win_dates, fmtDay,
    `Awarded for the top score on a finished day with at least ${MIN_DAY_PLAYERS} players. Ties go to whoever submitted first.`);
  if (day) out.push(day);
  const week = champBadge("champ-week", "🏆", "weekly champion", "weekly", server.week_wins, server.week_dates, fmtWeek,
    `Awarded for the highest total across a finished week (Monday to Sunday) with at least ${MIN_DAY_PLAYERS} players.`);
  if (week) out.push(week);
  const month = champBadge("champ-month", "🎖️", "monthly champion", "monthly", server.month_wins, server.month_dates, fmtMonth,
    `Awarded for the highest total across a finished calendar month with at least ${MIN_DAY_PLAYERS} players.`);
  if (month) out.push(month);

  const pctCriteria = (max: number, where: string) =>
    `Awarded for standing in the top ${max}% of ${where} by all-time score. Live: it moves as you and everyone else play, and needs a pool of ${MIN_POOL}+.`;

  const overall = pctTier(server.overall);
  if (overall && server.overall) {
    out.push({ id: "pct-overall", icon: overall.icon, label: `${overall.label} overall`, tier: overall.tier, desc: `Rank ${server.overall.rank} of ${server.overall.total} by total score`, criteria: pctCriteria(overall.max, "every ranked player") });
  }

  for (const [id, standing] of Object.entries(server.groups)) {
    const t = pctTier(standing);
    if (t) {
      const g = cladeGroup(id);
      out.push({ id: `pct-${id}`, icon: g.icon, label: `${t.label} · ${g.label}`, tier: t.tier, desc: `Rank ${standing.rank} of ${standing.total} in ${g.label}`, criteria: pctCriteria(t.max, `everyone who has played a ${g.label} daily`) });
    }
  }

  return out;
}

/** The overall (combined-board) badges, from overall_player_badges(): the tiered
 *  👑 for topping the day's combined leaderboard, plus 🤝 for the days that top
 *  spot was shared. Empty until the first overall win. */
export function overallBadges(server: OverallBadges | null): Badge[] {
  if (!server) return [];
  const out: Badge[] = [];
  const b = champBadge(
    "champ-overall", "👑", "overall daily champion", "overall daily",
    server.daily_wins, server.win_dates, fmtDay,
    `Awarded for topping the combined daily board: each game's score scaled against that day's best, averaged over all three. Finished days with at least ${MIN_DAY_PLAYERS} players only. A tie is shared, so nobody is knocked off a day they were level on.`
  );
  if (b) out.push(b);

  // Same 🏆/🎖️ as a single game's champions (champBadge, fmtWeek, fmtMonth are
  // shared with competitiveBadges), earned on the combined board instead: the
  // highest SUM of daily combined scores across a finished week or month. Absent
  // on a backend without the period crowns, hence the ?? 0.
  const week = champBadge(
    "champ-overall-week", "🏆", "overall weekly champion", "overall weekly",
    server.week_wins ?? 0, server.week_dates ?? [], fmtWeek,
    `Awarded for the highest combined total across a finished week (Monday to Sunday), adding up each day's combined score. Weeks with at least ${MIN_DAY_PLAYERS} players only.`
  );
  if (week) out.push(week);
  const month = champBadge(
    "champ-overall-month", "🎖️", "overall monthly champion", "overall monthly",
    server.month_wins ?? 0, server.month_dates ?? [], fmtMonth,
    `Awarded for the highest combined total across a finished calendar month, adding up each day's combined score. Months with at least ${MIN_DAY_PLAYERS} players only.`
  );
  if (month) out.push(month);

  const shared = server.shared_dates ?? [];
  if (shared.length > 0) {
    out.push({
      id: "joint-custody",
      icon: "🤝",
      label: shared.length === 1 ? "joint custody" : `${shared.length}× joint custody`,
      tier: "plain",
      desc: `Best of the day alongside somebody else on ${shared.length} day${shared.length === 1 ? "" : "s"}`,
      criteria: "Awarded for topping the combined daily board on a day another player matched you exactly, game for game. Neither of you loses the day: the 👑 counts for both.",
      occurrences: shared.map(fmtDay),
      occLabel: "shared",
    });
  }
  return out;
}

/** How many more plays to the next collector tier (a gentle nudge), or null.
 *  `noun` labels it per game ('puzzle' for Lineage, 'board' for Kinship). */
export function nextPlayMilestone(played: number, noun = "puzzle"): { remaining: number; label: string } | null {
  const next = [...PLAY_TIERS].reverse().find((t) => t.min > played);
  return next ? { remaining: next.min - played, label: playLabel(next.min, noun) } : null;
}
