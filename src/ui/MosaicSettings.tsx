// The player's settings. One quiet row above the picture, not a panel.
//
// Difficulty is the one that matters. In the other three games the weekday IS the difficulty and
// there is nothing to choose, but Mosaic is not a daily yet, so leaving the ramp locked to the
// calendar would mean nobody sees a Saturday board until Saturday. Choosing a tier is the
// fastest way to get the ramp itself tested, which is the whole point of a beta.
//
// The reveal mechanic is NOT here: the picture is always shuffled. Blur stays behind the bench
// as the honest comparison for any future change to the reveal, and costs one branch to keep.
//
// Nor is the rung slider or the autosolve, and for a stronger reason: each is a way of not
// playing. Scrub the ladder and you have seen the picture without spending a guess. A setting a
// player can use to skip the game is not a setting, it is a cheat with a label on it.
import { mosaicAids } from "../core/mosaic";
import {
  setMosaicPrefs, resetMosaicPrefs, mosaicPrefsAreDefault, type MosaicPrefs,
} from "../data/mosaicPrefs";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DIFFICULTY = ["Gentle", "Gentle", "Tricky", "Harder", "Harder", "Brutal", "Brutal"];

/** What a tier hands you, in the order you lose it across the week. Tiers 1 and 2, 4 and 5, and
 *  6 and 7 give the same help as each other and still differ in what a win pays, so all seven
 *  are listed rather than collapsed into four. */
function tierLabel(tier: number): string {
  const a = mosaicAids(tier);
  const help = a.subset ? (a.lookup ? "narrowing and lookups" : "narrowing") : "no narrowing";
  return `${DAY_NAMES[tier - 1]} · ${DIFFICULTY[tier - 1]} · ${help} · ${a.guesses} guesses`;
}

interface Props {
  prefs: MosaicPrefs;
  /** Today's tier, so the default option can name the day it follows. */
  todayTier: number;
}

export function MosaicSettings({ prefs, todayTier }: Props) {
  return (
    <div className="mosaic-settings">
      <label className="mosaic-setting">
        <span className="mosaic-setting-name">Difficulty</span>
        <select
          value={prefs.tier}
          onChange={(e) => setMosaicPrefs({ tier: Number(e.target.value) })}
        >
          <option value={0}>Today ({DAY_NAMES[todayTier - 1]} · {DIFFICULTY[todayTier - 1]})</option>
          {DAY_NAMES.map((day, i) => <option key={day} value={i + 1}>{tierLabel(i + 1)}</option>)}
        </select>
      </label>

      <label className="mosaic-setting">
        <span className="mosaic-setting-name">Regions</span>
        <select
          value={prefs.regionScheme}
          onChange={(e) => setMosaicPrefs({ regionScheme: e.target.value as MosaicPrefs["regionScheme"] })}
          title="Which map the “recorded in” column speaks. Realms follow the wildlife rather than the coastlines, so they split Indonesia and put Mexico with South America."
        >
          <option value="continent">Continents</option>
          <option value="realm">Realms</option>
        </select>
      </label>

      {/* Said only once a tier is actually forced, because that is the only time it is true and
          the only time it is about to happen. The obscurity floor rises when the narrowing goes,
          so the answer pool genuinely differs between tiers and the board cannot survive the
          switch. */}
      {prefs.tier > 0 && (
        <span className="mosaic-settings-note">
          Switching difficulty deals a new animal.
          <button className="linkbtn" onClick={resetMosaicPrefs} hidden={mosaicPrefsAreDefault(prefs)}>
            Reset
          </button>
        </span>
      )}
    </div>
  );
}
