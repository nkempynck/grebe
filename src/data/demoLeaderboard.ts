import type { LeaderboardEntry, LeaderboardPeriod, Standing } from "./games";

// A fake roster used only to preview the leaderboard layout. Each player has an
// overall skill plus per-group affinities, so filtering by group reorders the
// board (birders rise under Birds, etc.), and shorter time windows scale scores
// down and thin the field — so the demo visibly responds to the controls.
interface DemoPlayer {
  name: string;
  base: number; // all-time overall score
  games: number; // all-time games
  winrate: number;
  aff: Record<string, number>; // group label -> multiplier
}

const ROSTER: DemoPlayer[] = [
  { name: "fernandotron", base: 2600, games: 44, winrate: 0.95, aff: { Mammals: 1.35, Birds: 0.9 } },
  { name: "cladechaser", base: 2380, games: 41, winrate: 0.92, aff: { Insects: 1.5 } },
  { name: "batwoman", base: 2210, games: 46, winrate: 0.86, aff: { Mammals: 1.6 } },
  { name: "mossboss", base: 2040, games: 33, winrate: 0.9, aff: { Plants: 1.7, Fungi: 1.2 } },
  { name: "darwinner", base: 1950, games: 38, winrate: 0.83, aff: {} },
  { name: "sporeprint", base: 1770, games: 30, winrate: 0.88, aff: { Fungi: 1.8 } },
  { name: "birdbrain", base: 1660, games: 27, winrate: 0.9, aff: { Birds: 1.9 } },
  { name: "you", base: 1560, games: 25, winrate: 0.86, aff: { Birds: 1.6, Plants: 0.9 } },
  { name: "gnathostoma", base: 1440, games: 29, winrate: 0.78, aff: { Fish: 1.7 } },
  { name: "pollinatrix", base: 1300, games: 22, winrate: 0.82, aff: { Insects: 1.6, Plants: 1.1 } },
  { name: "lichenist", base: 1180, games: 20, winrate: 0.8, aff: { Fungi: 1.5, Plants: 1.2 } },
  { name: "newtonian", base: 1030, games: 18, winrate: 0.72, aff: { "Other animals": 1.5 } },
  { name: "herpetola", base: 900, games: 15, winrate: 0.75, aff: { "Other animals": 1.4, Fish: 0.9 } },
  { name: "protista", base: 720, games: 12, winrate: 0.66, aff: { "Other animals": 1.3 } },
  { name: "tetrapodd", base: 560, games: 9, winrate: 0.7, aff: { Fish: 1.2 } },
];

const PERIOD_MULT: Record<LeaderboardPeriod, number> = { all: 1, month: 0.48, week: 0.2, day: 0.06 };
const GAMES_MULT: Record<LeaderboardPeriod, number> = { all: 1, month: 0.5, week: 0.22, day: 0.08 };

export interface DemoBoard {
  rows: LeaderboardEntry[];
  totalPlayers: number;
  standing: Standing | null;
}

/** Deterministic fake board for (period, group). groupLabel null = overall. */
export function demoBoard(period: LeaderboardPeriod, groupLabel: string | null): DemoBoard {
  const pm = PERIOD_MULT[period];
  const gm = GAMES_MULT[period];

  const scored = ROSTER.map((p) => {
    const games = Math.round(p.games * gm);
    const aff = groupLabel ? p.aff[groupLabel] ?? 0.3 : 1;
    const score = Math.round(p.base * pm * aff);
    return {
      display_name: p.name,
      total_score: score,
      games,
      wins: Math.round(games * p.winrate),
    };
  })
    // only players who "played" this window and scored in this group
    .filter((r) => r.games >= 1 && r.total_score > 0)
    .sort((a, b) => b.total_score - a.total_score);

  const myIdx = scored.findIndex((r) => r.display_name === "you");
  const mine = myIdx >= 0 ? scored[myIdx] : null;
  const avg = scored.length ? Math.round(scored.reduce((s, r) => s + r.total_score, 0) / scored.length) : 0;

  return {
    rows: scored.slice(0, 10),
    totalPlayers: scored.length,
    standing: mine
      ? { total_players: scored.length, my_rank: myIdx + 1, my_score: mine.total_score, my_games: mine.games, my_wins: mine.wins, avg_score: avg, avg_guesses: 6.4 }
      : { total_players: scored.length, my_rank: null, my_score: null, my_games: null, my_wins: null, avg_score: avg, avg_guesses: 6.4 },
  };
}
