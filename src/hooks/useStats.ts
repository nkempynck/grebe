import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { todayKey } from "../core/daily";
import {
  applyDaily,
  applyFree,
  derive,
  fetchCloudStats,
  loadStore,
  pushCloudStats,
  recordDaily,
  recordFree,
  saveStore,
  isEmptyStore,
  type DailyEntry,
  type DailyGroupResolver,
  type DerivedStats,
} from "../data/stats";

interface PendingRecord {
  mode: "daily" | "free";
  groupId: string;
  entry: DailyEntry;
  date: string;
}

export interface UseStats {
  stats: DerivedStats;
  /** True while the initial cloud pull is in flight (signed-in only). */
  syncing: boolean;
  record: (mode: "daily" | "free", groupId: string, entry: DailyEntry) => void;
}

/** @param userId  signed-in player's id, or null for local-only.
 *  @param groupForDate  resolves a daily's clade group from its date, so
 *  per-clade daily stats work even for entries recorded before groups existed. */
export function useStats(userId: string | null, groupForDate?: DailyGroupResolver): UseStats {
  const today = todayKey();
  const [store, setStore] = useState(() => loadStore());
  const [syncing, setSyncing] = useState(false);
  // False until the initial cloud pull has settled. Until then we must NOT push,
  // or a fresh-device finish would overwrite the cloud with a near-empty store.
  const synced = useRef(false);
  // Records made during that window, replayed onto the cloud store once it lands.
  const pending = useRef<PendingRecord[]>([]);

  // When a player signs in, adopt the cloud row as the source of truth; if the
  // cloud is empty, seed it from this device's local stats. On sign-out, fall
  // back to whatever is stored locally.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      synced.current = true; // local-only: no cloud to race, push is a no-op
      setStore(loadStore());
      return;
    }
    synced.current = false;
    setSyncing(true);
    (async () => {
      const cloud = await fetchCloudStats();
      if (cancelled) return;
      let base: ReturnType<typeof loadStore>;
      let needsPush: boolean;
      if (cloud && !isEmptyStore(cloud)) {
        // Cloud is authoritative — but replay anything recorded while it was in
        // flight so it isn't lost, then push only if we actually added to it.
        base = cloud;
        for (const p of pending.current) {
          base = p.mode === "daily" ? applyDaily(base, p.date, p.entry, p.groupId) : applyFree(base, p.entry, p.groupId);
        }
        needsPush = pending.current.length > 0;
      } else {
        // No cloud yet — seed it from local (which already includes any window
        // records, since those were saved locally as they happened).
        base = loadStore();
        needsPush = true;
      }
      pending.current = [];
      saveStore(base);
      setStore(base);
      synced.current = true;
      if (needsPush) void pushCloudStats(base);
      setSyncing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const stats = useMemo(() => derive(store, today, groupForDate), [store, today, groupForDate]);

  const record = useCallback(
    (mode: "daily" | "free", groupId: string, entry: DailyEntry) => {
      // Always persist + reflect locally for immediate UI.
      const next = mode === "daily" ? recordDaily(today, entry, groupId) : recordFree(entry, groupId);
      const cloned = { ...next, history: { ...next.history }, clades: { ...next.clades } };
      setStore(cloned);
      if (!userId) return;
      if (!synced.current) {
        // Cloud pull still in flight — defer the push and replay after it lands,
        // so we merge onto the real cloud history instead of clobbering it.
        pending.current.push({ mode, groupId, entry, date: today });
        return;
      }
      void pushCloudStats(cloned);
    },
    [today, userId]
  );

  return { stats, syncing, record };
}
