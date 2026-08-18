// PROTOTYPE UI for Blur. Enough to play a day and judge it; no share card, no stats, no
// leaderboard, no result card.
import { useMemo, useState } from "react";
import type { Tree, GameConfig, GuessResult } from "../core";
import { isAncestor, resolveGuess, suggestGuesses } from "../core";
import { CHARACTERS } from "../core/blurChars";
import { useBlurGame } from "../hooks/useBlurGame";
import { GuessInput } from "./GuessInput";

export function BlurGame({ tree, date }: { tree: Tree | null; date?: string }) {
  const g = useBlurGame(tree, date);
  const [zoom, setZoom] = useState(false);
  const [reject, setReject] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [looked, setLooked] = useState<string | null>(null);

  /** A typed guess arrives with NO id — GuessInput only supplies one when a suggestion row is
   *  picked. Ignoring those made the button do nothing at all, silently, which is what
   *  narrowing the filter looked like from the outside. Resolve the text, then hold it to the
   *  same filter the suggestions are held to: if you have said "rodents", a duck is not a
   *  guess you get to make, and it should say so rather than quietly scoring it. */
  const submit = (text: string, id?: string) => {
    setReject(null);
    if (!tree) return;
    const node = id ? tree.byId.get(id) : resolveGuess(tree, text);
    if (!node) { setReject(`No organism called “${text.trim()}”.`); return; }
    if (g.focusCladeId && !isAncestor(tree, g.focusCladeId, node.id)) {
      const scope = g.path.length ? g.path[g.path.length - 1].label : "this group";
      setReject(`${node.common ?? node.sciName} is not in ${scope}.`);
      return;
    }
    if ((tree.childrenOf.get(node.id) ?? []).length > 0) {
      setReject(`${node.common ?? node.sciName} is a group — name a single species.`);
      return;
    }
    g.guess(node.id);
  };

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
      <div className="blur-setup">
        <span className="blur-setup-label">Mechanic</span>
        {(["blur", "shuffle"] as const).map((m) => (
          <button
            key={m}
            className={`blur-chip${g.mechanic === m ? " on" : ""}`}
            onClick={() => g.setMechanic(m)}
          >
            {m}
          </button>
        ))}
        <span className="blur-setup-label">Rung</span>
        <input
          type="range"
          min={0}
          max={g.rungCount - 1}
          value={g.rung}
          onChange={(e) => g.setRungOverride(Number(e.target.value))}
          aria-label="Inspect a rung without guessing"
        />
        <button
          className="blur-chip"
          onClick={() => g.setRungOverride(null)}
          disabled={g.rungOverride === null}
        >
          follow game
        </button>
        <button
          className={`blur-chip${g.showProximity ? " on" : ""}`}
          onClick={() => g.setShowProximity(!g.showProximity)}
        >
          proximity {g.showProximity ? "on" : "off"}
        </button>
      </div>

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
            {g.rungLabel} · {g.guessesLeft} {g.guessesLeft === 1 ? "guess" : "guesses"} left
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
            <span className="blur-box-label">Narrow down</span>
            <div className="blur-crumbs">
              <button className="blur-crumb" onClick={() => { setReject(null); g.drillTo(0); }}>All animals</button>
              {g.path.map((p, i) => (
                <button key={p.id} className="blur-crumb" onClick={() => { setReject(null); g.drillTo(i + 1); }}>
                  <span aria-hidden="true">›</span> {p.label}
                </button>
              ))}
              <span className="blur-remaining">{g.remaining} left</span>
            </div>
            <div className="blur-options">
              {g.options.slice(0, 24).map((o) => (
                <button key={o.id} className="blur-opt" onClick={() => { setReject(null); g.drillInto(o.id); }}>
                  {o.label} <b>{o.count}</b>
                </button>
              ))}
              {g.options.length === 0 && g.candidates.length === 0 && (
                <span className="blur-opt-none">Nothing finer to narrow to — name it.</span>
              )}
            </div>
            {g.candidates.length > 0 && (
              <div className="blur-cands">
                {/* Recall is the wrong ask when the answer is a kinkajou. Once the filter is
                    this narrow, show the names: recognising one of twelve is winnable. */}
                <span className="blur-cands-label">{g.candidates.length} it could be</span>
                <div className="blur-cands-list">
                  {g.candidates.map((c) => (
                    <button key={c.id} className="blur-cand" onClick={() => { setReject(null); g.guess(c.id); }}>
                      {c.common ?? c.sciName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>


          <div className="blur-lookupbox">
            <span className="blur-box-label">Look up an animal</span>
            <input
              value={lookup}
              onChange={(e) => { setLookup(e.target.value); setLooked(null); }}
              placeholder="e.g. arctic fox — see which groups it sits in"
              aria-label="Look up an animal to scope by its groups"
            />
            {lookup.trim().length > 1 && !looked && tree && (
              <div className="blur-lookup-hits">
                {/* Ask for a lot and filter to SPECIES before trimming. suggestGuesses returns
                    every prefix match before any substring one, so "fox" spent its whole budget
                    on Foxglove, Fox moth and Foxface rabbitfish and never reached Red fox or
                    Arctic fox — and clades were being dropped after the slice, not before. */}
                {suggestGuesses(tree, lookup, 400)
                  .filter((n) => (tree.childrenOf.get(n.id) ?? []).length === 0)
                  .slice(0, 40)
                  .map((n) => (
                    <button key={n.id} className="blur-cand" onClick={() => setLooked(n.id)}>
                      {n.common ?? n.sciName}
                    </button>
                  ))}
              </div>
            )}
            {looked && tree && (
              <>
                <p className="blur-lookup-said">
                  <b>{tree.byId.get(looked)?.common ?? tree.byId.get(looked)?.sciName}</b> sits in — tap one to narrow to it
                </p>
                <div className="blur-lookup-chain">
                  {g.lineageOf(looked).map((l) => (
                    <button
                      key={l.id}
                      className="blur-path"
                      onClick={() => { setReject(null); g.setPath([l.id]); setLookup(""); setLooked(null); }}
                    >
                      {l.label} <b>{l.count}</b>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {reject && <p className="blur-reject">{reject}</p>}
          <GuessInput
            tree={tree}
            config={config}
            disabled={done}
            onSubmit={submit}
            focusCladeId={g.focusCladeId}
            guesses={asGuessResults}
            speciesOnly
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
                {g.showProximity && <th>How far</th>}
                {CHARACTERS.map((c) => <th key={c.id}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {g.guesses.map((row) => (
                <tr key={row.node.id} className={row.correct ? "hit" : ""}>
                  <th scope="row">{row.node.common ?? row.node.sciName}</th>
                  {g.showProximity && <td className="prox">{row.proximity}</td>}
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
