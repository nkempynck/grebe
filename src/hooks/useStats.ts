import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { todayKey } from "../core/daily";
import { fetchMyPoints } from "../data/games";
import {
  adoptServerPoints,
  applyDaily,
  applyFree,
  applyKinship,
  applyBranches,
  derive,
  fetchCloudStats,
  loadStore,
  mergeMissingDailies,
  pushCloudStats,
  recordDaily,
  recordFree,
  recordKinship as recordKinshipLocal,
  recordBranches as recordBranchesLocal,
  saveStore,
  clearStore,
  isEmptyStore,
  statsOwner,
  setStatsOwner,
  localStoreTrusted,
  type DailyEntry,
  type KinshipEntry,
  type BranchesEntry,
  type GroupResolvers,
  type DerivedStats,
  type StatsStore,
} from "../data/stats";
import { consumeDeliberateSignOut } from "../data/signOutIntent";

// A record made while the cloud pull was still in flight, replayed once it lands.
type PendingRecord =
  | { kind: "daily" | "free"; groupId: string; entry: DailyEntry; date: string }
  | { kind: "kinship"; entry: KinshipEntry; date: string }
  | { kind: "branches"; entry: BranchesEntry; date: string };

export interface UseStats {
  stats: DerivedStats;
  /** The raw store behind `stats`, for the few consumers that need a single day's
   *  numbers rather than an aggregate (see useFieldStats). */
  store: StatsStore;
  /** True while the initial cloud pull is in flight (signed-in only). */
  syncing: boolean;
  record: (mode: "daily" | "free", groupId: string, entry: DailyEntry) => void;
  /** Record a finished Kinship daily (ranked, once per date). */
  recordKinship: (entry: KinshipEntry) => void;
  /** Record a finished Branches daily (ranked, once per date). */
  recordBranches: (entry: BranchesEntry) => void;
}

/** @param userId  signed-in player's id, or null for local-only.
 *  @param groupFor  per-game resolvers for a day's clade group from its date, so
 *  per-clade stats work even for entries recorded before groups existed. */
