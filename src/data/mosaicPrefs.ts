// Mosaic's player-facing settings.
//
// These are the test bench's tuning knobs, handed to the player, which is the point of the beta:
// the ramp, the reveal mechanic and the geography column are all still being argued about, and
// the fastest way to settle them is to let people run the variants.
//
// What is NOT here matters as much as what is. The rung slider and the autosolve stay behind the
// bench, because every one of them is a way of not playing: scrub the ladder and you have seen
// the picture without spending a guess. A setting a player can use to skip the game is not a
// setting, it is a cheat with a label on it. See MosaicBench.
//
// Modelled on devMode: module-level state, subscribers, localStorage. Same shape, different
// audience.
import { useEffect, useState } from "react";
import type { MosaicMechanic } from "../core/mosaic";
import { MOSAIC_DEFAULT_MECHANIC } from "../core/mosaic";
import type { RegionScheme } from "./geo";

export interface MosaicPrefs {
  /** Forced difficulty tier 1…7, or 0 to follow the weekday like the other three games. */
  tier: number;
  mechanic: MosaicMechanic;
  regionScheme: RegionScheme;
}

const KEY = "grebe.mosaic.prefs";
const DEFAULT: MosaicPrefs = { tier: 0, mechanic: MOSAIC_DEFAULT_MECHANIC, regionScheme: "continent" };

/** Field by field, never a spread. This is whatever a previous version of the app left in the
 *  browser, and a stored tier of 99 or a mechanic of "blurr" would otherwise reach mosaicAids
 *  and the reveal ladder as though it were a real setting. Anything unrecognised falls back to
 *  the default for that field alone, so one bad key does not discard the rest. */
export function sanitisePrefs(raw: unknown): MosaicPrefs {
  const p = (raw ?? {}) as Partial<MosaicPrefs>;
  return {
    tier: Number.isFinite(p.tier) ? Math.min(7, Math.max(0, Math.round(p.tier as number))) : DEFAULT.tier,
    mechanic: p.mechanic === "blur" || p.mechanic === "shuffle" ? p.mechanic : DEFAULT.mechanic,
    regionScheme:
      p.regionScheme === "realm" || p.regionScheme === "continent" ? p.regionScheme : DEFAULT.regionScheme,
  };
}

function load(): MosaicPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? sanitisePrefs(JSON.parse(raw)) : { ...DEFAULT };
  } catch {
    return { ...DEFAULT };
  }
}

let current = load();
const subs = new Set<() => void>();

export function getMosaicPrefs(): MosaicPrefs {
  return current;
}

export function setMosaicPrefs(patch: Partial<MosaicPrefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode — the choice still holds for this session */
  }
  subs.forEach((f) => f());
}

export function resetMosaicPrefs(): void {
  setMosaicPrefs({ ...DEFAULT });
}

/** True when nothing has been changed from the defaults, so the panel can say so. */
export function mosaicPrefsAreDefault(p: MosaicPrefs): boolean {
  return p.tier === DEFAULT.tier && p.mechanic === DEFAULT.mechanic && p.regionScheme === DEFAULT.regionScheme;
}

export function useMosaicPrefs(): MosaicPrefs {
  const [p, setP] = useState(current);
  useEffect(() => {
    const f = () => setP(current);
    subs.add(f);
    f();
    return () => { subs.delete(f); };
  }, []);
  return p;
}
