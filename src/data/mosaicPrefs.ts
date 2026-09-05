// Mosaic's player-facing settings. There is no settings PANEL any more: both surviving fields
// are set from where they take effect — the region tabs sit over the guess table's map column,
// and the reveal mechanic is a bench control. This module is what makes either choice outlive a
// reload, which is its whole remaining job.
//
// What is NOT here matters as much as what is. The rung slider and the autosolve stay behind the
// bench, because every one of them is a way of not playing: scrub the ladder and you have seen
// the picture without spending a guess. A setting a player can use to skip the game is not a
// setting, it is a cheat with a label on it. See MosaicBench.
//
// DIFFICULTY IS NOT A SETTING EITHER, and it briefly was, during the beta. Mosaic is a daily now:
// the weekday decides the aids for everyone, the same way it does in the other three games, and a
// tier a player picks for themselves is not a tier anyone can be ranked against. The stored field
// is gone rather than ignored — left in place it would have kept forcing whatever tier a beta
// player last chose, with no control on screen to tell them why their week looked wrong.
//
// Modelled on devMode: module-level state, subscribers, localStorage. Same shape, different
// audience.
import { useEffect, useState } from "react";
import type { MosaicMechanic } from "../core/mosaic";
import { MOSAIC_DEFAULT_MECHANIC } from "../core/mosaic";
import type { RegionScheme } from "./geo";

export interface MosaicPrefs {
  mechanic: MosaicMechanic;
  regionScheme: RegionScheme;
}

const KEY = "grebe.mosaic.prefs";
const DEFAULT: MosaicPrefs = { mechanic: MOSAIC_DEFAULT_MECHANIC, regionScheme: "continent" };

/** Field by field, never a spread. This is whatever a previous version of the app left in the
 *  browser, and a mechanic of "blurr" would otherwise reach the reveal ladder as though it were
 *  a real setting. Anything unrecognised falls back to the default for that field alone, so one
 *  bad key does not discard the rest. An unknown key — a beta player's stored `tier` — is simply
 *  not read, which is how it stops mattering. */
export function sanitisePrefs(raw: unknown): MosaicPrefs {
  const p = (raw ?? {}) as Partial<MosaicPrefs>;
  return {
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

/** Back to defaults. No control calls this now that the settings row is gone; kept because it
 *  is the only way to undo a stored choice, and a two-line function is a cheaper thing to keep
 *  than to reconstruct. */
export function resetMosaicPrefs(): void {
  setMosaicPrefs({ ...DEFAULT });
}

/** True when nothing has been changed from the defaults, so the panel can say so. */
export function mosaicPrefsAreDefault(p: MosaicPrefs): boolean {
  return p.mechanic === DEFAULT.mechanic && p.regionScheme === DEFAULT.regionScheme;
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