export function useStats(userId: string | null, groupFor?: GroupResolvers): UseStats {
  const today = todayKey();
  const [store, setStore] = useState(() => loadStore());
  const [syncing, setSyncing] = useState(false);
  // False until the initial cloud pull has settled. Until then we must NOT push,
  // or a fresh-device finish would overwrite the cloud with a near-empty store.
  const synced = useRef(false);
  // Records made during that window, replayed onto the cloud store once it lands.
  const pending = useRef<PendingRecord[]>([]);
  // Tracks the previous signed-in user so we can tell a genuine sign-OUT (clear
  // the device) from being anonymous since load (keep local progress to carry
  // into a first account).
  const prevUserId = useRef<string | null>(null);

  // When a player signs in, adopt the cloud row as the source of truth; if the
  // cloud is empty, seed it from this device's local stats. On sign-out, wipe the
  // device so the next account can't inherit the previous one's stats.
  useEffect(() => {
    let cancelled = false;
    const wasSignedIn = prevUserId.current !== null;
    prevUserId.current = userId;
    if (!userId) {
      synced.current = true; // local-only: no cloud to race, push is a no-op
      // Only a DELIBERATE sign-out clears the device (that data is safe in the
      // cloud, and the next account here must not inherit it). A session that just
      // vanished — a failed token refresh, a revoked session — leaves the store
      // alone: an infrastructure hiccup shouldn't empty a player's stats page.
      // An anonymous first load keeps whatever local progress is there.
      const deliberate = wasSignedIn && consumeDeliberateSignOut();
      setStore(deliberate ? clearStore() : loadStore());
      return;
    }
    synced.current = false;
    setSyncing(true);
    (async () => {
      // Both in one round-trip: the stats row, and the scores the server has frozen
      // for this player (which win over the local copies, see adoptServerPoints).
      const [cloud, serverPoints] = await Promise.all([fetchCloudStats(), fetchMyPoints()]);
      if (cancelled) return;
      let base: ReturnType<typeof loadStore>;
      let needsPush: boolean;
      if (cloud && !isEmptyStore(cloud)) {
        // Cloud is authoritative, but two kinds of local record must still be
        // folded in or they'd be lost when it overwrites the device:
        //  1. Dailies finished while SIGNED OUT (persisted locally before this
        //     sign-in) — mirrors the pendingSubmits leaderboard replay, so a
        //     returning account's stats don't lag its board rows.
        //  2. Records made DURING the in-flight cloud pull (pending.current).
        // Cloud wins on any date collision, so nothing already-synced is rewritten.
        base = cloud;
        // Fold in the local store only if it's THIS player's or nobody's (played
        // anonymously). A store left behind by another account after a dropped
        // session must not merge into this one — see statsOwner.
        const carried = localStoreTrusted(statsOwner(), userId) ? mergeMissingDailies(base, loadStore()) : 0;
        for (const p of pending.current) {
          if (p.kind === "kinship") base = applyKinship(base, p.date, p.entry);
          else if (p.kind === "branches") base = applyBranches(base, p.date, p.entry);
          else if (p.kind === "daily") base = applyDaily(base, p.date, p.entry, p.groupId);
          else base = applyFree(base, p.entry, p.groupId);
        }
        needsPush = carried > 0 || pending.current.length > 0;
      } else {
        // No cloud yet — seed it from local (which already includes any window
        // records, since those were saved locally as they happened). This is how
        // playing before you register carries into a first account. Same owner
        // check: a fresh account doesn't adopt a store another player left here.
        base = localStoreTrusted(statsOwner(), userId) ? loadStore() : clearStore();
        needsPush = true;
      }
      pending.current = [];
      // Last, so it also corrects anything just merged or replayed above. Pushing
      // when it changes something keeps the correction from being redone on every
      // load, and carries it to this player's other devices.
      if (serverPoints && adoptServerPoints(base, serverPoints) > 0) needsPush = true;
      saveStore(base);
      // This device's store now belongs to this player, so a later sign-in by
      // somebody else can tell it apart from an anonymous one.
      setStatsOwner(userId);
      setStore(base);
      synced.current = true;
      if (needsPush) void pushCloudStats(base);
      setSyncing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const stats = useMemo(() => derive(store, today, groupFor), [store, today, groupFor]);

  const record = useCallback(
    (mode: "daily" | "free", groupId: string, entry: DailyEntry) => {
      // Always persist + reflect locally for immediate UI.
      const next = mode === "daily" ? recordDaily(today, entry, groupId) : recordFree(entry, groupId);
      const cloned = { ...next, history: { ...next.history }, clades: { ...next.clades }, kinship: { ...next.kinship }, branches: { ...next.branches } };
      setStore(cloned);
      if (!userId) return;
      if (!synced.current) {
        // Cloud pull still in flight — defer the push and replay after it lands,
        // so we merge onto the real cloud history instead of clobbering it.
        pending.current.push({ kind: mode, groupId, entry, date: today });
        return;
      }
      void pushCloudStats(cloned);
    },
    [today, userId]
  );

  const recordKinship = useCallback(
    (entry: KinshipEntry) => {
      const next = recordKinshipLocal(today, entry);
      const cloned = { ...next, history: { ...next.history }, clades: { ...next.clades }, kinship: { ...next.kinship }, branches: { ...next.branches } };
      setStore(cloned);
      if (!userId) return;
      if (!synced.current) {
        pending.current.push({ kind: "kinship", entry, date: today });
        return;
      }
      void pushCloudStats(cloned);
    },
    [today, userId]
  );

  const recordBranches = useCallback(
    (entry: BranchesEntry) => {
      const next = recordBranchesLocal(today, entry);
      const cloned = { ...next, history: { ...next.history }, clades: { ...next.clades }, kinship: { ...next.kinship }, branches: { ...next.branches } };
      setStore(cloned);
      if (!userId) return;
      if (!synced.current) {
        pending.current.push({ kind: "branches", entry, date: today });
        return;
      }
      void pushCloudStats(cloned);
    },
    [today, userId]
  );

  return { stats, store, syncing, record, recordKinship, recordBranches };
}
