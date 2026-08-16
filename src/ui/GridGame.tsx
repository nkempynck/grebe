import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Tree } from "../core";
import { dailyNumber } from "../core";
import { useGridGame, PRESHOW_MAX_TIER, type GridComplete } from "../hooks/useGridGame";
import { resolveDailyRules } from "../data/dailySchedule";
import { kinshipPoints, kinshipFreeReveals } from "../data/score";
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

/** Thu-Fri are MIXED: this many of the sixteen tiles arrive with BOTH halves showing,
 *  picture and name, and the other fourteen as names with the picture hidden. Those two days
 *  used to be the only ones with no free pictures at all, which is the cliff in the week: it
 *  is where obscure boards bite hardest, and it is why plant boards were unplayable there
 *  before they were moved off it.
 *
 *  These tiles were once four pictures with the NAME hidden, which was a second puzzle
 *  rather than a help: you had to identify four species by sight before the board even
 *  started. Two fully-known tiles is a foothold instead — it costs less of the board's
 *  information than four unnamed photos did, and it gives every player somewhere to begin. */
const MIXED_PICTURE_COUNT = 2;

/** How many tiles make a group — the count the solve animation photographs. */
const GRID_GROUP_SIZE = 4;
/** The guess animation runs in three beats, and the first one happens BEFORE the guess is
 *  resolved, which is the whole point of splitting it up:
 *
 *   1. POP    the four selected tiles swell in place, keeping their normal colours. This
 *             fires on every guess, right or wrong, because at this moment the game has not
 *             told you which it is — colouring here would give the answer away early.
 *   2. LIGHT  only on a correct guess: the four take on their group's colour, so you see the
 *             set resolve as a set.
 *   3. FLIGHT they gather into the bar, staggered so it reads as four things arriving rather
 *             than one block sliding.
 *
 *  Beat 1 delays the guess itself by POP_MS. That is the cost of showing it before the
 *  outcome, and it is why input is locked for that window (see handleSubmit) — otherwise a
 *  second click would resolve a selection different from the one on screen. */
const POP_MS = 420;
const LIGHT_MS = 420;
const FLY_MS = 760;
const FLY_STAGGER_MS = 80;
/** Honour the OS "reduce motion" setting: no photograph is taken and no ghost is rendered,
 *  so the board just updates instantly as it did before. */
const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** `fresh` is the group solved in THIS session, just now — only it animates in. Without the
 *  distinction every bar would replay its entrance whenever the component remounts, so
 *  coming back to the tab with three groups solved would pop all three. */
