import { useEffect, useRef, useState } from "react";
import type { TaxonNode } from "../core";
import { fetchWikiImage, type WikiImage } from "../data/wikipedia";
import { PhotoZoom } from "./PhotoZoom";
import {
  fetchGameLeaderboard,
  fetchGameStanding,
  type GameStanding,
  type LeaderboardEntry,
} from "../data/games";

const MEDALS = ["🥇", "🥈", "🥉"];

/** How long the board waits for the just-played row to reach the server before
 *  giving up and showing today's standings without it. The wait exists because
 *  the reveal opens the instant the round ends, while submit_game() is still in
 *  flight: fetching immediately would show the player a board they are missing
 *  from, which reads as "your game didn't count". The cap is what stops a failed
 *  or queued submit (signed out, offline, pending replay) from leaving the panel
 *  spinning forever — the board is still worth seeing without your own row. */
const SUBMIT_WAIT_MS = 4000;

// The OS "reduce motion" setting is honoured entirely in CSS here (the .reveal-*
// rules drop every animation in that mode), so nothing in this file branches on it.

interface Props {
  /** The species (or clade) the round resolved to. */
  answer: TaxonNode;
  won: boolean;
  guessCount: number;
  /** Daily only. Free play isn't scored, so it gets the animal and nothing else. */
  daily: boolean;
  /** The player's current daily streak, shown on a win. */
  streak?: number | null;
  /** Display name to highlight on the mini board; null when signed out. */
  me: string | null;
  /** Whether an account exists at all (player.configured) — the board section is
   *  meaningless without one, and the nudge takes its place. */
  configured: boolean;
  /** True when the finished game is actually being submitted, so the board knows
   *  whether it is waiting for something. */
  signedIn: boolean;
  /** App's board-refresh counter. It bumps when submit_game() resolves, which is
   *  this component's signal that the player's own row now exists server-side. */
  reloadKey: number;
  /** The round's shareable text (see lineageShare) — the identical string the
   *  share card copies, so a result can be shared from the reveal itself. */
  shareText?: string | null;
  /** What the round scored. Shown to everyone, signed in or not: a signed-out
   *  player has a score too, it simply isn't on a board yet, and the card was
   *  otherwise the one place that never said what the round was worth. Null in
   *  free play, which isn't scored at all. */
  points?: number | null;
  onClose: () => void;
}

/** The post-round reveal: the animal you were hunting, full width and named, over
 *  the board you just played. It exists because the answer used to arrive as one
 *  line of a result card below the tree — the payoff of the whole round, styled
 *  like a caption.
 *
 *  It opens ONCE, on the transition out of play (see App). A restored daily never
 *  reopens it: meeting the animal is the end of a round, not a property of the
 *  page being in a finished state.
 *
 *  A give-up gets the same card and the same photo, minus the celebration: the
 *  point is to meet the species either way. */
