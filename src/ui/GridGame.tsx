import { useEffect, useMemo, useRef, useState } from "react";
import type { Tree } from "../core";
import { dailyNumber } from "../core";
import { useGridGame, PRESHOW_MAX_TIER, type GridComplete } from "../hooks/useGridGame";
import { resolveDailyRules } from "../data/dailySchedule";
import { kinshipPoints, KINSHIP_FREE_REVEALS } from "../data/score";
import { fetchWikiImage } from "../data/wikipedia";
import { GameHeader } from "./GameHeader";
import { WikiCard } from "./WikiCard";
import { Leaderboard } from "./Leaderboard";
import { LeaderboardNudge } from "./LeaderboardNudge";
import { DiscussionPanel } from "./DiscussionPanel";
import { todayKey } from "../core/daily";
import { KinshipTree } from "./KinshipTree";
import { PlaytestBar } from "./PlaytestBar";
import { gameUrl } from "./share";
import { useDev } from "../data/devMode";
import type { GridGroup } from "../core";

interface Props {
  tree: Tree;
  /** Current Kinship streak, to celebrate on a win (null hides it). */
  streak?: number | null;
  /** Fired once when a board is finished — App records the ranked result. */
  onComplete?: (r: GridComplete) => void;
  /** Leaderboard name to highlight (null when signed out). */
  me?: string | null;
  /** Signed-in player's id (null when signed out) — restores/locks an
   *  already-played board from the server on any device. */
  userId?: string | null;
  /** True when a backend is configured — gates the post-game board. */
  configured?: boolean;
  /** Bump to refetch the post-game board after the result is submitted. */
  reloadKey?: number;
  /** Opens the Kinship section of the About page. */
  onHowItWorks?: () => void;
  /** Renders inside the Admin test bench: difficulty/reshuffle/autosolve controls,
   *  no daily lock, nothing recorded. Off for the normal site. */
  sandbox?: boolean;
}

/** Group-level → share square. Level 0 is the broadest/most obvious group, level
 *  3 the trickiest — a fixed difficulty scale (yellow → green → blue → purple)
 *  matching the colour classes in CSS, like Connections. */
const LEVEL_SQUARE = ["🟨", "🟩", "🟦", "🟪"];

/** From this tier (Sat–Sun) the board is picture-only: pictures are shown and the
 *  NAME is the hidden thing you reveal — sort the organisms by sight. */
const PICTURE_MODE_MIN_TIER = 6;

/** Thu-Fri are MIXED: this many of the sixteen tiles arrive as pictures with their name
 *  hidden, the rest as names with their picture hidden. Each tile's reveal flips whichever
 *  half it is missing. Those two days used to be the only ones with no free pictures at all,
 *  which is the cliff in the week: it is where obscure boards bite hardest, and it is why
 *  plant boards were unplayable there before they were moved off it. */
const MIXED_PICTURE_COUNT = 4;

function GroupBar({ tree, group, dimmed, onPick }: { tree: Tree; group: GridGroup; dimmed?: boolean; onPick?: (id: string) => void }) {
  const nameOf = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
  return (
    <div className={`grid-solved lvl-${group.level}${dimmed ? " is-dim" : ""}`}>
      <div className="grid-solved-label">
        {group.label}
        {group.sciLabel && group.sciLabel !== group.label && <span className="grid-solved-sci"> · {group.sciLabel}</span>}
      </div>
      <div className="grid-solved-members">
        {onPick
          ? group.memberIds.map((id, i) => (
              <span key={id}>
                {i > 0 && " · "}
                <button className="grid-member-link" onClick={() => onPick(id)}>{nameOf(id)}</button>
              </span>
            ))
          : group.memberIds.map(nameOf).join(" · ")}
      </div>
    </div>
  );
}

