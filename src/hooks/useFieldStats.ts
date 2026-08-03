import { useEffect, useMemo, useState } from "react";
import { fetchDailyAverages, type DayAverage } from "../data/games";
import { deriveField, type FieldStats } from "../data/field";
import { countsForStats, type StatsStore } from "../data/stats";

/** The vs-field comparison for this device's stats: fetches the day averages for
 *  exactly the span the player has played (one round-trip) and folds them against
 *  their own frozen scores. Null until it lands, and null forever when there's no
 *  backend or field.sql hasn't been run — callers just hide the numbers.
 *
 *  Public data, so this works signed out too.
 *
 *  The fetched rows are held in state and the comparison is a MEMO over (rows,
 *  store), never computed inside the fetch callback. That matters: the store is
 *  replaced wholesale when a signed-in player's cloud stats land, and a callback
 *  would fold the averages against whatever snapshot it had closed over at request
 *  time, which is how the numbers could come back empty while both inputs were
 *  fine. Deriving from the live store means a later store always re-derives. */
export function useFieldStats(store: StatsStore): FieldStats | null {
  const [rows, setRows] = useState<DayAverage[] | null>(null);

  // The inclusive span of counted days across all three games.
  const span = useMemo(() => {
    const dates = [
      ...Object.keys(store.history ?? {}),
      ...Object.keys(store.kinship ?? {}),
      ...Object.keys(store.branches ?? {}),
    ].filter(countsForStats).sort();
    return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  }, [store]);

  const from = span?.from;
  const to = span?.to;

  useEffect(() => {
    if (!from || !to) return;
    let live = true;
    fetchDailyAverages(from, to).then((r) => { if (live) setRows(r); });
    return () => { live = false; };
  }, [from, to]);

  return useMemo(() => {
    if (!rows || rows.length === 0) return null;
    const field = deriveField(store, rows);
    if (import.meta.env.DEV && !field.overall) {
      // Both inputs are non-empty yet nothing lined up. Print enough to tell a thin
      // player base (the legitimate case) from a key mismatch (a bug).
      console.warn(
        "[vs-field] no comparable days.",
        `${rows.length} average rows, ${rows.filter((r) => r.players >= 2).length} with a field of 2+.`,
        "sample average key:", rows[0] && `${rows[0].game}:${rows[0].day}`,
        "played dates:", {
          lineage: Object.keys(store.history ?? {}).slice(-3),
          kinship: Object.keys(store.kinship ?? {}).slice(-3),
          branches: Object.keys(store.branches ?? {}).slice(-3),
        }
      );
    }
    return field;
  }, [rows, store]);
}
