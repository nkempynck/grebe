// Mosaic: identify an animal from a photograph broken into shuffled tiles, with a
// Mastermind-style character table beside it. Every wrong guess puts the picture back together
// a little more.
//
// What varies across the week is not the picture but the HELP — see mosaicAids. This component
// renders panels that today's aids allow and simply does not render the others, so there is
// never a disabled control explaining what you are not allowed to do.
import { useMemo, useState } from "react";
import type { Tree, GameConfig, GuessResult } from "../core";
import { isAncestor, resolveGuess, suggestGuesses } from "../core";
import { CHARACTERS } from "../core/mosaicChars";
import { mosaicTierForDate } from "../core/mosaic";
import { geoCell, regionLabels } from "../data/geo";
import { useMosaicGame } from "../hooks/useMosaicGame";
import { useDev } from "../data/devMode";
import { GameHeader } from "./GameHeader";
import { GuessInput } from "./GuessInput";
import { PlaytestBar } from "./PlaytestBar";
import { MosaicBench } from "./MosaicBench";
import { MosaicPicture } from "./MosaicPicture";
import { MosaicSettings } from "./MosaicSettings";
import { DiscussionPanel } from "./DiscussionPanel";
import { MOSAIC_FEEDBACK_BOARD, OPEN_BOARD_DATE } from "../data/discussion";
import { useMosaicPrefs } from "../data/mosaicPrefs";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** Same bands, same words as Lineage's ramp — see DIFFICULTY in data/dailySchedule. */
const DIFFICULTY = ["Gentle", "Gentle", "Tricky", "Harder", "Harder", "Brutal", "Brutal"];

interface Props {
  tree: Tree | null;
  date?: string;
  onHowItWorks?: () => void;
  /** Signed-in user, for the feedback board. Reading it needs no account; posting does. */
  userId?: string | null;
  /** True when a backend is configured at all. Without one the board does not render. */
  configured?: boolean;
  /** Render inside the admin test bench: playtest controls, never recorded. */
  sandbox?: boolean;
}

