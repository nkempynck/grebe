import type { UseMosaicGame } from "../hooks/useMosaicGame";

/** Mosaic's own test-bench row, above the generic PlaytestBar.
 *
 *  These are the prototype's tuning controls, and they are here rather than in the game because
 *  every one of them is a way of NOT playing: switch the reveal mechanic, scrub the ladder
 *  without spending guesses, read the answer's date off the page. A ladder judged with the
 *  slider in reach is judged primed, which is the same mistake the contact sheet made — so on
 *  the site none of this exists, and the only way to see the next rung is to earn it. */
export function MosaicBench({ g }: { g: UseMosaicGame }) {
  return (
    <div className="playtest" role="region" aria-label="Mosaic reveal controls">
      <span className="playtest-tag">Reveal</span>
      <label className="playtest-field">
        Mechanic
        <select
          value={g.mechanic}
          onChange={(e) => g.setMechanic(e.target.value as "blur" | "shuffle")}
          aria-label="Reveal mechanic"
        >
          <option value="shuffle">shuffle (shipping)</option>
          <option value="blur">blur</option>
        </select>
      </label>
      <label className="playtest-field">
        Rung
        <input
          type="range"
          min={0}
          max={g.rungCount - 1}
          value={g.rung}
          onChange={(e) => g.setRungOverride(Number(e.target.value))}
          aria-label="Inspect a rung without guessing"
        />
      </label>
      <span className="playtest-note">{g.rungLabel}</span>
      <button
        className="playtest-btn"
        onClick={() => g.setRungOverride(null)}
        disabled={g.rungOverride === null}
      >
        follow game
      </button>
      <span className="playtest-note">
        {g.date}
        {g.staged.length ? ` · ${g.staged.indexOf(g.date) + 1}/${g.staged.length} staged` : " · none staged"}
      </span>
    </div>
  );
}