export function AnswerReveal({
  answer, won, guessCount, daily, streak, me, configured, signedIn, reloadKey, shareText, points, onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  // "pending" until the lookup resolves, then a photo or "none". The three states
  // are worth keeping apart: the plate is held open while a photo might still be
  // coming, and dropped entirely once we know there isn't one — an empty 4:3 block
  // above the name looks like a picture that failed rather than a card that never
  // had one.
  const [img, setImg] = useState<WikiImage | "pending" | null>("pending");
  // Held false until the file itself has decoded, so the photo fades in instead
  // of snapping in at whatever moment the network happens to deliver it.
  const [imgReady, setImgReady] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // The lead image is often a range map, a status icon or a size chart, so this
  // goes through fetchWikiImage (cached, shared with the tiles and WikiCard)
  // rather than the summary thumbnail the result card uses.
  useEffect(() => {
    let live = true;
    setImg("pending");
    setImgReady(false);
    fetchWikiImage(answer).then((i) => { if (live) setImg(i); });
    return () => { live = false; };
  }, [answer.id]);

  // Focus moves into the card on open and back out on close — the card is the only
  // thing on screen that matters until it's dismissed. Deliberately its OWN effect,
  // running once: bundled with the key handler below it re-ran whenever `zoomed`
  // changed, so opening a picture pulled focus back onto the card sitting behind
  // the overlay. PhotoZoom takes and returns focus itself.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => prev?.focus?.();
  }, []);

  // While a picture is open over the card, Escape belongs to the picture (which
  // closes itself); handling it here too would dismiss the whole reveal on one
  // press, losing the thing the player was looking at.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !zoomed) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomed]);

  const name = answer.common ?? answer.sciName;
  const hasSci = !!answer.common && !!answer.sciName && answer.common !== answer.sciName;

  const copy = async () => {
    if (!shareText) return;
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — no-op, same as the share card */
    }
  };

  return (
    <div className="reveal-scrim" role="presentation" onClick={onClose}>
      <div
        className={`reveal-card${won ? " is-won" : " is-lost"}${img === null ? " is-noshot" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={`${won ? "Solved" : "Revealed"}: ${name}`}
        tabIndex={-1}
        ref={cardRef}
        // The card is inside the scrim, so a click on it would bubble up to the
        // dismiss handler — reading a name would close the thing showing it.
        onClick={(e) => e.stopPropagation()}
      >
        <button className="reveal-close" onClick={onClose} aria-label="Close">×</button>

        {/* The plate is held open while the lookup is still running, so a photo
            landing late can't resize the card under the player's eyes. It is only
            dropped for a species Wikipedia has no usable picture of, where the card
            becomes name-first rather than keeping an empty frame. */}
        {img !== null && (
          // A button, not a frame: the hero is a cropped 4:3, and some of these
          // animals are worth looking at properly. Opens the shared overlay, which
          // renders above this dialog.
          <button
            type="button"
            className="reveal-shot"
            onClick={() => { if (img !== "pending") setZoomed(true); }}
            title="Enlarge picture"
            aria-label={`Enlarge ${name} picture`}
          >
            {img !== "pending" && (
              <>
                <img
                  className={`reveal-shot-img${imgReady ? " is-in" : ""}`}
                  src={img.full ?? img.thumb}
                  alt={name}
                  onLoad={() => setImgReady(true)}
                  // A broken file drops the plate too, rather than showing the
                  // browser's torn-image glyph across the top of the reveal.
                  onError={() => setImg(null)}
                />
                <span className="zoom-shot-icon" aria-hidden="true">⤢</span>
              </>
            )}
          </button>
        )}
        {zoomed && img !== null && img !== "pending" && (
          <PhotoZoom src={img.full || img.thumb} caption={name} onClose={() => setZoomed(false)} />
        )}

        <div className="reveal-body">
          <div className="reveal-tag">{won ? "Got it" : "The answer was"}</div>
          <h2 className="reveal-name">{name}</h2>
          {hasSci && <div className="reveal-sci">{answer.sciName}</div>}
          <div className="reveal-line">
            {won
              ? `Solved in ${guessCount} guess${guessCount === 1 ? "" : "es"}`
              : `Revealed after ${guessCount} guess${guessCount === 1 ? "" : "es"}`}
            {points != null && <span className="reveal-pts">{points} pts</span>}
            {won && daily && streak != null && streak > 0 && (
              <span className="reveal-streak">🔥 {streak}-day streak</span>
            )}
          </div>
        </div>

        {daily && configured && (
          <RevealBoard me={me} signedIn={signedIn} reloadKey={reloadKey} />
        )}
        {/* Signed out, a finished daily is stashed locally and replayed the moment
            an account signs in (see data/pendingSubmits) — under exactly this
            condition, `configured` and no session. So the honest line is that the
            score is kept and waiting, not the generic invitation the page footer
            gives, which reads like the result was thrown away. */}
        {daily && configured && !signedIn && (
          <p className="reveal-nudge">Today’s result is saved on this device. Sign in and it joins the board.</p>
        )}

        <div className="reveal-actions">
          {/* The same text the share card copies (both come from lineageShare), so
              the result can be shared from here without scrolling past the card to
              find the button. */}
          {shareText && (
            <button className="reveal-copy" onClick={copy}>{copied ? "Copied ✓" : "Copy result"}</button>
          )}
          <button className="reveal-more" onClick={onClose}>See the full result</button>
        </div>
      </div>
    </div>
  );
}

/** Today's top three plus the player's own standing — enough to answer "where did
 *  that put me" without leaving the card. The full board is still on the page
 *  below, so this deliberately carries no filters, no periods and no footer. */
function RevealBoard({ me, signedIn, reloadKey }: { me: string | null; signedIn: boolean; reloadKey: number }) {
  const [rows, setRows] = useState<LeaderboardEntry[] | null>(null);
  const [standing, setStanding] = useState<GameStanding | null>(null);
  // The reloadKey this card opened on. A signed-in player's row lands server-side
  // when App bumps it past this value; until then the board would be missing the
  // very game that opened the card.
  const openedAt = useRef(reloadKey);
  const submitted = reloadKey !== openedAt.current;
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    if (!signedIn || submitted) return;
    const t = setTimeout(() => setWaited(true), SUBMIT_WAIT_MS);
    return () => clearTimeout(t);
  }, [signedIn, submitted]);

  const ready = !signedIn || submitted || waited;

  useEffect(() => {
    if (!ready) return;
    let live = true;
    // Same query as the "today" board on the page (period "day", no group, no
    // for_date — the RPC takes its own current-day branch), so the three rows here
    // and the board below can't disagree.
    Promise.all([
      fetchGameLeaderboard("lineage", "day", { limit: 3 }),
      fetchGameStanding("lineage", "day"),
    ]).then(([r, s]) => {
      if (!live) return;
      setRows(r);
      setStanding(s);
    });
    return () => { live = false; };
  }, [ready, reloadKey]);

  if (!ready || rows === null) {
    return (
      <div className="reveal-board is-waiting">
        <div className="reveal-board-ttl">Today’s board</div>
        <p className="reveal-board-note">{ready ? "Loading…" : "Placing you on the board…"}</p>
      </div>
    );
  }

  // Only ever the server's own count. Falling back to rows.length would print
  // "3 players" whenever the standing call failed, which is a made-up number
  // dressed as a fact — the count is simply left off instead.
  const total = standing?.total_players ?? null;
  // Whether the player is already among the three rows above — repeating their
  // row underneath would be the same fact twice.
  const inTop = !!me && rows.some((r) => r.display_name === me);
  const myRank = standing?.my_rank ?? null;
  // Outside the top three, the player gets a FOURTH ROW in the same style rather
  // than a footnote: the question the card answers is "where did that put me", and
  // a row with a rank and a score answers it in the same shape as the three above.
  // The ellipsis stands for the ranks in between, and is dropped at rank 4, where
  // there is nothing in between to stand for.
  const showMine = signedIn && !inTop && myRank != null;

  return (
    <div className="reveal-board">
      <div className="reveal-board-ttl">
        Today’s board
        {total != null && total > 0 && (
          <span className="reveal-board-count">{total} player{total === 1 ? "" : "s"}</span>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="reveal-board-note">No ranked games today yet.</p>
      ) : (
        <div className="lb-rows is-slim">
          {rows.map((r, i) => (
            <div className={`lb-row is-podium${r.display_name === me ? " is-me" : ""}`} key={`${r.display_name}-${i}`}>
              <span className="lb-rank is-medal">{MEDALS[i]}</span>
              <span className="lb-name">
                {r.display_name}
                {r.display_name === me && <span className="lb-youtag">you</span>}
              </span>
              <span className="lb-score">{r.total_score}</span>
            </div>
          ))}
          {showMine && (
            <>
              {myRank > rows.length + 1 && <div className="reveal-gap" aria-hidden="true">⋯</div>}
              <div className="lb-row is-me">
                <span className="lb-rank">{myRank}</span>
                <span className="lb-name">
                  {me ?? "You"}<span className="lb-youtag">you</span>
                </span>
                <span className="lb-score">{standing?.my_score ?? 0}</span>
              </div>
            </>
          )}
        </div>
      )}
      {/* Signed in, played, and still not on the board: the submit hasn't landed
          (queued for replay, or it failed). Said plainly rather than shown as a
          rank of nothing. */}
      {signedIn && standing && !inTop && myRank == null && (
        <div className="reveal-you is-unranked">You · not ranked today</div>
      )}
    </div>
  );
}