export function MosaicGame({ tree, date, onHowItWorks, userId, configured, sandbox }: Props) {
  const devSettings = useDev();
  const prefs = useMosaicPrefs();
  const g = useMosaicGame(tree, {
    date,
    dev: sandbox ? { tier: devSettings.tier, nonce: devSettings.nonce } : null,
  });
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
      setReject(`${node.common ?? node.sciName} is a group. Name a single species.`);
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

  // The header and the stage render before a board exists, so the page does not jump when one
  // arrives a fetch later. Everything a player can ACT on waits for it: no guess bar, no
  // narrowing and no give-up against an animal that has not been dealt yet.
  const answer = g.answerId ? tree.byId.get(g.answerId) : undefined;
  const ready = Boolean(g.answerId);
  const done = g.status !== "playing";
  const { aids } = g;

  return (
    <div className="mosaic">
      <GameHeader
        game="mosaic"
        tier={aids.tier}
        dayName={DAY_NAMES[aids.tier - 1]}
        difficulty={DIFFICULTY[aids.tier - 1]}
        onHowItWorks={onHowItWorks}
        meta={<span className="gamehead-beta">Beta</span>}
        blurb={
          <>
            Name the animal. The photograph is cut into tiles and shuffled, and every wrong
            guess puts more of it back together. The table shows which traits your guess shares
            with the answer.
            <span className="gamehead-blurb-note">
              {g.guardReady || !(aids.lookup || aids.subset)
                ? aidsNote(aids.lookup, aids.subset)
                : "Checking today’s other boards…"}
            </span>
            {/* What beta actually means for the player, in the three ways it will bite: the
                animal is not the same for everyone, the points do not go anywhere, and there is
                more than one board a day. Saying it here is cheaper than an explanation after
                someone has compared their animal with a friend's. */}
            <span className="gamehead-blurb-note is-beta">
              Mosaic is in beta. The animal is drawn at random rather than set for the day, so
              yours is not everyone’s, and nothing is scored or recorded yet. Finish a board and
              you can play another.
            </span>
          </>
        }
      />

      {sandbox && <MosaicBench g={g} />}

      <MosaicSettings prefs={prefs} todayTier={mosaicTierForDate(g.date)} />

      <div className={`mosaic-stage${done && zoom ? " is-zoom" : ""}`}>
        {g.missing ? (
          <div className="mosaic-nostage">
            <strong>No picture to play</strong>
            <span>Wikipedia could not be reached. Please try again.</span>
            <button className="mosaic-again linkbtn" onClick={g.newBoard}>Try again</button>
          </div>
        ) : !g.imageUrl ? (
          <div className="mosaic-nostage" aria-busy="true">
            <span>Finding an animal…</span>
          </div>
        ) : (
          <div
            className={done ? "mosaic-stage-shot is-done" : "mosaic-stage-shot"}
            onClick={() => done && setZoom((z) => !z)}
          >
            <MosaicPicture
              src={g.imageUrl}
              fallback={g.imageFull}
              mechanic={g.mechanic}
              step={g.step}
              revealed={done}
              alt={done ? (answer?.common ?? answer?.sciName ?? "") : "Unidentified animal, cut into shuffled tiles"}
              onUnavailable={g.onImageError}
            />
          </div>
        )}
        {!done && g.imageUrl && (
          <span className="mosaic-rung">
            {g.guessesLeft} {g.guessesLeft === 1 ? "guess" : "guesses"} left
            {/* What naming it NOW is still worth. Guesses cost little early and a lot late, so
                the number falling is the pressure the game runs on; hiding it until the end
                would make that pressure invisible while it mattered. */}
            <b className="mosaic-worth">{g.pointsIfNext} pts</b>
          </span>
        )}
      </div>

      {done && (
        <div className={`mosaic-verdict ${g.status}`}>
          <span className="mosaic-verdict-tag">
            {g.status === "won" ? "Got it" : "The answer was"}
          </span>
          <span className="mosaic-verdict-name">{answer?.common ?? answer?.sciName}</span>
          {g.status === "won" && (
            <span className="mosaic-verdict-pts">
              {g.points} pts · {g.guesses.length} {g.guesses.length === 1 ? "guess" : "guesses"}
            </span>
          )}
          {answer?.common && answer.sciName && (
            <span className="mosaic-verdict-sci">{answer.sciName}</span>
          )}
          {g.credit?.licence && (
            <span className="mosaic-verdict-credit">
              Photo: {g.credit.artist ?? "unknown"} · {g.credit.licence}
              {g.credit.filePage && (
                <> · <a href={g.credit.filePage} target="_blank" rel="noreferrer">source</a></>
              )}
            </span>
          )}
          {/* The board is sampled, not scheduled, so there is another one waiting and no reason
              to make anyone reload the page for it. When Mosaic becomes a daily this button
              stops being the way out of a finished round and starts being the practice mode. */}
          <button className="mosaic-again" onClick={g.newBoard}>Play another →</button>
        </div>
      )}

      {/* Naming the animal is the game; narrowing and looking one up are aids to it. So the
          bar sits directly under the picture, the board of what you have already tried sits
          directly under the bar, and the aids come after both: a guess and its answer belong
          next to each other, not two panels apart. */}
      {!done && ready && (
        <>
          {reject && <p className="mosaic-reject">{reject}</p>}
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
        <div className="mosaic-table-wrap">
          <p className="mosaic-table-note">{tableNote(aids.proximity)}</p>
          <table className="mosaic-table">
            <thead>
              <tr>
                <th>Guess</th>
                <th title={aids.proximity === "named" ? "The rank you share, never which one" : "Warmer is closer, 100 is the answer"}>
                  {aids.proximity === "named" ? "How close" : "°"}
                </th>
                <th title="Where your guess is recorded. Highlighted where the answer is too.">
                  Recorded in
                </th>
                {CHARACTERS.map((c) => <th key={c.id}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {g.guesses.map((row) => (
                <tr key={row.node.id} className={row.correct ? "hit" : ""}>
                  <th scope="row">{row.node.common ?? row.node.sciName}</th>
                  <td className="prox">
                    {aids.proximity === "named" ? row.proximity : `${row.degrees}°`}
                  </td>
                  {/* Overlap, not equality: a guess recorded across Europe and Asia against an
                      answer recorded only in Asia is neither a hit nor a miss, it is half
                      right, and the cell shows which half. One column carries up to six bits
                      that way; six yes/no columns would carry the same and double the width. */}
                  <td className="mosaic-geo">{renderGeo(row.node.sciName, answer?.sciName, g.regionScheme)}</td>
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

      {!done && ready && (
        <>
          {aids.subset && g.guardReady && (
            <div className="mosaic-drill">
              <span className="mosaic-box-label">Narrow down</span>
              <div className="mosaic-crumbs">
                <button className="mosaic-crumb" onClick={() => { setReject(null); g.drillTo(0); }}>All animals</button>
                {g.path.map((p, i) => (
                  <button
                    key={p.id}
                    className="mosaic-crumb"
                    title={isRanked(p.rank) ? `${p.label} is a ${p.rank}` : `${p.label} is an unranked clade`}
                    onClick={() => { setReject(null); g.drillTo(i + 1); }}
                  >
                    <span aria-hidden="true">›</span> {p.label}
                  </button>
                ))}
                <span className="mosaic-remaining">{g.remaining} left</span>
              </div>
              {/* Names only. The per-group counts are gone deliberately: they were a
                  published census of the species set, and the ranked list they made
                  possible told a player which branch of the taxonomy is fattest,
                  which is a fact about the database rather than about the animal. */}
              <div className="mosaic-options">
                {/* The rank rides along with the name. Without it "Toothed whales" and "Baleen
                    whales" read as two arbitrary boxes, when they are the two parvorders the
                    group actually splits into — and elsewhere in the same list a genus can sit
                    beside a class. Knowing which is which is most of knowing how far a tap
                    narrows things.

                    NOT sliced to 24 any more. The box already scrolls, so the cut bought
                    nothing and cost reachability: at Birds the list runs to 81 rows, so 54
                    species sat behind the cut on a screen where 279 remaining is far too many
                    for the name list to appear either. They could not be narrowed to at all. */}
                {g.options.map((o) => (
                  <button
                    key={o.id}
                    className={`mosaic-opt${o.rank === "species" ? " is-leaf" : ""}`}
                    onClick={() => {
                      setReject(null);
                      // A species has nothing finer to narrow to, so tapping it guesses it.
                      // Drilling in would filter to one animal and make you pick it again.
                      if (o.rank === "species") g.guess(o.id); else g.drillInto(o.id);
                    }}
                  >
                    <span className="mosaic-opt-name">{o.label}</span>
                    <span className={`mosaic-opt-rank${isRanked(o.rank) ? "" : " is-unranked"}`}>
                      {isRanked(o.rank) ? o.rank : "unranked"}
                    </span>
                  </button>
                ))}
                {g.options.length === 0 && g.candidates.length === 0 && (
                  <span className="mosaic-opt-none">Nothing finer to narrow to. Name it.</span>
                )}
              </div>
              {g.candidates.length > 0 && (
                <div className="mosaic-cands">
                  {/* Recall is the wrong ask when the answer is a kinkajou. Once the filter is
                      this narrow, show the names: recognising one of twelve is winnable. */}
                  <span className="mosaic-cands-label">{g.candidates.length} it could be</span>
                  <div className="mosaic-cands-list">
                    {g.candidates.map((c) => (
                      <button key={c.id} className="mosaic-cand" onClick={() => { setReject(null); g.guess(c.id); }}>
                        {c.common ?? c.sciName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {aids.lookup && g.guardReady && (
            <div className="mosaic-lookupbox">
              <span className="mosaic-box-label">Look up an animal</span>
              <input
                value={lookup}
                onChange={(e) => { setLookup(e.target.value); setLooked(null); }}
                placeholder="e.g. arctic fox, to see which groups it sits in"
                aria-label="Look up an animal to scope by its groups"
              />
              {lookup.trim().length > 1 && !looked && (
                <div className="mosaic-lookup-hits">
                  {/* Ask for a lot and filter to SPECIES before trimming. suggestGuesses returns
                      every prefix match before any substring one, so "fox" spent its whole budget
                      on Foxglove, Fox moth and Foxface rabbitfish and never reached Red fox or
                      Arctic fox — and clades were being dropped after the slice, not before. */}
                  {suggestGuesses(tree, lookup, 400)
                    .filter((n) => (tree.childrenOf.get(n.id) ?? []).length === 0)
                    .slice(0, 40)
                    .map((n) => (
                      <button key={n.id} className="mosaic-cand" onClick={() => setLooked(n.id)}>
                        {n.common ?? n.sciName}
                      </button>
                    ))}
                </div>
              )}
              {looked && (
                <>
                  <p className="mosaic-lookup-said">
                    <b>{tree.byId.get(looked)?.common ?? tree.byId.get(looked)?.sciName}</b> sits in. Tap one to narrow to it
                  </p>
                  {/* Names only, for the same reason the narrow-down rows dropped theirs —
                      and more so here. Typing any species you like and reading a count off
                      every clade above it is the census on demand, in a more convenient form
                      than the drill chips ever offered. */}
                  {/* Each step carries its RANK. Without it the chain reads as one flat list of
                      equals, when in fact "Sharks" is an infraclass, "Rhincodon" is a genus and
                      "Vertebrates" is a branch point with no rank at all. Which is which is the
                      difference between a name a player can place and one they cannot. */}
                  <div className="mosaic-lookup-chain">
                    {g.lineageOf(looked).map((l) => (
                      <button
                        key={l.id}
                        className="mosaic-path"
                        onClick={() => { setReject(null); g.setPath([l.id]); setLookup(""); setLooked(null); }}
                      >
                        <span className="mosaic-path-name">{l.label}</span>
                        <span className={`mosaic-path-rank${isRanked(l.rank) ? "" : " is-unranked"}`}>
                          {isRanked(l.rank) ? l.rank : "unranked"}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <button className="mosaic-giveup linkbtn" onClick={g.giveUp}>Give up</button>
        </>
      )}

      {/* A STANDING board, not today's. The other three games each get a board per puzzle,
          which is right when everyone has the same puzzle; here nobody does, so a per-day
          thread would be a room full of people describing different animals. What a beta wants
          instead is one place the feedback accumulates and can still be read next week.

          Not gated on finishing, unlike the others: there is no play record to gate on, and
          somebody who gave up after two boards is exactly who you want to hear from. */}
      <DiscussionPanel
        board={MOSAIC_FEEDBACK_BOARD}
        date={OPEN_BOARD_DATE}
        permanent
        title="Beta feedback"
        configured={!!configured}
        signedIn={!!userId}
        played
        label="Mosaic"
      />

      {sandbox && <PlaytestBar dev={devSettings} onAutosolve={g.solve} />}
    </div>
  );
}

/** True for a real taxonomic rank. Roughly half the branch points in the tree are unranked
 *  clades — Vertebrates, Amniotes, Eutherians — which are perfectly good groups and simply are
 *  not a family or an order. Saying "clade" back to a player explains nothing; saying
 *  "unranked" at least says why it has no rank to show. */
function isRanked(rank: string): boolean {
  return Boolean(rank) && rank !== "clade";
}

/** One line over the table. It used to claim the board was "not how closely related you are",
 *  which stopped being true when the closeness column arrived beside the traits. It now names
 *  that column and leaves the rest to About: a caption is not the place for the full rules. */
function tableNote(proximity: "named" | "degrees"): string {
  return proximity === "named"
    ? "How close: the rank you share with the answer, never which one."
    : "Degrees: how closely related, 100 is the answer.";
}

/** The geography cell: the guess's regions, with the ones the answer shares picked out.
 *
 *  A dash when either side is unknown, never a miss. GBIF is thin on some species and asserting
 *  "not here" from an absence of records would be inventing a fact. */
function renderGeo(guessSci: string, answerSci: string | undefined, scheme: "continent" | "realm") {
  if (!answerSci) return <span className="mosaic-geo-na">–</span>;
  const cell = geoCell(guessSci, answerSci, scheme);
  if (!cell) return <span className="mosaic-geo-na">–</span>;
  const labels = regionLabels(scheme);
  const shared = new Set(cell.shared);
  // Spelled out, not coded. "NAM" is only legible to whoever wrote the table, and a cell the
  // player has to decode is not information, it is homework.
  return (
    <span className="mosaic-geo-set">
      {cell.mine.map((r) => (
        <span key={r} className={`mosaic-geo-r${shared.has(r) ? " is-shared" : ""}`}>
          {labels[r] ?? r}
        </span>
      ))}
    </span>
  );
}

/** One line telling you what today does and does not give you, so a missing panel reads as the
 *  day's rule rather than as something broken.
 *
 *  It is deliberately NOT used while the cross-game guard is still loading: "no narrowing today"
 *  and "we have not checked what we are allowed to show you yet" are different statements, and
 *  printing the first for the second would be a lie that resolves itself a second later. */
function aidsNote(lookup: boolean, subset: boolean): string {
  if (lookup && subset) return "Today you can narrow by group and look species up.";
  if (subset) return "Today you can narrow by group, but there are no species lookups.";
  return "Today it is the picture and the table alone: no narrowing, no lookups.";
}
