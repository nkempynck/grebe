import type { UseMosaicGame } from "../hooks/useMosaicGame";

/** Mosaic's own test-bench row, above the generic PlaytestBar.
 *
 *  What is left here is only what a PLAYER must never have. The mechanic, the region scheme and
 *  the forced difficulty all moved out to MosaicSettings once the beta gave players the settings
 *  view, and they belong there: each changes what the game IS, and none of them is a way to skip
 *  playing it.
 *
 *  The rung slider is the one that cannot follow them. It shows the next rung without spending a
 *  guess, which is the whole cost model of the game handed over for free, and it is also how the
 *  ladder came to be mistuned in the first place: a rung judged with the slider in reach is
 *  judged primed, because the eye has already been told what it is looking at. */
export function MosaicBench({ g }: { g: UseMosaicGame }) {
  return (
    <div className="playtest" role="region" aria-label="Mosaic reveal controls">
      <span className="playtest-tag">Reveal</span>
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
      {/* The date no longer picks the animal, only the aids and which other boards to hide. It is
          still worth printing: it is what the weekday ramp and the cross-game guard both read. */}
      <span className="playtest-note">{g.date}</span>
    </div>
  );
}
