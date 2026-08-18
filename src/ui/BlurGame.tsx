// PROTOTYPE UI for Blur. Enough to play a day and judge it; no share card, no stats, no
// leaderboard, no result card.
import { useMemo, useState } from "react";
import type { Tree, GameConfig, GuessResult } from "../core";
import { CHARACTERS } from "../core/blurChars";
import { useBlurGame } from "../hooks/useBlurGame";
import { GuessInput } from "./GuessInput";

export function BlurGame({ tree, date }: { tree: Tree | null; date?: string }) {
  const g = useBlurGame(tree, date);
  const [zoom, setZoom] = useState(false);

  const config: GameConfig = useMemo(
    () => ({ scopeRootId: tree?.rootId ?? "life", winWithin: 0 }),
    [tree]
  );
  // GuessInput only reads ids off this, to grey out what has already been tried.
  const asGuessResults = useMemo(
    () => g.guesses.map((x) => ({ guess: x.node }) as unknown as GuessResult),
    [g.guesses]
  );

  if (!tree) return <p className="empty">Loading…</p>;
  if (!g.answerId) return <p className="empty">No puzzle for {g.date}.</p>;

  const answer = tree.byId.get(g.answerId);
  const done = g.status !== "playing";

  return (
    <div className="blur">
      <div className="blur-stage">
        {g.missing ? (
          <div className="blur-nostage">
            <strong>No image staged for {g.date}</strong>
            <span>node scripts/blur-stage.mjs --from {g.date} --days 14</span>
          </div>
        ) : (
          <img
            key={g.imageUrl}
            className={`blur-img${done ? " is-done" : ""}${zoom ? " is-zoom" : ""}`}
            src={g.imageUrl}
            alt={done ? (answer?.common ?? answer?.sciName ?? "") : "Unidentified organism, heavily pixelated"}
            onClick={() => done && setZoom((z) => !z)}
            onError={g.onImageError}
          />
        )}
        {!done && (
          <span className="blur-rung">
            {g.rungWidth}px · {g.guessesLeft} {g.guessesLeft === 1 ? "guess" : "guesses"} left
          </span>
        )}
      </div>

      {done && (
        <div className={`blur-verdict ${g.status}`}>
          <strong>{g.status === "won" ? "Got it" : "The answer was"}</strong>{" "}
          {answer?.common ?? answer?.sciName}
          {answer?.common && answer.sciName ? <em> ({answer.sciName})</em> : null}
          {g.credit?.licence && (
            <small>
              Photo: {g.credit.artist ?? "unknown"} · {g.credit.licence}
              {g.credit.filePage && (
                <> · <a href={g.credit.filePage} target="_blank" rel="noreferrer">source</a></>
              )}
            </small>
          )}
        </div>
      )}

      {!done && (
        <>
          <div className="blur-drill">
            <div className="blur-crumbs">
              <button className="blur-crumb" onClick={() => g.drillTo(0)}>All animals</button>
              {g.path.map((p, i) => (
                <button key={p.id} className="blur-crumb" onClick={() => g.drillTo(i + 1)}>
                  <span aria-hidden="true">›</span> {p.label}
                </button>
              ))}
              <span className="blur-remaining">{g.remaining} left</span>
            </div>
            <div className="blur-options">
              {g.options.slice(0, 24).map((o) => (
                <button key={o.id} className="blur-opt" onClick={() => g.drillInto(o.id)}>
                  {o.label} <b>{o.count}</b>
                </button>
              ))}
              {g.options.length === 0 && (
                <span className="blur-opt-none">Nothing finer to narrow to — name it.</span>
              )}
            </div>
          </div>

          <GuessInput
            tree={tree}
            config={config}
            disabled={done}
            onSubmit={(_text, id) => id && g.guess(id)}
            focusCladeId={g.focusCladeId}
            guesses={asGuessResults}
          />
        </>
      )}

      {g.guesses.length > 0 && (
        <div className="blur-table-wrap">
          {/* Says what it is. Five green ticks on a spider monkey when the answer is a bobcat
              reads as "you were close" when it only means "both are furry quadrupeds". */}
          <p className="blur-table-note">Traits you share with the answer — not how closely related you are.</p>
          <table className="blur-table">
            <thead>
              <tr>
                <th>Guess</th>
                {CHARACTERS.map((c) => <th key={c.id}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {g.guesses.map((row) => (
                <tr key={row.node.id} className={row.correct ? "hit" : ""}>
                  <th scope="row">{row.node.common ?? row.node.sciName}</th>
                  {row.cells.map((c) => (
                    <td
                      key={c.characterId}
                      className={c.match === null ? "na" : c.match ? "yes" : "no"}
                    >
                      {c.match === null ? "–" : c.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="blur-devbar">
        {!done && <button className="blur-giveup" onClick={g.giveUp}>Give up</button>}
        <button className="blur-sample" onClick={g.sample} disabled={g.staged.length < 2}>
          New sample →
        </button>
        <span className="blur-devnote">
          {g.date}
          {g.staged.length ? ` · ${g.staged.indexOf(g.date) + 1}/${g.staged.length} staged` : " · none staged"}
        </span>
      </div>
    </div>
  );
}
