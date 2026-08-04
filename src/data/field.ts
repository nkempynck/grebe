/** "How well did I play compared to everyone else?" — the one stat that puts a
 *  personal score in context. Your frozen points for a day, divided by that day's
 *  FIELD average (supabase/field.sql), averaged over your days and expressed as a
 *  signed percentage: +24% means that on a typical day you played, you scored a
 *  quarter above the average of everyone who played it.
 *
 *  Deliberate choices, so the number can't flatter anyone:
 *   • FAILED DAYS COUNT, on both sides. The field average includes everyone's zeros,
 *     so a day most of the field failed has a low average and solving it reads big;
 *     symmetrically, a day YOU failed enters as a zero of your own. Averaging their
 *     zeros in while hiding yours would compare your best days against everybody's
 *     every day, and read as above-average for nearly everyone. One consequence
 *     worth knowing: this figure now folds in how OFTEN you win, not just how well
 *     you score when you do.
 *   • Only days with a real field count (MIN_FIELD_PLAYERS): on a thin day the
 *     average is mostly the player themselves, which flattens every swing.
 *   • Each day weighs the same, whatever it paid, since the ratio already divides
 *     out the weekday weight.
 *   • Pre-launch days are excluded upstream (see countsForStats in ./stats).
 *  Pure and offline: the caller supplies the averages, so this is testable and
 *  degrades to null when the backend has no field data. */

import type { DayAverage, GameId } from "./games";
import { countsForStats, pointsByDate, type GroupResolvers, type StatsStore } from "./stats";

/** A day needs at least this many games before it's a "field" to compare against,
 *  one of which is usually yours. Two is too thin: the average would be half the
 *  player's own score, which mechanically halves every swing. */
export const MIN_FIELD_PLAYERS = 3;

export interface FieldStat {
  /** Mean of (your points ÷ the day's average) − 1, as a signed percentage. */
  pct: number;
  /** How many of YOUR GAMES went into it. Per game or per clade that's a count of
   *  days, but the overall figure pools all three games, where 14 days is 42 games —
   *  so the unit is games, and the label has to say games. */
  games: number;
}

export interface FieldStats {
  /** Across all three games, weighted by how many days you played each. */
  overall: FieldStat | null;
  byGame: Record<GameId, FieldStat | null>;
  /** Per game, keyed by clade group id. A day's clade is the one tagged on the entry
   *  at play time, else whatever the date resolver recovers: Lineage from the day's
   *  answer species, Kinship/Branches from the day's board (each sits in exactly one
   *  broad group). A day neither can place is left out. */
  byClade: Record<GameId, Record<string, FieldStat>>;
  /** Per game, the clade you're furthest above the field in among those with enough
   *  days, or null. */
  bestCladeId: Record<GameId, string | null>;
}

/** Clade days needed before a clade's vs-field figure is offered as your best. It
 *  matches STRENGTH_MIN_GAMES in ./stats so the two "best clade" ideas can't
 *  disagree about what counts as enough play. */
export const MIN_CLADE_DAYS = 3;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const statOf = (ratios: number[]): FieldStat | null =>
  ratios.length ? { pct: Math.round((mean(ratios) - 1) * 100), games: ratios.length } : null;

/** Index the averages by game and day for lookup. */
function indexAverages(averages: DayAverage[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of averages) {
    // A field of one is the player alone: no comparison to make.
    if (a.players >= MIN_FIELD_PLAYERS && a.avg > 0) out[`${a.game}:${a.day}`] = a.avg;
  }
  return out;
}

/** Compare a store's frozen per-day points against the field averages.
 *  @param store     the raw stats store (per-day points, frozen at play time)
 *  @param averages  day averages from fetchDailyAverages(), any order
 *  @param groupFor  per-game clade resolvers for days whose entry predates group
 *  tagging, so the vs-field bars cover the same days as the avg-score bars */
export function deriveField(store: StatsStore, averages: DayAverage[], groupFor?: GroupResolvers): FieldStats {
  const avg = indexAverages(averages);
  const pointsOf = pointsByDate(store);
  const ratios: Record<GameId, number[]> = { lineage: [], kinship: [], branches: [] };
  const cladeRatios: Record<GameId, Record<string, number[]>> = { lineage: {}, kinship: {}, branches: {} };
  const taggedGroup: Record<GameId, (d: string) => string | null> = {
    lineage: (d) => store.history[d]?.group ?? groupFor?.lineage?.(d) ?? null,
    kinship: (d) => store.kinship[d]?.group ?? groupFor?.kinship?.(d) ?? null,
    branches: (d) => store.branches[d]?.group ?? groupFor?.branches?.(d) ?? null,
  };

  const collect = (game: GameId, dates: string[]) => {
    for (const d of dates) {
      if (!countsForStats(d)) continue;
      const field = avg[`${game}:${d}`];
      const mine = pointsOf[game](d);
      // No field to compare against, or no game of yours that day.
      if (!field || mine == null) continue;
      // A day you played but didn't score enters as the zero it was — the field
      // average carries everyone else's zeros, so yours belong in it too.
      const ratio = Math.max(0, mine) / field;
      ratios[game].push(ratio);
      const gid = taggedGroup[game](d);
      if (gid) (cladeRatios[game][gid] ??= []).push(ratio);
    }
  };

  collect("lineage", Object.keys(store.history ?? {}));
  collect("kinship", Object.keys(store.kinship ?? {}));
  collect("branches", Object.keys(store.branches ?? {}));

  const byClade: Record<GameId, Record<string, FieldStat>> = { lineage: {}, kinship: {}, branches: {} };
  const bestCladeId: Record<GameId, string | null> = { lineage: null, kinship: null, branches: null };
  for (const game of ["lineage", "kinship", "branches"] as GameId[]) {
    for (const [gid, rs] of Object.entries(cladeRatios[game])) {
      const s = statOf(rs);
      if (s) byClade[game][gid] = s;
    }
    let bestPct = -Infinity;
    for (const [gid, s] of Object.entries(byClade[game])) {
      if (s.games >= MIN_CLADE_DAYS && s.pct > bestPct) { bestPct = s.pct; bestCladeId[game] = gid; }
    }
  }

  // Overall pools every day from every game, so it's weighted by how much you play
  // each — not an equal-weight average of three game figures.
  const all = [...ratios.lineage, ...ratios.kinship, ...ratios.branches];

  return {
    overall: statOf(all),
    byGame: {
      lineage: statOf(ratios.lineage),
      kinship: statOf(ratios.kinship),
      branches: statOf(ratios.branches),
    },
    byClade,
    bestCladeId,
  };
}

/** "+24%" / "−4%" / "even". */
export function fmtFieldPct(pct: number): string {
  if (pct === 0) return "even";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
}