export function GridGame({ tree, streak, onComplete, me, userId, configured, reloadKey, onHowItWorks, sandbox }: Props) {
  const devSettings = useDev();
  const dev = sandbox ? { tier: devSettings.tier, nonce: devSettings.nonce } : null;
  const g = useGridGame(tree, onComplete, dev, userId);
  const [copied, setCopied] = useState(false);
  // Picture reveals: fetched thumbnails per species, and which tiles show them.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // Species with no Wikipedia image (fetch resolved empty) — in picture mode their
  // name shows as a fallback rather than flashing every name before images load.
  const [noImg, setNoImg] = useState<Set<string>>(new Set());
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  // Full-res image per species for the click-to-enlarge overlay (fetched alongside
  // the thumbnail, so no extra request), and which tile is currently enlarged.
  const [fulls, setFulls] = useState<Record<string, string>>({});
  const [zoomId, setZoomId] = useState<string | null>(null);
  // Post-game Wikipedia reader.
  const [wikiId, setWikiId] = useState<string | null>(null);
  // A tile whose reveal would cost score, awaiting confirmation (null = none). The
  // confirm sits below the board, so scroll it into view when it appears — on a tall
  // board it would otherwise open off-screen and look like nothing happened.
  const [pendingReveal, setPendingReveal] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (pendingReveal) confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [pendingReveal]);

  // Reveal mode is Kinship's PRIMARY difficulty lever (3/2/2 across the week):
  //   Mon–Wed (tier ≤ 3)  name + picture — both shown free, easiest.
  //   Thu–Fri (tier 4–5)  name only — pictures hidden behind the reveal penalty.
  //   Sat–Sun (tier ≥ 6)  picture only — pictures are the tile and the NAME is the
  //     hidden thing you reveal (first three free, then the same gentle penalty):
  //     recognise the organism by sight, then sort by clade.
  const preshow = g.tier > 0 && g.tier <= PRESHOW_MAX_TIER;
  const pictureMode = g.tier >= PICTURE_MODE_MIN_TIER;
  const mixedMode = g.tier > PRESHOW_MAX_TIER && g.tier < PICTURE_MODE_MIN_TIER;
  // Which tiles start as pictures on a mixed day. Spread evenly over the board's SHUFFLED
  // tile order, which is seeded and carries no group structure, so the four picture tiles
  // don't hand a group away. Keyed off the whole board (not `remaining`) so a tile does not
  // change mode when a group is solved.
  const pictureTiles = useMemo(() => {
    const all = g.board?.tiles;
    if (!mixedMode || !all?.length) return new Set<string>();
    const step = Math.max(1, Math.floor(all.length / MIXED_PICTURE_COUNT));
    return new Set(Array.from({ length: MIXED_PICTURE_COUNT }, (_, i) => all[(i * step) % all.length]));
  }, [mixedMode, g.board]);
  const tiles = g.board?.tiles;
  // Prefetch every tile's image up front, in all modes. Easy/picture days show them;
  // harder days keep them hidden until a flip — but we still fetch so we know which
  // species have NO image, and never offer a reveal (or charge for one) on those.
  useEffect(() => {
    if (!tiles) return;
    let live = true;
    for (const id of tiles) {
      const node = tree.byId.get(id);
      if (!node) continue;
      fetchWikiImage(node).then((img) => {
        if (!live) return;
        if (img) {
          setThumbs((t) => (t[id] ? t : { ...t, [id]: img.thumb }));
          setFulls((f) => (f[id] ? f : { ...f, [id]: img.full }));
        } else setNoImg((s) => (s.has(id) ? s : new Set(s).add(id)));
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preshow, pictureMode, tiles, tree]);

  // Points a NEW reveal costs right now: 0 within the free three (and on the "free"
  // reveal of each pair past it), about a mistake's worth on the others. Measured as
  // the points a clean win would lose by taking one more reveal at this tier.
  const revealCostOf = (usedBefore: number) => {
    // Free-peek balance at `usedBefore` peeks: 3 + one per solved group, minus peeks
    // spent, plus those already billed. Above zero → the next peek is free.
    const balance = KINSHIP_FREE_REVEALS + g.solvedGroups.length + g.paidReveals - usedBefore;
    if (balance > 0) return 0;
    return kinshipPoints(true, g.tier, 0, g.paidReveals) - kinshipPoints(true, g.tier, 0, g.paidReveals + 1);
  };

  // Actually flip a tile to its picture (reveal on first flip, then just toggle).
  function doFlip(id: string) {
    if (!g.revealed.includes(id)) g.reveal(id);
    if (!thumbs[id]) {
      const node = tree.byId.get(id);
      if (node) fetchWikiImage(node).then((img) => {
        if (img) { setThumbs((t) => ({ ...t, [id]: img.thumb })); setFulls((f) => ({ ...f, [id]: img.full })); }
      });
    }
    setFlipped((f) => { const n = new Set(f); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // A first reveal that would cost points warns first; free flips (and toggling an
  // already-revealed tile) go straight through.
  function flip(id: string) {
    if (!g.revealed.includes(id) && revealCostOf(g.revealed.length) > 0) {
      setPendingReveal(id);
      return;
    }
    doFlip(id);
  }

  if (!g.board) return <p className="empty">No grid puzzle available today.</p>;

  const over = g.status !== "playing";
  const rules = resolveDailyRules(g.date);
  const wikiNode = wikiId ? tree.byId.get(wikiId) ?? null : null;
  const nameOf = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;

  // Unsolved groups, revealed only after a loss (so the answer is always shown).
  const solvedIds = new Set(g.solvedGroups.map((x) => x.cladeId));
  const unsolved = g.board.groups.filter((x) => !solvedIds.has(x.cladeId));

  // Share: the classic coloured-square grid, one row per guess.
  const shareText = (() => {
    const won = g.status === "won";
    const reveals = g.revealed.length;
    const revealLine = reveals > 0 ? ` · ${reveals} reveal${reveals === 1 ? "" : "s"}` : "";
    const pts = kinshipPoints(won, g.tier, g.mistakes, g.paidReveals);
    const streakLine = won && streak != null && streak > 0 ? ` · 🔥${streak}` : "";
    const head = `🧩 Grebe Kinship · №${dailyNumber(g.date)}${rules.difficulty ? ` · ${rules.difficulty}` : ""}`;
    const rows = g.attempts.map((r) => r.map((l) => LEVEL_SQUARE[l]).join("")).join("\n");
    const verdict = won
      ? `Solved. Nice. · ${g.mistakes} mistake${g.mistakes === 1 ? "" : "s"}${revealLine} · ${pts} pts${streakLine}`
      : `Missed it 🐡 · ${g.solvedGroups.length}/4 groups${revealLine} · ${pts} pts`;
    return `${head}\n${rows}\n${verdict}\n${gameUrl()}`;
  })();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  // Tier-specific one-liner on the picture/name reveal mechanic, folded into the
  // header blurb so it's read up front (the in-board note repeats it during play).
  const revealHint = preshow
    ? "Every picture is shown free on the easier days."
    : pictureMode
    ? "Pictures only today, names hidden: flip a name with 🔤 (first three free, then a little score)."
    : mixedMode
    ? `${MIXED_PICTURE_COUNT} tiles arrive as pictures and the rest as names: flip either to its other half (first three free, then a little score).`
    : "Flip a tile to its picture with 🔍 (first three free, then a little score).";

  // Live reveal tracker (shown while reveals are in play, i.e. not the easy preshow
  // days): how many used, how many free remain, and — once past the free three —
  // the score it's costing (a deduction, NOT a board-ending mistake). The cost is
  // the points a clean win loses to the reveal penalty at this tier.
  const usedReveals = g.revealed.length;
  // Free-peek balance now: 3 + one per solved group, minus peeks spent, plus those
  // already billed. The score cost so far is the penalty on the PAID peeks.
  const freeBalance = KINSHIP_FREE_REVEALS + g.solvedGroups.length + g.paidReveals - usedReveals;
  const revealCost = kinshipPoints(true, g.tier, 0, 0) - kinshipPoints(true, g.tier, 0, g.paidReveals);
  const earned = g.solvedGroups.length > 0 ? ` (+${g.solvedGroups.length} earned)` : "";
  const revealStatus =
    freeBalance > 0
      ? `${usedReveals} · ${freeBalance} free left${earned}`
      : revealCost > 0
      ? `${usedReveals} · −${revealCost} pts`
      : `${usedReveals} · no free peeks left${earned}`;

  return (
    <div className="grid-game">
      <GameHeader
        game="kinship"
        tier={g.tier}
        dayName={rules.dayName}
        difficulty={rules.difficulty}
        onHowItWorks={onHowItWorks}
        blurb={
          <>
            Sixteen species, four hidden groups of four, each a clade. Pick four you think share a group, then guess.
            Four wrong guesses allowed. {revealHint} Solve a group to earn another free peek.
            <span className="gamehead-blurb-note">
              No lookups. The fun is working out the groups from what you already know.
            </span>
          </>
        }
      />

      {/* New-rule highlight — shown through the launch weekend, hides Monday 2026-07-27. */}
      {g.date < "2026-07-27" && (
        <div className="beta-banner" role="note">
          <span className="beta-tag">New</span>
          <span>Solving a group now earns a free tile reveal 🔑. Reveals you already paid a score penalty for stay paid.</span>
        </div>
      )}

      {sandbox && <PlaytestBar dev={devSettings} onAutosolve={g.solve} />}

      {/* Solved groups — plus, after a loss, the ones never found (dimmed). Always
          ordered by difficulty level so the colours read as a scale, like
          Connections (easiest/yellow at top, trickiest/purple at the bottom). */}
      {[
        ...g.solvedGroups.map((grp) => ({ grp, dimmed: false })),
        ...(g.status === "lost" ? unsolved.map((grp) => ({ grp, dimmed: true })) : []),
      ]
        .sort((a, b) => a.grp.level - b.grp.level)
        .map(({ grp, dimmed }) => (
          <GroupBar key={grp.cladeId} tree={tree} group={grp} dimmed={dimmed} onPick={over ? setWikiId : undefined} />
        ))}
      {over && <p className="grid-peek-note">Tap any species to read about it on Wikipedia.</p>}

      {/* The live board. */}
      {!over && (
        <>
          <div className="grid-board" role="group" aria-label="Species tiles">
            {g.remaining.map((id) => {
              const on = g.selected.includes(id);
              const hasImg = !!thumbs[id];
              // Picture mode: the image is the tile, the name is revealed. Normal:
              // the name is the tile, the image is revealed. Easy days show both.
              // On a mixed day each tile has its OWN mode; elsewhere the board has one.
              const asPicture = pictureMode || pictureTiles.has(id);
              const imgShown = asPicture ? hasImg : (preshow || flipped.has(id)) && hasImg;
              // As a picture the name shows only once revealed or once we know
              // the species has no image — never in the gap while images load.
              const nameShown = asPicture ? flipped.has(id) || noImg.has(id) : true;
              // A reveal control exists on the harder days: it flips the hidden
              // half (picture normally, name in picture mode). None on easy days,
              // and — in either mode — none for an image-less tile: there's nothing
              // to reveal, so flipping it must never cost a reveal.
              const canReveal = asPicture ? hasImg : !preshow && hasImg;
              const noun = asPicture ? "name" : "picture";
              const nextCost = revealCostOf(g.revealed.length);
              const flipTitle = g.revealed.includes(id)
                ? `Hide ${noun}`
                : nextCost > 0
                ? `Reveal its ${noun} (−${nextCost} pts)`
                : `Reveal its ${noun} (free)`;
              return (
                <button
                  key={id}
                  className={`grid-tile${on ? " is-sel" : ""}${imgShown ? " is-flipped" : ""}`}
                  aria-pressed={on}
                  onClick={() => g.toggle(id)}
                >
                  {imgShown && <img className="grid-tile-bg" src={thumbs[id]} alt="" aria-hidden="true" />}
                  {imgShown && <img className="grid-tile-img" src={thumbs[id]} alt="" />}
                  {imgShown && (
                    <span
                      className="grid-tile-zoom"
                      role="button"
                      tabIndex={0}
                      title="Enlarge picture"
                      aria-label={nameShown ? `Enlarge ${nameOf(id)} picture` : "Enlarge picture"}
                      onClick={(e) => { e.stopPropagation(); setZoomId(id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setZoomId(id); } }}
                    >
                      ⤢
                    </span>
                  )}
                  {nameShown ? (
                    <span className={imgShown ? "grid-tile-cap" : "grid-tile-name"}>{nameOf(id)}</span>
                  ) : (
                    imgShown && <span className="grid-tile-cap is-hidden">· · ·</span>
                  )}
                  {canReveal && (
                    <span
                      className="grid-tile-flip"
                      role="button"
                      tabIndex={0}
                      title={flipTitle}
                      onClick={(e) => { e.stopPropagation(); flip(id); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); flip(id); } }}
                    >
                      {pictureMode ? "🔤" : "🔍"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="grid-mistakes" aria-label={`${g.mistakesLeft} guesses left`}>
            <span className="grid-mistakes-lbl">Mistakes left</span>
            <span className="grid-dots">
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i} className={`grid-dot${i < g.mistakes ? " is-used" : ""}`} aria-hidden="true" />
              ))}
            </span>
          </div>

          {!preshow && (
            <div className={`grid-reveals${revealCost > 0 ? " is-penalised" : ""}`} aria-label="reveals used">
              <span className="grid-mistakes-lbl">{pictureMode ? "Names shown" : "Pictures shown"}</span>
              <span className="grid-reveals-val">{revealStatus}</span>
            </div>
          )}

          <p className="grid-peek-note">
            {preshow
              ? "Pictures are shown to help on the easier days."
              : pictureMode
              ? "Pictures only today, no names. Tap 🔤 on a tile to reveal its name; the first three are free, then each one costs a little score."
              : "Tap the 🔍 on a tile to see its picture. The first three are free; after that, each one costs a little score."}
          </p>

          {g.feedback && <div className="grid-feedback" role="status">{g.feedback}</div>}

          <div className="grid-controls">
            <button className="linkbtn" onClick={g.shuffle}>Shuffle</button>
            <button className="linkbtn" onClick={g.deselectAll} disabled={g.selected.length === 0}>
              Deselect all
            </button>
            <button
              className="grid-submit"
              onClick={g.submit}
              disabled={g.selected.length !== 4}
            >
              Guess
            </button>
          </div>
        </>
      )}

      {/* Result + share. */}
      {over && (
        <div className="grid-result">
          <div className="grid-verdict">
            {g.status === "won"
              ? `Solved with ${g.mistakes} mistake${g.mistakes === 1 ? "" : "s"}. Good game 😎`
              : `Out of guesses. Sad. Found ${g.solvedGroups.length}/4`}
          </div>
          <div className="grid-scoreline">
            🧬 {kinshipPoints(g.status === "won", g.tier, g.mistakes, g.paidReveals)} pts
            {g.status === "won" && streak != null && streak > 0 && (
              <span className="grid-streak"> · 🔥 {streak}-day streak</span>
            )}
          </div>
          <div className="share">
            <div className="share-head">🧩 Grebe Kinship <span>· №{dailyNumber(g.date)}{rules.difficulty ? ` · ${rules.difficulty}` : ""}</span></div>
            <div className="grid-share-rows">
              {g.attempts.map((r, i) => (
                <div key={i} className="grid-share-row">{r.map((l) => LEVEL_SQUARE[l]).join("")}</div>
              ))}
            </div>
            <div className="share-verdict">
              {g.status === "won" ? `Solved. Nice. · ${g.mistakes} mistake${g.mistakes === 1 ? "" : "s"}` : `Missed it 🐡 · ${g.solvedGroups.length}/4 groups`}
              {g.revealed.length > 0 && ` · ${g.revealed.length} reveal${g.revealed.length === 1 ? "" : "s"}`}
              <span className="share-score"> · {kinshipPoints(g.status === "won", g.tier, g.mistakes, g.paidReveals)} pts</span>
              {g.status === "won" && streak != null && streak > 0 && <span className="share-streak"> · 🔥{streak}</span>}
            </div>
            <button className="share-btn" onClick={copy}>{copied ? "Copied ✓" : "Copy result"}</button>
          </div>
          <LeaderboardNudge show={!!configured && !me} />
          <KinshipTree tree={tree} board={g.board} levelOf={g.levelOf} onPick={setWikiId} />
          {g.locked && <p className="daily-lock">✓ You’ve played today’s Kinship. Come back tomorrow for a new board.</p>}
          {configured && (
            <Leaderboard
              game="kinship" label="Kinship" variant="today" me={me ?? null} reloadKey={reloadKey} streak={streak}
              note="Score rewards harder days and fewer mistakes. A clean board earns the full weight."
            />
          )}
        </div>
      )}

      {/* Same reusable board as Lineage and Branches, different key. Outside the
          `over` guard so an unfinished board can still show the one-line nudge. */}
      <DiscussionPanel
        board="kinship"
        date={todayKey()}
        configured={!!configured}
        signedIn={!!userId}
        played={over}
        label="today’s Kinship"
      />

      {wikiNode && <WikiCard node={wikiNode} tree={tree} onClose={() => setWikiId(null)} />}

      {zoomId && (fulls[zoomId] || thumbs[zoomId]) && (() => {
        // In picture mode the name is the hidden thing: don't leak it in the
        // enlarged view unless this tile's name has already been revealed (or
        // the species has no image, so its name is shown as a fallback anyway).
        const zoomNameShown = !pictureMode || flipped.has(zoomId) || noImg.has(zoomId);
        const zoomName = zoomNameShown ? nameOf(zoomId) : "";
        return (
          <div className="grid-zoom" role="dialog" aria-label={zoomNameShown ? `${zoomName} picture` : "Enlarged picture"} onClick={() => setZoomId(null)}>
            <img src={fulls[zoomId] ?? thumbs[zoomId]} alt={zoomName} />
            <span className="grid-zoom-cap">{zoomNameShown ? `${zoomName} · tap to close` : "tap to close"}</span>
          </div>
        );
      })()}

      {pendingReveal && (
        <div className="grid-confirm" role="alertdialog" aria-label="Confirm reveal" ref={confirmRef}>
          <p>
            You’ve used your {KINSHIP_FREE_REVEALS} free reveals. Showing this{" "}
            {pictureMode ? "name" : "picture"} deducts <b>{revealCostOf(g.revealed.length)}</b> of your{" "}
            <b>{kinshipPoints(true, g.tier, 0)}</b> points.
          </p>
          <div className="grid-confirm-actions">
            <button className="linkbtn" onClick={() => setPendingReveal(null)}>Cancel</button>
            <button
              className="grid-submit"
              onClick={() => { const id = pendingReveal; setPendingReveal(null); doFlip(id); }}
            >
              Reveal (−{revealCostOf(g.revealed.length)})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
