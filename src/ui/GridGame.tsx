import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Tree } from "../core";
import { dailyNumber } from "../core";
import { useGridGame, PRESHOW_MAX_TIER, type GridComplete } from "../hooks/useGridGame";
import { resolveDailyRules } from "../data/dailySchedule";
import { kinshipPoints, kinshipFreeReveals } from "../data/score";
import { fetchImageAlternates, fetchWikiImage, type WikiCredit, type WikiImage } from "../data/wikipedia";
import { GameHeader } from "./GameHeader";
import { WikiCard } from "./WikiCard";
import { PhotoCredit, usePhotoCredit, usePhotoPager } from "./PhotoZoom";
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

/** The Arrange note's window, inclusive. MOVE THESE to the real deploy date: this ships
 *  behind a Kinship repin, so the day it reaches players isn't the day it was written. A
 *  window in the past shows nothing, which is how it retires itself. */
const ARRANGE_NOTE_FROM = "2026-09-05";
const ARRANGE_NOTE_UNTIL = "2026-09-12";
const ARRANGE_NOTE_KEY = "grebe.announce.arrange";

/** How many tiles make a group — the count the solve animation photographs. */
const GRID_GROUP_SIZE = 4;
/** The guess animation runs in three beats, and the first one happens BEFORE the guess is
 *  resolved, which is the whole point of splitting it up:
 *
 *   1. LIFT   the four selected tiles brighten and gain depth where they stand, keeping
 *             their normal colours. This fires on every guess, right or wrong, because at
 *             this moment the game has not told you which it is — colouring here would give
 *             the answer away early. It changes no geometry: scaling a grid tile makes it
 *             overlap its neighbours, and four of them lifting at once read as the whole
 *             board twitching.
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
function GroupBar({ tree, group, dimmed, fresh, onPick, onZoom, thumbs }: { tree: Tree; group: GridGroup; dimmed?: boolean; fresh?: boolean; onPick?: (id: string) => void; onZoom?: (id: string) => void; thumbs?: Record<string, string> }) {
  const nameOf = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
  // The picture gallery is the END-OF-BOARD view: `thumbs` is passed only once the game is
  // over. Mid-game the bar stays a text line, both because a taller bar would reflow the
  // board under the solve animation's feet and because a name-only day charges points to
  // see a picture — the group is solved by then, but the bars sit above a board still
  // being played. Images are already in hand: the board fetches all sixteen up front
  // whatever the reveal mode, so this adds no request.
  return (
    <div className={`grid-solved lvl-${group.level}${dimmed ? " is-dim" : ""}${fresh ? " is-fresh" : ""}`}>
      <div className="grid-solved-label">
        {group.label}
        {group.sciLabel && group.sciLabel !== group.label && <span className="grid-solved-sci"> · {group.sciLabel}</span>}
      </div>
      {thumbs ? (
        <div className="grid-solved-gallery">
          {group.memberIds.map((id) => {
            const src = thumbs[id];
            const name = nameOf(id);
            // Two targets, matching what the tiles already do: the PICTURE enlarges, the
            // NAME opens the Wikipedia card. Keeping them apart is what lets the thumbnails
            // be this small — you tap to see it properly rather than reading it in place.
            return (
              <div key={id} className="grid-solved-pic">
                {src ? (
                  <button type="button" className="grid-solved-shot" onClick={() => onZoom?.(id)} title={`Enlarge ${name}`} aria-label={`Enlarge ${name}`}>
                    <img src={src} alt="" loading="lazy" />
                  </button>
                ) : (
                  // No photo on Wikipedia (or not loaded yet): the slot keeps its place so
                  // the row stays a tidy four across, and the name carries it.
                  <span className="grid-solved-shot is-empty" aria-hidden="true" />
                )}
                {onPick ? (
                  <button type="button" className="grid-solved-cap grid-member-link" onClick={() => onPick(id)}>{name}</button>
                ) : (
                  <span className="grid-solved-cap">{name}</span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
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
      )}
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
  // Which tiles are showing their hidden half: exactly the revealed ones. A REVEAL IS
  // PERMANENT. It used to be a toggle, so a revealed tile offered "Hide picture" and could be
  // put back face-down. That was wrong in both directions: the peek is already spent and
  // billed, so hiding refunds nothing, and offering an undo next to something you just paid
  // for implies it might. There is also nothing to gain from it, since the tile shows both
  // halves once flipped.
  //
  // Derived from g.revealed rather than tracked separately, because g.revealed is persisted
  // and this component is not: every tab switch unmounts GridGame (App renders it behind
  // `view === "kinship"`), and when a local `flipped` set lived here the board came back
  // face-down while the reveals stayed spent, and paid for.
  const flipped = useMemo(() => new Set(g.revealed), [g.revealed]);
  // Full-res image per species for the click-to-enlarge overlay (fetched alongside
  // the thumbnail, so no extra request), and which tile is currently enlarged.
  const [fulls, setFulls] = useState<Record<string, string>>({});
  // Photographer + licence, shown in the enlarged view. Kept beside the URLs rather than
  // replacing them with the whole WikiImage: the tiles read `thumbs[id]` in a dozen places
  // and only the overlay has room for a credit line.
  const [credits, setCredits] = useState<Record<string, WikiCredit>>({});
  const [zoomId, setZoomId] = useState<string | null>(null);
  // Every photograph we hold of the enlarged species, so the overlay can page through them.
  // Loaded on OPEN rather than with the board: a board is sixteen tiles and only one of them
  // is ever enlarged, so fetching all sixteen species' alternates up front would be fifteen
  // wasted reads of the photo map for every one that gets looked at.
  const [zoomAlts, setZoomAlts] = useState<WikiImage[]>([]);
  useEffect(() => {
    if (!zoomId) { setZoomAlts([]); return; }
    const node = tree.byId.get(zoomId);
    if (!node) { setZoomAlts([]); return; }
    let live = true;
    fetchImageAlternates(node).then((a) => { if (live) setZoomAlts(a); });
    return () => { live = false; };
  }, [zoomId, tree, devSettings.photoSource]);
  // Choosing a photo writes straight into the maps the tiles already read, so every place
  // that renders this species picks it up. Component state and nothing else: it lasts as
  // long as the board and is gone on reload, so one player's choice can never make their
  // puzzle differ from everyone else's tomorrow.
  const zoomPager = usePhotoPager(zoomAlts, zoomId, {
    current: zoomId ? fulls[zoomId] : null,
    onPick: (img) => {
      if (!zoomId) return;
      setThumbs((t) => ({ ...t, [zoomId]: img.thumb }));
      setFulls((f) => ({ ...f, [zoomId]: img.full }));
      setCredits((c) => {
        const next = { ...c };
        if (img.credit) next[zoomId] = img.credit; else delete next[zoomId];
        return next;
      });
    },
  });
  // What the overlay is actually showing: the pager's picture once its alternates land, and
  // until then the one the tile already had. Both the <img> and the credit read this, so
  // they can never describe different photographs.
  const zoomImage = useMemo<WikiImage | null>(() => {
    if (zoomPager.image) return zoomPager.image;
    if (!zoomId) return null;
    const full = fulls[zoomId] ?? thumbs[zoomId];
    return full ? { thumb: thumbs[zoomId] ?? full, full, credit: credits[zoomId] } : null;
  }, [zoomPager.image, zoomId, fulls, thumbs, credits]);
  const zoomCredit = usePhotoCredit(zoomImage);
  // Post-game Wikipedia reader.
  const [wikiId, setWikiId] = useState<string | null>(null);
  // SOLVE ANIMATION — the four tiles gather and lift into their group bar, as Connections
  // does. It is deliberately a decoration LAYERED OVER the real board rather than part of
  // it: the hook moves a solved group out of `remaining` the instant the guess lands, so
  // instead of delaying that (which would put a ~half-second animation inside the guess
  // path, and inside scoring and persistence with it) we photograph the four tiles just
  // BEFORE submitting and fly copies of them to the bar afterwards. If any of it fails or
  // is skipped, the game underneath has already moved on correctly.
  //
  // The board is FROZEN while it plays. Letting the real board update underneath was the
  // whole problem: solving removes four tiles and inserts a bar, so in one frame the grid
  // reflows 16 cells to 12 and everything below drops by the bar's height — while the ghosts,
  // fixed to the viewport at the coordinates the tiles used to occupy, stay put. The result
  // reads as the board tearing. So for the duration the grid keeps rendering its pre-solve
  // tiles (the flown four as invisible placeholders, holding their cells open) and the new
  // bar is withheld. Everything changes once, at the end, as the ghosts arrive.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [fly, setFly] = useState<{ ids: string[]; rects: Record<string, DOMRect>; level: number; cladeId: string; frozen: string[] } | null>(null);
  /** The bar that just finished receiving its tiles — the only one that animates in. */
  const [freshBar, setFreshBar] = useState<string | null>(null);
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
    // The grid exactly as it stands now, so it can go on being rendered while the ghosts fly
    // and the real board moves on underneath.
    const frozen = [...g.remaining];
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
      if (grp) setFly({ ids, rects, level: grp.level, cladeId: grp.cladeId, frozen });
      gRef.current.submit();
    }, POP_MS);
  }

  useLayoutEffect(() => {
    if (!fly) return;
    // Frame 1 paints the ghosts uncoloured, exactly over where the popped tiles were; frame 2
    // lights them. Both in one frame and the browser has nothing to interpolate from.
    const raf = requestAnimationFrame(() => setFlyPhase("lit"));
    // They aim at the TOP OF THE BOARD, not at the bar: the bar is deliberately not rendered
    // yet (it would shove the whole page down mid-flight), so there is nothing to measure.
    // The top edge is where it will appear, which is the same place to the eye.
    const go = setTimeout(() => {
      const b = boardRef.current?.getBoundingClientRect();
      if (!b) { setFly(null); return; }
      setFlyPhase("go");
      setFlyTo({ x: b.left + b.width / 2, y: b.top });
    }, LIGHT_MS);
    const done = setTimeout(
      () => {
        setFly(null); setFlyTo(null); setFlyPhase("start");
        // Only now does the board catch up — placeholders go, bar arrives, one reflow.
        setFreshBar(fly.cladeId);
        setTimeout(() => setFreshBar(null), 900);
      },
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
  // Same for the Wikipedia card, matching Branches. Must live up here with the other hooks:
  // the board's two loading early-returns are below, so a hook after them changes the hook
  // count the moment a board arrives. `nearest` means no movement when the card is already
  // on screen, so clicking from one species to the next doesn't jump the page.
  const wikiRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (wikiId) wikiRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [wikiId]);

  // ARRANGE MODE — pick up a tile, then tap another to swap them, so candidate groups can be
  // put side by side instead of tracked in a notes app.
  //
  // A mode rather than a drag on purpose. Tap already means "select for a guess", so
  // arranging needs its own verb, and real touch drag would mean long-press (the least
  // discoverable gesture there is) to keep it apart from a page scroll. Branches reached the
  // same conclusion: its HTML5 `draggable` is desktop-only and phones use tap-to-place.
  // A visible toggle beside Shuffle costs one button and works identically everywhere.
  const [arranging, setArranging] = useState(false);
  const [held, setHeld] = useState<string | null>(null);
  // One-time note that Arrange exists. Dated so it takes itself down: once ARRANGE_NOTE_UNTIL
  // has passed these three lines and the aside below can be deleted. Using Arrange counts as
  // having read it, the same way tapping through counted for the Mosaic announcement.
  const [noteSeen, setNoteSeen] = useState(() => {
    try { return localStorage.getItem(ARRANGE_NOTE_KEY) === "1"; } catch { return false; }
  });
  const markNoteSeen = () => {
    setNoteSeen(true);
    try { localStorage.setItem(ARRANGE_NOTE_KEY, "1"); } catch { /* shows again next visit */ }
  };
  const showArrangeNote = !noteSeen && todayKey() >= ARRANGE_NOTE_FROM && todayKey() <= ARRANGE_NOTE_UNTIL;
  // Leaving the mode must not strand a held tile, and a finished board has no board to
  // arrange. Selection and pick-up are mutually exclusive, so entering clears the selection.
  const toggleArrange = () => {
    setArranging((on) => {
      if (!on) g.deselectAll();
      return !on;
    });
    setHeld(null);
    markNoteSeen();
  };
  // `g.status` rather than `over`, which is computed below the board's early returns.
  const finished = g.status !== "playing";
  useEffect(() => { if (finished) { setArranging(false); setHeld(null); } }, [finished]);
  const arrangeTap = (id: string) => {
    if (held === null) { setHeld(id); return; }
    if (held !== id) g.swap(held, id);
    setHeld(null); // tapping the held tile again just puts it down
  };

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
          if (img.credit) setCredits((c) => (c[id] ? c : { ...c, [id]: img.credit! }));
        } else setNoImg((s) => (s.has(id) ? s : new Set(s).add(id)));
      });
    }
    return () => { live = false; };
    // photoSource is in here so the test bench can swap sources on the board in front of
    // you. Nothing else about the board depends on it, so the tiles and their arrangement
    // stay put and only the pictures change, which is the whole point of the comparison.
    // photoSource is in here so the test bench can swap sources on the board in front of
    // you. Nothing else about the board depends on it, so the tiles and their arrangement
    // stay put and only the pictures change, which is the whole point of the comparison.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preshow, pictureMode, tiles, tree, devSettings.photoSource]);

  // Drop what the previous source produced when it changes, and drop the whole lot on a NEW
  // BOARD so any photo swapped by hand goes with it. The prefetch above keeps an entry it
  // already has (a picture must not flicker mid-board), so without this the old URLs simply
  // stay: the bench toggle would look inert, and a chosen photo would follow the species
  // into the next board. Refetching costs nothing — fetchWikiImage answers from its own
  // cache, which the pick deliberately never touches.
  useEffect(() => {
    setThumbs({});
    setFulls({});
    setCredits({});
    setNoImg(new Set());
  }, [tiles, devSettings.photoSource]);

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

  // Reveal a tile's hidden half. One way only: once revealed it stays revealed.
  function doFlip(id: string) {
    if (g.revealed.includes(id)) return;
    g.reveal(id);
    if (!thumbs[id]) {
      const node = tree.byId.get(id);
      if (node) fetchWikiImage(node).then((img) => {
        if (img) {
          setThumbs((t) => ({ ...t, [id]: img.thumb }));
          setFulls((f) => ({ ...f, [id]: img.full }));
          if (img.credit) setCredits((c) => ({ ...c, [id]: img.credit! }));
        }
      });
    }
  }

  // A reveal that would cost points warns first; free ones go straight through.
  function flip(id: string) {
    if (g.revealed.includes(id)) return;
    if (revealCostOf(g.revealed.length) > 0) {
      setPendingReveal(id);
      return;
    }
    doFlip(id);
  }

  // The board now arrives from the pin, so there is a moment with no board and no problem.
  if (g.boardLoading) return <p className="empty">Loading today’s board…</p>;
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

      {sandbox && <PlaytestBar dev={devSettings} onAutosolve={g.solve} />}

      {/* Solved groups — plus, after a loss, the ones never found (dimmed). Always
          ordered by difficulty level so the colours read as a scale, like
          Connections (easiest/yellow at top, trickiest/purple at the bottom). */}
      {[
        // The group currently in flight is withheld: showing its bar now would push the
        // board down by the bar's height while the ghosts are still crossing it.
        ...g.solvedGroups.filter((grp) => grp.cladeId !== fly?.cladeId).map((grp) => ({ grp, dimmed: false })),
        ...(g.status === "lost" ? unsolved.map((grp) => ({ grp, dimmed: true })) : []),
      ]
        .sort((a, b) => a.grp.level - b.grp.level)
        .map(({ grp, dimmed }) => (
          <GroupBar key={grp.cladeId} tree={tree} group={grp} dimmed={dimmed} fresh={grp.cladeId === freshBar} onPick={over ? setWikiId : undefined} onZoom={setZoomId} thumbs={over && !fly ? thumbs : undefined} />
        ))}
      {over && <p className="grid-peek-note">Tap any species to read about it on Wikipedia.</p>}

      {/* Directly under the group bars it was opened from. It used to render last in the
          component, which put it below the result, the share block, the leaderboard and the
          discussion — a tap appeared to do nothing until you scrolled past all of them. */}
      {wikiNode && (
        <div ref={wikiRef}>
          <WikiCard node={wikiNode} tree={tree} onClose={() => setWikiId(null)} />
        </div>
      )}

      {/* The live board. */}
      {!over && (
        <>
          {showArrangeNote && (
            <aside className="announce" data-game="kinship">
              <span className="announce-tag">New</span>
              <p className="announce-text">
                You can sort the board by hand now. Tap <b>Arrange</b> below, then tap two
                species to swap them.
              </p>
              <button className="announce-x" aria-label="Dismiss" onClick={markNoteSeen}>×</button>
            </aside>
          )}

          <div className="grid-board" role="group" aria-label="Species tiles" ref={boardRef}>
            {(fly ? fly.frozen : g.remaining).map((id) => {
              // A tile that has flown: its cell stays, empty and invisible, so the grid keeps
              // its shape until the animation is over and everything reflows at once.
              if (fly?.ids.includes(id)) return <div key={id} className="grid-tile-ghosted" aria-hidden="true" />;
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
              // …and gone once spent: a reveal is one-way, so the control retires with the
              // thing it revealed rather than turning into an undo that refunds nothing.
              const canReveal = (given ? false : asPicture ? hasImg : !preshow && hasImg) && !g.revealed.includes(id);
              const noun = asPicture ? "name" : "picture";
              const nextCost = revealCostOf(g.revealed.length);
              const flipTitle = nextCost > 0
                ? `Reveal its ${noun} (−${nextCost} pts)`
                : `Reveal its ${noun} (free)`;
              return (
                <button
                  key={id}
                  data-tile={id}
                  className={`grid-tile${on ? " is-sel" : ""}${imgShown ? " is-flipped" : ""}${popping?.includes(id) ? " is-pop" : ""}${arranging ? " is-arranging" : ""}${held === id ? " is-held" : ""}`}
                  aria-pressed={arranging ? held === id : on}
                  // Locked while a guess is popping: the selection on screen must be the one
                  // that gets resolved when the beat ends.
                  onClick={() => { if (popping) return; if (arranging) arrangeTap(id); else g.toggle(id); }}
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

          {arranging && (
            <p className="grid-arrange-note" role="status">
              {held ? "Now tap where it should go." : "Tap a species, then tap another to swap them."}
            </p>
          )}

          <div className="grid-controls">
            <button className="linkbtn" onClick={g.shuffle} disabled={!!popping || arranging}>Shuffle</button>
            <button className={`linkbtn${arranging ? " is-on" : ""}`} onClick={toggleArrange} disabled={!!popping} aria-pressed={arranging}>
              {arranging ? "Done arranging" : "Arrange"}
            </button>
            <button className="linkbtn" onClick={g.deselectAll} disabled={g.selected.length === 0 || !!popping || arranging}>
              Deselect all
            </button>
            <button
              className="grid-submit"
              onClick={handleSubmit}
              disabled={g.selected.length !== 4 || !!popping || arranging}
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
        // Starts exactly where the tile stood, at its own size — the beat before this one
        // changes no geometry either, so nothing jumps at the handover. The only scaling
        // happens in flight, away from the board, as the tile shrinks into the bar.
        const at = { left: r.left, top: r.top, width: r.width, height: r.height };
        const style =
          flyPhase === "go" && flyTo
            ? { left: flyTo.x - r.width / 2, top: flyTo.y - r.height / 2, width: r.width, height: r.height,
                opacity: 0, transform: "scale(0.45)", transitionDelay: `${i * FLY_STAGGER_MS}ms` }
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


      {zoomId && (fulls[zoomId] || thumbs[zoomId]) && (() => {
        // In picture mode the name is the hidden thing: don't leak it in the
        // enlarged view unless this tile's name has already been revealed (or
        // the species has no image, so its name is shown as a fallback anyway).
        // Once the board is over there is nothing left to protect, and the end-of-board
        // gallery zooms straight from a captioned picture — withholding the name there
        // would read as a bug.
        const zoomNameShown = over || !pictureMode || flipped.has(zoomId) || noImg.has(zoomId);
        const zoomName = zoomNameShown ? nameOf(zoomId) : "";
        return (
          <div className="grid-zoom" role="dialog" aria-label={zoomNameShown ? `${zoomName} picture` : "Enlarged picture"} onClick={() => setZoomId(null)}>
            {/* The pager's picture once its alternates have loaded; until then the one the
                tile was already showing, so opening the overlay is never a blank frame. */}
            <img src={zoomImage?.full ?? fulls[zoomId] ?? thumbs[zoomId]} alt={zoomName} />
            <span className="grid-zoom-cap">
              {zoomNameShown ? `${zoomName} · tap to close` : "tap to close"}
              {zoomPager.controls}
              <PhotoCredit credit={zoomCredit} />
            </span>
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
