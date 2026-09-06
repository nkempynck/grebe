import { setDev, reshuffleDev, type DevSettings } from "../data/devMode";

/** Tier → its difficulty name, matching the weekday ramp used by the dailies. */
const TIER_NAMES = ["Gentle", "Easy", "Medium", "Tricky", "Hard", "Harder", "Brutal"];

/** Test-bench toolbar shown above a game when it runs in the Admin sandbox. Force
 *  a difficulty, deal a fresh board, or jump straight to a solved end state.
 *  Sandbox boards are never recorded to stats or the leaderboard. */
export function PlaytestBar({ dev, onAutosolve }: { dev: DevSettings; onAutosolve: () => void }) {
  return (
    <div className="playtest" role="region" aria-label="Playtest controls">
      <span className="playtest-tag">Test bench</span>
      <label className="playtest-field">
        Difficulty
        <select
          value={dev.tier}
          onChange={(e) => setDev({ tier: Number(e.target.value) })}
          aria-label="Force difficulty tier"
        >
          <option value={0}>Auto (today)</option>
          {TIER_NAMES.map((name, i) => (
            <option key={i} value={i + 1}>{i + 1} · {name}</option>
          ))}
        </select>
      </label>
      <button className="playtest-btn" onClick={() => reshuffleDev()}>🎲 New board</button>
      <button className="playtest-btn" onClick={onAutosolve}>✓ Autosolve</button>
      {/* Unlike the controls beside it, this one changes the pictures across the whole
          session, not just the sandbox board: judging the two sources means seeing them on
          real boards. Per-browser, and it resets to Wikipedia on a fresh profile. */}
      <label className="playtest-field">
        Photos
        <select
          value={dev.photoSource}
          onChange={(e) => setDev({ photoSource: e.target.value as "wiki" | "inat" })}
          aria-label="Image source order"
        >
          <option value="wiki">Wikipedia first (live)</option>
          <option value="inat">iNaturalist first</option>
        </select>
      </label>
      <span className="playtest-note">Not recorded</span>
    </div>
  );
}
