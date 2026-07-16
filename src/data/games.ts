import { supabase } from "./supabase";

export interface GameRow {
  userId: string;
  puzzleDate: string; // the daily's date (only daily games are recorded)
  scopeId: string;
  cladeGroup: string;
  won: boolean;
  guessIds: string[];
  hintIds: string[];
  // Descriptive detail — stored but never scored (see submit_game).
  answerId: string;
  assist: boolean;
  winWithin: number;
  par: number | null;
}

export interface TodayDaily {
  guess_ids: string[] | null;
  hint_ids: string[] | null;
  won: boolean;
}

/** The signed-in player's row for today's daily, or null (RLS scopes it to the
 *  caller). Lets the home page restore an already-played daily on any device. */
export async function fetchTodayDaily(puzzleDate: string): Promise<TodayDaily | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("games")
      .select("guess_ids, hint_ids, won")
      .eq("mode", "daily")
      .eq("puzzle_date", puzzleDate)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as TodayDaily;
  } catch {
    return null;
  }
}

export interface LeaderboardEntry {
  display_name: string;
  total_score: number;
  games: number;
  wins: number;
}

export type LeaderboardPeriod = "day" | "week" | "month" | "all";

export interface Standing {
  total_players: number;
  my_rank: number | null;
  my_score: number | null;
  my_games: number | null;
  my_wins: number | null;
  avg_score: number | null;
  /** Population "par": average guesses among solved games in the filter. */
  avg_guesses: number | null;
}

/** The caller's standing (rank + total players) for a filter. When `forDate` is
 *  set, the standing is for exactly that past puzzle date (period is ignored). */
export async function fetchStanding(
  period: LeaderboardPeriod = "all",
  groupKey: string | null = null,
  forDate: string | null = null
): Promise<Standing | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("leaderboard_standing", { period, group_key: groupKey, for_date: forDate });
    if (error || !data || !data[0]) return null;
    return data[0] as Standing;
  } catch {
    return null;
  }
}

/** Fetch the ranked leaderboard (daily games only), filtered by time window and
 *  optionally a clade group. Returns [] if Supabase isn't configured or fails. */
export async function fetchLeaderboard(
  period: LeaderboardPeriod = "all",
  groupKey: string | null = null,
  limit = 50,
  forDate: string | null = null
): Promise<LeaderboardEntry[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc("leaderboard", {
      period,
      group_key: groupKey,
      limit_n: limit,
      for_date: forDate,
    });
    if (error || !data) return [];
    return data as LeaderboardEntry[];
  } catch {
    return [];
  }
}

/** The caller's live badge inputs: daily-win count + rank/total overall and per
 *  clade group. All computed server-side; the client maps them to badge tiers.
 *  Returns null when Supabase isn't configured or the call fails. */
export async function fetchPlayerBadges(): Promise<import("./badges").PlayerBadges | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("player_badges");
    if (error || !data) return null;
    return data as import("./badges").PlayerBadges;
  } catch {
    return null;
  }
}

/** Record one finished DAILY game via the submit_game() RPC (direct INSERT is
 *  denied by RLS; free play isn't stored server-side). The server pins `tier`
 *  from the date and derives guess/hint counts from the id arrays. The trailing
 *  fields are descriptive detail and don't affect scoring. Best-effort. */
export async function recordGame(g: GameRow): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc("submit_game", {
      p_mode: "daily",
      p_puzzle_date: g.puzzleDate,
      p_scope_id: g.scopeId,
      p_clade_group: g.cladeGroup,
      p_won: g.won,
      p_guess_ids: g.guessIds,
      p_hint_ids: g.hintIds,
      p_answer_id: g.answerId,
      p_assist: g.assist,
      p_win_within: g.winWithin,
      p_par: g.par,
    });
  } catch {
    /* best-effort — a lost row shouldn't break the game */
  }
}

// ---- Kinship (grid) recording (see supabase/kinship.sql) ----
// Leaderboard/standing/badges now go through the shared game-parameterised
// fetchers below (fetchGameLeaderboard etc.).