function GroupBar({ tree, group, dimmed, fresh, onPick }: { tree: Tree; group: GridGroup; dimmed?: boolean; fresh?: boolean; onPick?: (id: string) => void }) {
  const nameOf = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
  return (
    <div className={`grid-solved lvl-${group.level}${dimmed ? " is-dim" : ""}${fresh ? " is-fresh" : ""}`} data-solved={group.cladeId}>
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
  // Which tiles are showing their hidden half. This is DERIVED from g.revealed rather than
  // tracked alongside it, because g.revealed is persisted and this component is not: every
  // tab switch unmounts GridGame (App renders it behind `view === "kinship"`), and when a
  // plain `flipped` set lived here the board came back face-down while the reveals stayed
  // spent — and paid for. Re-clicking was at least free, since doFlip only bills a tile
  // absent from g.revealed, but it read as having lost the peek.
  //
  // So the only local state is the inverse: tiles the player deliberately flipped BACK.
  // That one is right to lose on unmount — it is a momentary "hide this again", not
  // something bought.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const flipped = useMemo(
    () => new Set(g.revealed.filter((id) => !hidden.has(id))),
    [g.revealed, hidden]
  );
  // Full-res image per species for the click-to-enlarge overlay (fetched alongside
  // the thumbnail, so no extra request), and which tile is currently enlarged.
  const [fulls, setFulls] = useState<Record<string, string>>({});
  const [zoomId, setZoomId] = useState<string | null>(null);
  // Post-game Wikipedia reader.
  const [wikiId, setWikiId] = useState<string | null>(null);
  // SOLVE ANIMATION — the four tiles gather and lift into their group bar, as Connections
  // does. It is deliberately a decoration LAYERED OVER the real board rather than part of
  // it: the hook moves a solved group out of `remaining` the instant the guess lands, so
  // instead of delaying that (which would put a ~half-second animation inside the guess
  // path, and inside scoring and persistence with it) we photograph the four tiles just
  // BEFORE submitting and fly copies of them to the bar afterwards. If any of it fails or
  // is skipped, the game underneath has already moved on correctly.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [fly, setFly] = useState<{ ids: string[]; rects: Record<string, DOMRect>; level: number; cladeId: string } | null>(null);
  const [flyTo, setFlyTo] = useState<{ x: number; y: number } | null>(null);
  /** "start" = mounted over the popped tiles, uncoloured. "lit" = wearing the group colour.
   *  "go" = flying into the bar. */
  const [flyPhase, setFlyPhase] = useState<"start" | "lit" | "go">("start");
  /** The tiles mid-POP, i.e. a guess is on screen but not yet resolved. Non-null also means
   *  the board is locked — see handleSubmit. */
  const [popping, setPopping] = useState<string[] | null>(null);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The timeout below resolves the guess a beat later, so it must call the CURRENT submit,
  // not the one captured when the button was clicked.
  const gRef = useRef(g);
  gRef.current = g;
  useEffect(() => () => { if (popTimer.current) clearTimeout(popTimer.current); }, []);

  // Pop first, resolve after. Nothing here can lose a guess: every path ends in submit(),
  // and if the tiles can't be measured the animation is simply skipped.
  function handleSubmit() {
    if (popping) return; // a guess is already playing out — ignore the second click
    if (g.selected.length !== GRID_GROUP_SIZE || reducedMotion()) { g.submit(); return; }
    // Measured NOW, before the pop scales them: a scaled element reports its scaled box, and
    // the ghosts need the tiles' real footprint to start from.
    const rects: Record<string, DOMRect> = {};
    for (const id of g.selected) {
      const el = boardRef.current?.querySelector(`[data-tile="${CSS.escape(id)}"]`);
      if (el) rects[id] = el.getBoundingClientRect();
    }
    const ids = [...g.selected];
    setPopping(ids);
    popTimer.current = setTimeout(() => {
      popTimer.current = null;
      // Read the outcome off the board directly instead of waiting to see a group appear in
      // g.solvedGroups. Watching for it meant reacting in an effect a render LATE, which left
      // one frame with the tiles already removed and no ghosts yet — a visible blink at the
      // handover. Deciding here lets both state changes land in one commit, so the ghosts are
      // painted by the same frame that takes the tiles away.
      const grp = gRef.current.board?.groups.find((gr) => ids.every((id) => gr.memberIds.includes(id)));
      setPopping(null);
      if (grp) setFly({ ids, rects, level: grp.level, cladeId: grp.cladeId });
      gRef.current.submit();
    }, POP_MS);
  }

  // Measure the bar only once it is actually laid out, then hand the ghosts their
  // destination on the NEXT frame so they paint at the start position first — set both in
  // one frame and the browser has nothing to interpolate from.
  useLayoutEffect(() => {
    if (!fly) return;
    if (!document.querySelector(`[data-solved="${CSS.escape(fly.cladeId)}"]`)) { setFly(null); return; }
    // Frame 1 paints the ghosts uncoloured, exactly over where the popped tiles were; frame 2
    // lights them. Both in one frame and the browser has nothing to interpolate from.
    const raf = requestAnimationFrame(() => setFlyPhase("lit"));
    // The bar is measured at TAKE-OFF rather than now: it is still opening underneath, and
    // measuring late costs nothing while keeping the target right if the page has shifted.
    const go = setTimeout(() => {
      const bar = document.querySelector(`[data-solved="${CSS.escape(fly.cladeId)}"]`);
      if (!bar) { setFly(null); return; }
      const r = bar.getBoundingClientRect();
      setFlyPhase("go");
      setFlyTo({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }, LIGHT_MS);
    const done = setTimeout(
      () => { setFly(null); setFlyTo(null); setFlyPhase("start"); },
      LIGHT_MS + FLY_MS + FLY_STAGGER_MS * 3 + 80
    );
    return () => { cancelAnimationFrame(raf); clearTimeout(go); clearTimeout(done); };
  }, [fly]);

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
  //     hidden thing you reveal (first FOUR free here, three elsewhere — see
  //     kinshipFreeReveals — then the same gentle penalty):
  //     recognise the organism by sight, then sort by clade.
  const preshow = g.tier > 0 && g.tier <= PRESHOW_MAX_TIER;
  const pictureMode = g.tier >= PICTURE_MODE_MIN_TIER;
  const mixedMode = g.tier > PRESHOW_MAX_TIER && g.tier < PICTURE_MODE_MIN_TIER;
  // Which tiles start as pictures on a mixed day. Ordered by a hash of the date and the tile
  // id, so the four scatter across the grid but every player sees the same board and it
  // survives a reload. This used to take every fourth tile of the board order, which with
  // sixteen tiles in four columns meant indices 0/4/8/12 — the entire first column, every
  // Thursday and Friday. Keyed off the whole board (not `remaining`) so a tile does not
  // change mode when a group is solved.
  const pictureOrder = useMemo(() => {
    const all = g.board?.tiles;
    if (!mixedMode || !all?.length) return [] as string[];
    const seed = g.board?.date ?? "";
    const hash = (str: string) => {
      let h = 2166136261;
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    };
    // NOTE: there used to be a guard here rejecting a pick that landed entirely in one row
    // or column, because four such tiles look deliberate and read as the first-column bug
    // this replaced. At MIXED_PICTURE_COUNT = 2 it is meaningless — two tiles share a row
    // one time in five by chance, and refusing that would stop the pair sitting anywhere
    // near each other. Reinstate it at selection time below if the count ever goes back up.
    return [...all].sort((a, b) => hash(seed + a) - hash(seed + b) || (a < b ? -1 : 1));
  }, [mixedMode, g.board]);

  // …and which of them actually become the gift tiles. Walking the order alone is not
  // enough: a species with no Wikipedia picture arrives as a bare name, so the board
  // silently hands out one gift instead of two. Take only tiles that HAVE an image.
  //
  // Sticky, and it never skips past a tile still loading: a tile whose image has not
  // resolved stops the walk rather than being passed over, so the final pair is the same
  // whatever order the fetches happen to return in, and a late arrival never reshuffles
  // the board under a player who has already started reading it.
  const [givenTiles, setGivenTiles] = useState<Set<string>>(new Set());
  useEffect(() => { setGivenTiles(new Set()); }, [g.board]);
  useEffect(() => {
    if (!mixedMode) return;
    setGivenTiles((prev) => {
      if (prev.size >= MIXED_PICTURE_COUNT) return prev;
      const next = new Set(prev);
      for (const id of pictureOrder) {
        if (next.size >= MIXED_PICTURE_COUNT) break;
        if (next.has(id)) continue;
        if (thumbs[id]) next.add(id);
        else if (!noImg.has(id)) break; // still loading — wait for it, don't jump the queue
      }
      return next.size === prev.size ? prev : next;
    });
  }, [mixedMode, pictureOrder, thumbs, noImg, g.board]);
  const pictureTiles = givenTiles;
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
  // The day's STARTING free budget. Must be the tier-aware value, not the flat
  // constant: the picture-only weekend starts with four, and useGridGame charges on
  // that basis. Reading the constant here told a weekend player their fourth peek
  // would cost points and popped the confirm for it, while the hook then billed
  // nothing — the counter and the charge disagreed.
  const freeReveals = kinshipFreeReveals(g.tier);

  const revealCostOf = (usedBefore: number) => {
    // Free-peek balance at `usedBefore` peeks: 3 + one per solved group, minus peeks
    // spent, plus those already billed. Above zero → the next peek is free.
    const balance = freeReveals + g.solvedGroups.length + g.paidReveals - usedBefore;
    if (balance > 0) return 0;
    return kinshipPoints(true, g.tier, 0, g.paidReveals) - kinshipPoints(true, g.tier, 0, g.paidReveals + 1);
  };

  // Actually flip a tile to its picture (reveal on first flip, then just toggle).
  function doFlip(id: string) {
    // A FIRST flip always ends up shown; only a later one toggles. Without the distinction
    // the first flip would reveal the tile and immediately hide it again, since `hidden`
    // starts empty for a tile nobody has hidden yet.
    const first = !g.revealed.includes(id);
    if (first) g.reveal(id);
    if (!thumbs[id]) {
      const node = tree.byId.get(id);
      if (node) fetchWikiImage(node).then((img) => {
        if (img) { setThumbs((t) => ({ ...t, [id]: img.thumb })); setFulls((f) => ({ ...f, [id]: img.full })); }
      });
    }
    // g.reveal above is what makes a tile show; this only tracks a deliberate flip BACK,
    // so toggling is "un-hide or hide" rather than "add or remove from shown".
    setHidden((h) => {
      const n = new Set(h);
      if (first) n.delete(id);
      else if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
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
    ? "Pictures only today, names hidden: flip a name with 🔤 (first four free, then a little score)."
    : mixedMode
    ? `${MIXED_PICTURE_COUNT} tiles arrive with their picture already shown: flip any other tile to its picture with 🔍 (first three free, then a little score).`
    : "Flip a tile to its picture with 🔍 (first three free, then a little score).";

  // Live reveal tracker (shown while reveals are in play, i.e. not the easy preshow
  // days): how many used, how many free remain, and — once past the free three —
  // the score it's costing (a deduction, NOT a board-ending mistake). The cost is
  // the points a clean win loses to the reveal penalty at this tier.
  const usedReveals = g.revealed.length;
  // Free-peek balance now: 3 + one per solved group, minus peeks spent, plus those
  // already billed. The score cost so far is the penalty on the PAID peeks.
  const freeBalance = freeReveals + g.solvedGroups.length + g.paidReveals - usedReveals;
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

      {/* What changed, for returning players. Collapsed by default: someone opening the game
          to play should not have to scroll past a changelog. Kept factual, downsides
          included — a player who notices the species got less familiar deserves to know it
          was deliberate rather than wonder if something broke. */}
      <details className="about-score grid-changelog">
        <summary>I updated Kinship quite a bit, check below what changed</summary>
        <ul>
          <li>
            <b>Boards repeat far less.</b> When a group comes back it now brings mostly
            different species: 29% of its tiles are repeats, down from 60%. Boards that
            closely resemble a recent one dropped by about two thirds. I stg if i had to see another Sailfish smh.
          </li>
          <li>
            <b>Every board has a real trap, hopefully, or at least a bit of a challenge.</b> There is always at least one pair of groups
            that are potentially easy to mix up. Boards where all four groups were obvious used
            to happen roughly twice a week. So these will hopefully be gone.
          </li>
          <li>
            <b>Mammal boards ask for closer groups.</b> Familiar animals are easier to sort
            than unfamiliar ones at the same distance on the tree, so mammals now have to be
            more tightly related to earn the same day. But it's not a crazy difference.
          </li>
          <li>
            <b>Thursday and Friday start you off.</b> Two tiles arrive with both their picture
            and their name showing, instead of four pictures with the names hidden. Name only was a bit less fun imo so adding some pics starts you off and is a bit more appealing. I hope.
          </li>
          <li>
            <b>Reveals cost less.</b> A peek is 10% of the day's points instead of 15%, and
            the picture-only weekend starts with four free instead of three. This also helps with the overall increased difficulty.
          </li>
          <li>
            <b>Better pictures.</b> Range maps, diagrams and photos of cooked food no longer
            slip onto tiles, and about fifty species that were showing the wrong picture, or
            none, now show the right one. But mistakes can still happen.
          </li>
          <li>
            <b>The trade-off.</b> Groups are drawn from a wider slice of the tree, so you will
            meet less famous species and more scientific group names than before. That is the
            price of the variety above, and it was a deliberate choice. Note that repeats will still happen, and are unavoidable by the way kinship is structured and what the tree of life has us to offer.
          </li>
        </ul>
        <p className="grid-changelog-sign">
          I hope this makes kinship more stable and challenging and enjoyable! Shoutout to the
          day ones for always playing! Appreciate yall.
        </p>
      </details>

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
          <GroupBar key={grp.cladeId} tree={tree} group={grp} dimmed={dimmed} fresh={grp.cladeId === fly?.cladeId} onPick={over ? setWikiId : undefined} />
        ))}
      {over && <p className="grid-peek-note">Tap any species to read about it on Wikipedia.</p>}

      {/* The live board. */}
      {!over && (
        <>
          <div className="grid-board" role="group" aria-label="Species tiles" ref={boardRef}>
            {g.remaining.map((id) => {
              const on = g.selected.includes(id);
              const hasImg = !!thumbs[id];
              // Picture mode: the image is the tile, the name is revealed. Normal:
              // the name is the tile, the image is revealed. Easy days show both.
              // On a mixed day each tile has its OWN mode; elsewhere the board has one.
              const asPicture = pictureMode || pictureTiles.has(id);
              const imgShown = asPicture ? hasImg : (preshow || flipped.has(id)) && hasImg;
              // A mixed day's pictured tiles are a GIFT, not a second puzzle: both halves
              // show from the start. Only the picture-only weekend keeps a name hidden
              // behind a reveal.
              const given = !pictureMode && pictureTiles.has(id);
              // As a picture the name shows only once revealed or once we know
              // the species has no image — never in the gap while images load.
              const nameShown = asPicture && !given ? flipped.has(id) || noImg.has(id) : true;
              // A reveal control exists on the harder days: it flips the hidden
              // half (picture normally, name in picture mode). None on easy days,
              // none on a given tile (nothing is hidden), and — in either mode — none
              // for an image-less tile: there's nothing to reveal, so flipping it must
              // never cost a reveal.
              const canReveal = given ? false : asPicture ? hasImg : !preshow && hasImg;
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
                  data-tile={id}
                  className={`grid-tile${on ? " is-sel" : ""}${imgShown ? " is-flipped" : ""}${popping?.includes(id) ? " is-pop" : ""}`}
                  aria-pressed={on}
                  // Locked while a guess is popping: the selection on screen must be the one
                  // that gets resolved when the beat ends.
                  onClick={() => { if (!popping) g.toggle(id); }}
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
              ? "Pictures only today, no names. Tap 🔤 on a tile to reveal its name; the first four are free, then each one costs a little score."
              : "Tap the 🔍 on a tile to see its picture. The first three are free; after that, each one costs a little score."}
          </p>

          {g.feedback && <div className="grid-feedback" role="status">{g.feedback}</div>}

          <div className="grid-controls">
            <button className="linkbtn" onClick={g.shuffle} disabled={!!popping}>Shuffle</button>
            <button className="linkbtn" onClick={g.deselectAll} disabled={g.selected.length === 0 || !!popping}>
              Deselect all
            </button>
            <button
              className="grid-submit"
              onClick={handleSubmit}
              disabled={g.selected.length !== 4 || !!popping}
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

      {/* Solve animation: copies of the four tiles, flying into their group bar. Fixed to
          the viewport because the board reflows underneath them the moment the group is
          removed — anchoring to the page would drag them along with it. Purely visual, and
          inert: aria-hidden and pointer-events: none, so nothing here is reachable. */}
      {fly?.ids.map((id, i) => {
        const r = fly.rects[id];
        if (!r) return null;
        // The ghost takes over from a tile that is already popped, so it starts at the popped
        // scale and stays there until it flies — no second bounce.
        const at = { left: r.left, top: r.top, width: r.width, height: r.height, transform: "scale(1.06)" };
        const style =
          flyPhase === "go" && flyTo
            ? { left: flyTo.x - r.width / 2, top: flyTo.y - r.height / 2, width: r.width, height: r.height,
                opacity: 0, transform: "scale(0.3)", transitionDelay: `${i * FLY_STAGGER_MS}ms` }
            : at;
        return (
          <div
            key={id}
            className={`grid-ghost lvl-${fly.level}${flyPhase === "start" ? "" : " is-lit"}`}
            style={style}
            aria-hidden="true"
          >
            {thumbs[id] && <img src={thumbs[id]} alt="" />}
            <span>{nameOf(id)}</span>
          </div>
        );
      })}

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
            You’ve used your {freeReveals} free reveals. Showing this{" "}
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
