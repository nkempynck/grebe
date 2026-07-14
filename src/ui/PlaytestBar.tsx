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
      <span className="playtest-note">Not recorded</span>
    </div>
  );
}
