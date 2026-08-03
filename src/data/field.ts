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
import { countsForStats, pointsByDate, type StatsStore } from "./stats";

/** A day needs at least this many games before it's a "field" to compare against,
 *  one of which is usually yours. Two is too thin: the average would be half the
 *  player's own score, which mechanically halves every swing. */
export const MIN_FIELD_PLAYERS = 3;

export interface FieldStat {
  /** Mean of (your points ÷ the day's average) − 1, as a signed percentage. */
  pct: number;
  /** How many of your days went into it. */
  days: number;
}

export interface FieldStats {
  /** Across all three games, weighted by how many days you played each. */
  overall: FieldStat | null;
  byGame: Record<GameId, FieldStat | null>;
  /** Lineage only — keyed by clade group id (the other games have no persistent
   *  categories). A day's clade comes from its answer, as stored on the entry. */
  byClade: Record<string, FieldStat>;
  /** The clade you're furthest above the field in, among those with enough days. */
  bestCladeId: string | null;
}

/** Clade days needed before a clade's vs-field figure is offered as your best. It
 *  matches STRENGTH_MIN_GAMES in ./stats so the two "best clade" ideas can't
 *  disagree about what counts as enough play. */
export const MIN_CLADE_DAYS = 3;

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const statOf = (ratios: number[]): FieldStat | null =>
  ratios.length ? { pct: Math.round((mean(ratios) - 1) * 100), days: ratios.length } : null;

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
 *  @param averages  day averages from fetchDailyAverages(), any order */
export function deriveField(store: StatsStore, averages: DayAverage[]): FieldStats {
  const avg = indexAverages(averages);
  const pointsOf = pointsByDate(store);
  const ratios: Record<GameId, number[]> = { lineage: [], kinship: [], branches: [] };
  const cladeRatios: Record<string, number[]> = {};

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
      if (game === "lineage") {
        const gid = store.history[d]?.group;
        if (gid) (cladeRatios[gid] ??= []).push(ratio);
      }
    }
  };

  collect("lineage", Object.keys(store.history ?? {}));
  collect("kinship", Object.keys(store.kinship ?? {}));
  collect("branches", Object.keys(store.branches ?? {}));

  const byClade: Record<string, FieldStat> = {};
  for (const [gid, rs] of Object.entries(cladeRatios)) {
    const s = statOf(rs);
    if (s) byClade[gid] = s;
  }

  let bestCladeId: string | null = null;
  let bestPct = -Infinity;
  for (const [gid, s] of Object.entries(byClade)) {
    if (s.days >= MIN_CLADE_DAYS && s.pct > bestPct) { bestPct = s.pct; bestCladeId = gid; }
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
