import { useEffect, useState } from "react";
import type { Tree } from "../core";
import { dailyNumber } from "../core";
import { useGridGame, type GridComplete } from "../hooks/useGridGame";
import { resolveDailyRules } from "../data/dailySchedule";
import { kinshipPoints, kinshipRevealPenalty, KINSHIP_FREE_REVEALS } from "../data/score";
import { fetchWikiImage } from "../data/wikipedia";
import { GameHeader } from "./GameHeader";
import { WikiCard } from "./WikiCard";
import { Leaderboard } from "./Leaderboard";
import { LeaderboardNudge } from "./LeaderboardNudge";
import { KinshipTree } from "./KinshipTree";
import { PlaytestBar } from "./PlaytestBar";
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

/** Up to this tier (Gentle / Easy / Medium) every tile shows its picture from the
 *  start, free. On Tricky and above they stay hidden behind the reveal penalty. */
const PRESHOW_MAX_TIER = 3;

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

export function GridGame({ tree, streak, onComplete, me, configured, reloadKey, onHowItWorks, sandbox }: Props) {
  const devSettings = useDev();
  const dev = sandbox ? { tier: devSettings.tier, nonce: devSettings.nonce } : null;
  const g = useGridGame(tree, onComplete, dev);
  const [copied, setCopied] = useState(false);
  // Picture reveals: fetched thumbnails per species, and which tiles show them.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  // Species with no Wikipedia image (fetch resolved empty) — in picture mode their
  // name shows as a fallback rather than flashing every name before images load.
  const [noImg, setNoImg] = useState<Set<string>>(new Set());
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  // Post-game Wikipedia reader.
  const [wikiId, setWikiId] = useState<string | null>(null);

  // Easy/medium days show every picture from the start (free); harder days hide
  // them behind the reveal penalty. Sunday (tier 7) inverts it: pictures are the
  // tile, and the NAME is the hidden thing you reveal (first three free, then the
  // same gentle penalty) — recognise the organism by sight, then sort by clade.
  const preshow = g.tier > 0 && g.tier <= PRESHOW_MAX_TIER;
  const pictureMode = g.tier >= 7;
  const tiles = g.board?.tiles;
  useEffect(() => {
    if (!(preshow || pictureMode) || !tiles) return;
    let live = true;
    for (const id of tiles) {
      const node = tree.byId.get(id);
      if (!node) continue;
      fetchWikiImage(node).then((img) => {
        if (!live) return;
        if (img) setThumbs((t) => (t[id] ? t : { ...t, [id]: img.thumb }));
        else setNoImg((s) => (s.has(id) ? s : new Set(s).add(id)));
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preshow, pictureMode, tiles, tree]);

  // Flip a tile to its picture. Reveal (with its gentle penalty) happens on the
  // first flip of a species; after that, flipping just toggles the picture.
  function flip(id: string) {
    if (!g.revealed.includes(id)) g.reveal(id);
    if (!thumbs[id]) {
      const node = tree.byId.get(id);
      if (node) fetchWikiImage(node).then((img) => { if (img) setThumbs((t) => ({ ...t, [id]: img.thumb })); });
    }
    setFlipped((f) => { const n = new Set(f); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  if (!g.board) return <p className="empty">No grid puzzle available today.</p>;

  const over = g.status !== "playing";
  const rules = resolveDailyRules(g.date);
  const wikiNode = wikiId ? tree.byId.get(wikiId) ?? null : null;
  const pips = "●".repeat(g.tier) + "○".repeat(Math.max(0, 7 - g.tier));
  const day = new Date(`${g.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const nameOf = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;

  // Unsolved groups, revealed only after a loss (so the answer is always shown).
  const solvedIds = new Set(g.solvedGroups.map((x) => x.cladeId));
  const unsolved = g.board.groups.filter((x) => !solvedIds.has(x.cladeId));

  // Share: the classic coloured-square grid, one row per guess.
  const shareText = (() => {
    const head = `🧬 Grebe Kinship · №${dailyNumber(g.date)} · ${g.date} (${day})`;
    const rows = g.attempts.map((r) => r.map((l) => LEVEL_SQUARE[l]).join("")).join("\n");
    const verdict =
      g.status === "won"
        ? `Solved · ${g.mistakes} mistake${g.mistakes === 1 ? "" : "s"} · ${kinshipPoints(true, g.tier, g.mistakes)} pts`
        : `Missed it · ${g.solvedGroups.length}/4 groups`;
    return `${head}\n${pips}\n${rows}\n${verdict}`;
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

  return (
    <div className="grid-game">
      <GameHeader
        game="kinship"
        tier={g.tier}
        dayName={rules.dayName}
        difficulty={rules.difficulty}
        onHowItWorks={onHowItWorks}
        blurb="Sixteen species, four hidden groups of four, each a clade. Pick four you think share a group, then guess. Four wrong guesses allowed."
      />

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
              const imgShown = pictureMode ? hasImg : (preshow || flipped.has(id)) && hasImg;
              // In picture mode the name shows only once revealed or once we know
              // the species has no image — never in the gap while images load.
              const nameShown = pictureMode ? flipped.has(id) || noImg.has(id) : true;
              // A reveal control exists on the harder days: it flips the hidden
              // half (picture normally, name in picture mode). None on easy days,
              // and none in picture mode for an image-less tile (its name is shown).
              const canReveal = pictureMode ? hasImg : !preshow;
              const noun = pictureMode ? "name" : "picture";
              const flipTitle = g.revealed.includes(id)
                ? `Hide ${noun}`
                : g.revealed.length < KINSHIP_FREE_REVEALS
                ? `Reveal its ${noun} (free)`
                : `Reveal its ${noun} (a few more cost a little score)`;
              return (
                <button
                  key={id}
                  className={`grid-tile${on ? " is-sel" : ""}${imgShown ? " is-flipped" : ""}`}
                  aria-pressed={on}
                  onClick={() => g.toggle(id)}
                >
                  {imgShown && <img className="grid-tile-img" src={thumbs[id]} alt="" />}
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

          <p className="grid-peek-note">
            {preshow
              ? "Pictures are shown to help on the easier days."
              : pictureMode
              ? "Pictures only today — no names. Tap 🔤 on a tile to reveal its name; the first three are free, then every two more costs a little score."
              : "Tap the 🔍 on a tile to see its picture. The first three are free; after that, every two more costs a little score."}
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
              ? `Solved with ${g.mistakes} mistake${g.mistakes === 1 ? "" : "s"}`
              : `Out of guesses. Found ${g.solvedGroups.length}/4`}
          </div>
          <div className="grid-scoreline">
            🧬 {kinshipPoints(g.status === "won", g.tier, Math.min(4, g.mistakes + kinshipRevealPenalty(g.revealed.length)))} pts
            {g.status === "won" && streak != null && streak > 0 && (
              <span className="grid-streak"> · 🔥 {streak}-day streak</span>
            )}
          </div>
          <div className="share">
            <div className="share-head">🧬 Grebe Kinship <span>· №{dailyNumber(g.date)} · {g.date} ({day})</span></div>
            <div className="grid-share-rows">
              {g.attempts.map((r, i) => (
                <div key={i} className="grid-share-row">{r.map((l) => LEVEL_SQUARE[l]).join("")}</div>
              ))}
            </div>
            <button className="share-btn" onClick={copy}>{copied ? "Copied ✓" : "Copy result"}</button>
          </div>
          <LeaderboardNudge show={!!configured && !me} />
          <KinshipTree tree={tree} board={g.board} levelOf={g.levelOf} onPick={setWikiId} />
          {g.locked && <p className="daily-lock">✓ You’ve played today’s Kinship. A new board opens at midnight.</p>}
          {configured && (
            <Leaderboard
              game="kinship" label="Kinship" variant="today" me={me ?? null} reloadKey={reloadKey} streak={streak}
              note="Score rewards harder days and fewer mistakes. A clean board earns the full weight."
            />
          )}
        </div>
      )}

      {wikiNode && <WikiCard node={wikiNode} tree={tree} onClose={() => setWikiId(null)} />}
    </div>
  );
}
