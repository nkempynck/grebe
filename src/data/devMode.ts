import { useEffect, useState } from "react";

/** Playtest settings for the admin test bench (the games rendered inside the
 *  Admin page). They control which board the sandbox deals — a forced difficulty
 *  and a reshuffle counter. The normal site never reads these; sandbox boards are
 *  never recorded to stats or the leaderboard. Persisted so choices survive a
 *  reload. */
export interface DevSettings {
  /** Force a difficulty tier for the sandbox board (1..7). 0 = auto (weekday). */
  tier: number;
  /** Reshuffle counter — bump to regenerate a fresh board at the current tier. */
  nonce: number;
}

const KEY = "grebe.dev";
const DEFAULT: DevSettings = { tier: 0, nonce: 0 };

function load(): DevSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...(JSON.parse(raw) as Partial<DevSettings>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT };
}

let current = load();
const subs = new Set<() => void>();

export function getDev(): DevSettings {
  return current;
}

/** Patch the playtest settings and notify every subscriber (so an inline test bar
 *  and the admin panel stay in sync within a session). */
export function setDev(patch: Partial<DevSettings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}

/** Bump the reshuffle counter — regenerate a fresh board at the current tier. */
export function reshuffleDev(): void {
  setDev({ nonce: current.nonce + 1 });
}

/** Subscribe a component to live playtest-setting changes. */
export function useDev(): DevSettings {
  const [s, setS] = useState(current);
  useEffect(() => {
    const f = () => setS(getDev());
    subs.add(f);
    f(); // resync in case it changed between module load and mount
    return () => { subs.delete(f); };
  }, []);
  return s;
}