/** Record one finished Kinship daily via submit_grid_game() (direct INSERT is
 *  denied by RLS). The server pins `tier` from the date; `won`/`mistakes` are
 *  client-reported. One row per player per day. Best-effort. */
export async function recordGridGame(g: { puzzleDate: string; won: boolean; mistakes: number }): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc("submit_grid_game", {
      p_puzzle_date: g.puzzleDate,
      p_won: g.won,
      p_mistakes: g.mistakes,
    });
  } catch {
    /* best-effort */
  }
}

// ---- Branches (see supabase/branches.sql) ----

/** Record one finished Branches daily via submit_branches_game() (direct INSERT
 *  is denied by RLS). The server pins `tier` from the date; the placement counts
 *  are client-reported. One row per player per day. Best-effort. */
export async function recordBranchesGame(g: {
  puzzleDate: string; won: boolean; correct: number; total: number; hinted: number; peeked: number;
}): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc("submit_branches_game", {
      p_puzzle_date: g.puzzleDate,
      p_won: g.won,
      p_correct: g.correct,
      p_total: g.total,
      p_hinted: g.hinted,
      p_peeked: g.peeked,
    });
  } catch {
    /* best-effort */
  }
}

// ---- Shared, game-parameterised leaderboard/standing/badges ----
// Each game has the same RPC shape (see the per-game *.sql files); this registry
// maps a game to its function names so the UI can share one leaderboard component.
// Lineage additionally filters by clade group; the others don't.

export type GameId = "lineage" | "kinship" | "branches";

/** A player's standing, normalised across games: the game-specific "par" (avg
 *  guesses / mistakes / correct) is surfaced as a single `par` field + label. */
export interface GameStanding {
  total_players: number;
  my_rank: number | null;
  my_score: number | null;
  my_games: number | null;
  my_wins: number | null;
  avg_score: number | null;
  par: number | null;
}

interface GameLbConfig { lb: string; standing: string; badges: string; parKey: string; parLabel: string; groups: boolean; }
const GAME_LB: Record<GameId, GameLbConfig> = {
  lineage:  { lb: "leaderboard",          standing: "leaderboard_standing",          badges: "player_badges",          parKey: "avg_guesses",  parLabel: "guesses",  groups: true },
  kinship:  { lb: "grid_leaderboard",     standing: "grid_leaderboard_standing",     badges: "grid_player_badges",     parKey: "avg_mistakes", parLabel: "mistakes", groups: false },
  branches: { lb: "branches_leaderboard", standing: "branches_leaderboard_standing", badges: "branches_player_badges", parKey: "avg_correct",  parLabel: "correct",  groups: false },
};

/** The noun for a game's population "par" line (e.g. "mistakes"). */
export function gameParLabel(game: GameId): string { return GAME_LB[game].parLabel; }

/** Ranked board for any game, filtered by window (or pinned to `forDate`). */
export async function fetchGameLeaderboard(
  game: GameId,
  period: LeaderboardPeriod = "all",
  opts: { limit?: number; forDate?: string | null; groupKey?: string | null } = {}
): Promise<LeaderboardEntry[]> {
  if (!supabase) return [];
  const c = GAME_LB[game];
  const params: Record<string, unknown> = { period, limit_n: opts.limit ?? 50, for_date: opts.forDate ?? null };
  if (c.groups) params.group_key = opts.groupKey ?? null;
  try {
    const { data, error } = await supabase.rpc(c.lb, params);
    if (error || !data) return [];
    return data as LeaderboardEntry[];
  } catch {
    return [];
  }
}

