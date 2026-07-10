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