/** The caller's standing for any game, with the game's par normalised to `par`. */
export async function fetchGameStanding(
  game: GameId,
  period: LeaderboardPeriod = "all",
  opts: { forDate?: string | null; groupKey?: string | null } = {}
): Promise<GameStanding | null> {
  if (!supabase) return null;
  const c = GAME_LB[game];
  const params: Record<string, unknown> = { period, for_date: opts.forDate ?? null };
  if (c.groups) params.group_key = opts.groupKey ?? null;
  try {
    const { data, error } = await supabase.rpc(c.standing, params);
    if (error || !data || !data[0]) return null;
    const row = data[0] as Record<string, number | null>;
    return {
      total_players: Number(row.total_players ?? 0),
      my_rank: row.my_rank ?? null,
      my_score: row.my_score ?? null,
      my_games: row.my_games ?? null,
      my_wins: row.my_wins ?? null,
      avg_score: row.avg_score ?? null,
      par: (row[c.parKey] as number | null) ?? null,
    };
  } catch {
    return null;
  }
}

// ---- Combined daily board (all three games, normalised) ----

export interface CombinedEntry {
  display_name: string;
  /** The three normalised game scores averaged into a single 0–100 total. */
  combined: number;
  /** How many of the three games the player has a ranked result for that day. */
  played: number;
  /** Each game's score as a 0–100 share of that game's top score on the day. */
  parts: { lineage: number; kinship: number; branches: number };
}

const COMBINED_GAMES: GameId[] = ["lineage", "kinship", "branches"];

/** The combined daily board for one date: each game's per-player score is scaled
 *  to a 0–100 share of that game's best score on the day (so every game weighs the
 *  same regardless of its raw point scale), then averaged across the three for one
 *  total out of 100. Computed on the client from the existing per-game day boards —
 *  no new server function — so it stays in lock-step with each game's own board.
 *  Players who skipped a game just score 0 for it. Ranked high to low. */
export async function fetchCombinedDaily(forDate: string, limit = 200): Promise<CombinedEntry[]> {
  if (!supabase) return [];
  const boards = await Promise.all(
    COMBINED_GAMES.map((g) => fetchGameLeaderboard(g, "day", { forDate, limit }))
  );
  // The day's top score in each game (≥1 so a game with no results can't divide by
  // zero — it simply contributes 0 to everyone).
  const maxOf = boards.map((rows) => Math.max(1, ...rows.map((r) => r.total_score)));
  const acc = new Map<string, CombinedEntry>();
  boards.forEach((rows, gi) => {
    for (const r of rows) {
      const e =
        acc.get(r.display_name) ??
        { display_name: r.display_name, combined: 0, played: 0, parts: { lineage: 0, kinship: 0, branches: 0 } };
      e.parts[COMBINED_GAMES[gi]] = Math.round((r.total_score / maxOf[gi]) * 100);
      e.played += 1;
      acc.set(r.display_name, e);
    }
  });
  const out = [...acc.values()].map((e) => ({
    ...e,
    combined: Math.round((e.parts.lineage + e.parts.kinship + e.parts.branches) / 3),
  }));
  out.sort(
    (a, b) => b.combined - a.combined || b.played - a.played || a.display_name.localeCompare(b.display_name)
  );
  return out;
}

/** Each opted-in player's CURRENT daily-win streak for a game (name → streak),
 *  from game_streaks(). Only players on a live streak (≥1) are returned. Empty if
 *  the backend isn't configured or the streaks migration hasn't been run. */
export async function fetchGameStreaks(game: GameId): Promise<Record<string, number>> {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase.rpc("game_streaks", { p_game: game });
    if (error || !data) return {};
    const out: Record<string, number> = {};
    for (const r of data as { display_name: string; streak: number }[]) out[r.display_name] = r.streak;
    return out;
  } catch {
    return {};
  }
}

/** The caller's overall (combined-board) champion record: how many past days they
 *  topped the combined leaderboard, and the winning dates. Null when there's no
 *  backend or the streaks migration hasn't been run. */
export async function fetchOverallBadges(): Promise<{ daily_wins: number; win_dates: string[] } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("overall_player_badges");
    if (error || !data) return null;
    return data as { daily_wins: number; win_dates: string[] };
  } catch {
    return null;
  }
}

/** The caller's competitive badge inputs for any game. */
export async function fetchGameBadges(game: GameId): Promise<import("./badges").PlayerBadges | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc(GAME_LB[game].badges);
    if (error || !data) return null;
    return data as import("./badges").PlayerBadges;
  } catch {
    return null;
  }
}
