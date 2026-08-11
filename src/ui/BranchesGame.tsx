import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DisplayTreeNode, Tree } from "../core";
import { inducedSubtree, dailyNumber, boardSpoilers, namesTell, tellingWords, widespreadWords } from "../core";
import { resolveDailyRules } from "../data/dailySchedule";
import { GameHeader } from "./GameHeader";
import { useBranchesGame, type BranchesComplete } from "../hooks/useBranchesGame";
import { BRANCHES_MAX_HINTS, branchesPoints, tierWeight } from "../data/score";
import { fetchWikiImage, type WikiImage } from "../data/wikipedia";
import { treeLayout, radialLayout, CLADO_TREE, CLADO_RADIAL, type GraphLayout } from "./cladoLayout";
import { WikiCard } from "./WikiCard";
import { Leaderboard } from "./Leaderboard";
import { LeaderboardNudge } from "./LeaderboardNudge";
import { DiscussionPanel } from "./DiscussionPanel";
import { todayKey } from "../core/daily";
import { branchesShareRows, gameUrl } from "./share";
import { PlaytestBar } from "./PlaytestBar";
import { useDev } from "../data/devMode";

interface Props {
  tree: Tree;
  /** Fired once when a board is submitted — App records the result. */
  onComplete?: (r: BranchesComplete) => void;
  /** Opens the Branches section of the About page. */
  onHowItWorks?: () => void;
  /** Leaderboard name to highlight (null when signed out). */
  me?: string | null;
  /** Signed-in player's id (null when signed out) — restores/locks an
   *  already-played board from the server on any device. */
  userId?: string | null;
  /** True when a backend is configured — gates the post-game board. */
  configured?: boolean;
  /** Bump to refetch the post-game board after the result is submitted. */
  reloadKey?: number;
  /** The viewer's current Branches streak, shown in the board footer. */
  streak?: number | null;
  /** Renders inside the Admin test bench: difficulty/reshuffle/autosolve controls,
   *  no daily lock, nothing recorded. Off for the normal site. */
  sandbox?: boolean;
}

const nameOf = (tree: Tree, id: string) =>
  tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
const sciOf = (tree: Tree, id: string) => tree.byId.get(id)?.sciName ?? "";

export type BranchesView = "tree" | "radial";

// How far a tip's interactive tile floats out past its branch end in radial mode.
const TIP_OUT = 22;

/** Lay the skeleton out with the SAME engine + spacing Lineage uses, so the two
 *  games look identical; Branches then renders its own interactive leaf tiles.
 *  The tiles are wide boxes, so Branches needs more margin than Lineage's text
 *  labels: extra side padding for edge tiles and bottom room for those hanging
 *  below the deepest tip. Column/tier gaps stay identical, so the trees match. */

function branchesLayout(root: DisplayTreeNode, radial: boolean): GraphLayout {
  // Radial: labels radiate outward (see the render's `flip`), and the canvas is sized to
  // the real footprints — a leaf tile (up to ~148px wide) around its tip, and a clade label
  // (150px) extending outward — so nothing clips at the rim. Branches carries wider boxes
  // than Lineage's bare text, so it uses a bigger RADIUS (innerRadius) and enough angular
  // gap (gapx) that leaf tiles don't touch, without inflating the depth spacing into a
  // sprawl. Residual overlaps (a label over its own child's tile) are cleared after render
  // by sliding tiles outward — see the nudge effect. `pad` leaves room for that slide.
  if (radial) return radialLayout(root, {
    ...CLADO_RADIAL, ring: 88, innerRadius: 100, spanMax: 2.6, gapx: 160,
    pad: 44, rim: 74, focusId: null,
    tipOut: TIP_OUT, leafBox: { halfW: 78, halfH: 28 }, labelW: 150, labelHalfH: 14,
  });
  const L = treeLayout(root, { ...CLADO_TREE, padx: 92 });
  return { ...L, height: L.height + 56 };
}

/** Load Wikipedia lead images for the species-to-place (cached across renders). */
function useSpeciesImages(tree: Tree, ids: string[]): Record<string, WikiImage> {
  const key = ids.join(",");
  const [imgs, setImgs] = useState<Record<string, WikiImage>>({});
  useEffect(() => {
    let live = true;
    for (const id of ids) {
      const node = tree.byId.get(id);
      if (!node) continue;
      fetchWikiImage(node).then((img) => {
        if (live && img) setImgs((m) => (m[id] ? m : { ...m, [id]: img }));
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, key]);
  return imgs;
}

interface DragData {
  from: "tray" | "slot";
  speciesId: string;
  slotId?: string;
}
const readDrag = (e: React.DragEvent): DragData | null => {
  try {
    return JSON.parse(e.dataTransfer.getData("text/plain")) as DragData;
  } catch {
    return null;
  }
};

export function BranchesGame({ tree, onComplete, onHowItWorks, me, userId, configured, reloadKey, streak, sandbox }: Props) {
  const devSettings = useDev();
  const dev = sandbox ? { tier: devSettings.tier, nonce: devSettings.nonce } : null;
  const g = useBranchesGame(tree, onComplete, dev, userId);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [trayOver, setTrayOver] = useState(false);
  const [wikiId, setWikiId] = useState<string | null>(null);
  const [pendingPeek, setPendingPeek] = useState<string | null>(null);
  // A hint asked for but not yet paid for: the button only opens this warning, the
  // reveal happens on the confirm.
  const [pendingHint, setPendingHint] = useState(false);
  const [pendingRead, setPendingRead] = useState<{ id: string; url: string } | null>(null);
  const [mode, setMode] = useState<BranchesView>("radial");
  const [copied, setCopied] = useState(false);

  const skeleton = useMemo<DisplayTreeNode | null>(() => {
    if (!g.board) return null;
    const groups = new Set(g.board.groupIds);
    return inducedSubtree(tree, g.board.leafIds, (id) => groups.has(id));
  }, [tree, g.board]);
  const radial = mode === "radial";
  const layout = useMemo(
    () => (skeleton ? branchesLayout(skeleton, radial) : null),
    [skeleton, radial]
  );
  const trayImgs = useSpeciesImages(tree, g.board?.tray ?? []);
  const [zoomId, setZoomId] = useState<string | null>(null);

  // Radial overlap cleanup: after render, slide any leaf tile that overlaps a clade label
  // (or an earlier tile) outward along its own branch until it's clear. Tiles carry no
  // branch-anchored dot, so moving them along the ray reads naturally; labels stay put.
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // The wiki card and the article confirm both open at the foot of the page, below a
  // tree tall enough to fill the screen on its own. So bring each into view as it
  // appears: an unseen card reads as a dead tap, an unseen confirm as a dead link.
  // `nearest` scrolls only as far as it has to, and not at all when the card is
  // already on screen — switching from one clade to the next stays still.
  const wikiRef = useRef<HTMLDivElement>(null);
  const readConfirmRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (wikiId) wikiRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [wikiId]);
  useEffect(() => {
    if (pendingRead) readConfirmRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [pendingRead]);
  const tileEls = useRef<Map<string, HTMLDivElement>>(new Map());

  // Grab-to-pan the tree with a mouse: dragging empty canvas scrolls the stage.
  // Touch panning stays native (the stage scrolls under a finger), and species
  // tiles keep their own drag-to-place, so we only hijack primary-button MOUSE
  // drags that start on the background — not on a tile, clade, dot or button.
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onStageDown = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".branches-node, .clado-pt, button, a")) return;
    const stage = stageRef.current;
    if (!stage) return;
    pan.current = { x: e.clientX, y: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("is-panning");
  };
  const onStageMove = (e: React.PointerEvent) => {
    const p = pan.current;
    const stage = stageRef.current;
    if (!p || !stage) return;
    stage.scrollLeft = p.left - (e.clientX - p.x);
    stage.scrollTop = p.top - (e.clientY - p.y);
  };
  const onStageUp = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (pan.current && stage) {
      stage.releasePointerCapture(e.pointerId);
      stage.classList.remove("is-panning");
    }
    pan.current = null;
  };
  const nodeById = useMemo(() => new Map((layout?.nodes ?? []).map((n) => [n.id, n])), [layout]);
  const placementSig = Object.entries(g.placements).sort().join("|");
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    for (const el of tileEls.current.values()) el.style.transform = ""; // clear prior nudges (also on leaving radial)
    if (!radial) return; // tree mode stacks cleanly; nothing to nudge
    const c = canvas.getBoundingClientRect();
    const GAP = 5; // min clear space between boxes
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - c.left - GAP, y: r.top - c.top - GAP, w: r.width + 2 * GAP, h: r.height + 2 * GAP };
    };
    type R = { x: number; y: number; w: number; h: number };
    const hit = (a: R, b: R) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const obstacles: R[] = [...canvas.querySelectorAll(".clado-pt")].map(rect);
    const STEP = 8, MAX = 40;
    for (const id of [...tileEls.current.keys()].sort()) {
      const el = tileEls.current.get(id)!;
      const node = nodeById.get(id);
      if (!node) continue;
      const ox = node.ox ?? 0, oy = node.oy ?? 0;
      let r = rect(el), delta = 0;
      while (delta < MAX && obstacles.some((o) => hit(r, o))) {
        delta += STEP;
        r = { x: r.x + ox * STEP, y: r.y + oy * STEP, w: r.w, h: r.h };
      }
      if (delta > 0) el.style.transform = `translate(calc(-50% + ${(ox * delta).toFixed(1)}px), calc(-50% + ${(oy * delta).toFixed(1)}px))`;
      obstacles.push(r); // this tile is now an obstacle for the ones after it
    }
  }, [layout, radial, nodeById, g.status, g.tier, placementSig]);

  if (!g.board || !layout) return <p className="empty">No Branches puzzle available today.</p>;

  const board = g.board;
  const anchors = new Set(board.anchorIds);
  const groupSet = new Set(board.groupIds);
  const over = g.status === "done";
  const rules = resolveDailyRules(g.date);
  // Annotate the shared common ancestor (the skeleton's root). If that node is a
  // bare junction, walk up to the nearest named clade — a labelled ancestor reads
  // cleaner than an unnamed shared dot.
  const rootId = skeleton?.id ?? null;
  const namedAncestorOf = (id: string): string | null => {
    for (let cur: string | null = id; cur; cur = tree.byId.get(cur)?.parentId ?? null) {
      if (tree.byId.get(cur)?.sciName) return cur;
    }
    return null;
  };
  const rootAnnoId = rootId ? namedAncestorOf(rootId) : null;
  // From Thursday on (tier ≥ 4) clade LABELS show the scientific name only — the
  // harder-half analogue of Kinship hiding names midweek. (Species tiles keep their
  // common names via nameOf.)
  const CLADE_LATIN_MIN_TIER = 4;
  const cladeLatinOnly = g.tier >= CLADE_LATIN_MIN_TIER && !over; // reveal common names once solved
  // On EVERY tier, a clade goes Latin when its common name carries a word that
  // singles out a species still to place: "Old World sparrows" over a tray holding
  // the House Sparrow, or "Bottlenose Dolphin" over the Common bottlenose dolphin,
  // hands the placement over before anything is opened. "Bottlenose" is decisive
  // where "dolphin" — shared by three tiles — is not, so only the telling word
  // forces the switch. The Latin ("Passeridae", "Tursiops") gives nothing away.
  const unsolved = board.slotIds.filter((id) => !g.lockedSlots.includes(id)).map((id) => tree.byId.get(id));
  const telling = over ? new Set<string>() : tellingWords(unsolved);
  const cladeTells = (id: string) => namesTell(tree.byId.get(id)?.common, telling);
  const cladeLabel = (id: string) => {
    const n = tree.byId.get(id);
    const latin = cladeLatinOnly || cladeTells(id);
    return (latin ? n?.sciName ?? n?.common : n?.common ?? n?.sciName) ?? id;
  };
  // Brutal weekend (Sat/Sun, tier ≥ 6): also hide the rank subtitle ("GENUS"/"FAMILY").
  // Knowing a group's rank narrows placement, so the final escalation removes it — you
  // still have the Latin name, the tree shape and the pictures. Shown again once solved.
  const HIDE_RANK_MIN_TIER = 6;
  const hideRank = g.tier >= HIDE_RANK_MIN_TIER && !over;
  const won = g.won;
  const points = g.result ? branchesPoints(g.tier, won, g.result.total, g.result.correct, g.result.mistakes, g.result.hinted, g.result.peeked) : 0;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  // Shareable result grid: one row per submit (see branchesShareRows). The answer
  // species are never encoded — only whether each was placed right, and with what
  // help — so the grid is safe to post. Clean correct 🟩, hint-revealed 🟨,
  // peeked 🟦, wrong (or never placed, on a loss) ⬛.
  const shareSquare = (s: string) =>
    g.placements[s] !== s ? "⬛" : g.hints.includes(s) ? "🟨" : g.peeked.includes(s) ? "🟦" : "🟩";
  const shareRows = branchesShareRows(board.slotIds, g.attempts, shareSquare);
  const shareText = (() => {
    const head = `🌿 Grebe Branches · №${dailyNumber(g.date)}${rules.difficulty ? ` · ${rules.difficulty}` : ""}`;
    const grid = shareRows.join("\n");
    const tags = [
      g.result?.mistakes ? plural(g.result.mistakes, "mistake") : "",
      g.result?.hinted ? plural(g.result.hinted, "hint") : "",
      g.result?.peeked ? plural(g.result.peeked, "peek") : "",
    ].filter(Boolean).join(", ");
    const streakLine = won && streak != null && streak > 0 ? ` · 🔥${streak}` : "";
    const verdict = `${won ? "Solved 😎" : "Missed it"} · ${g.result?.correct}/${g.result?.total} placed${tags ? ` · ${tags}` : ""} · ${points} pts${streakLine}`;
    return `${head}\n${grid}\n${verdict}\n${gameUrl()}`;
  })();
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  const wikiNode = wikiId ? tree.byId.get(wikiId) ?? null : null;
  // A clade's summary names its members, and those members are routinely the tray
  // species themselves — free clade peeks would otherwise read out the answers. So
  // any species still unsolved has its name blanked out of whatever card is open,
  // in full and word by word ("Hercules beetles" gives away the Eastern Hercules
  // Beetle). The card's own subject keeps its wording, and nothing is hidden once
  // the board is done.
  const hiddenNames = over
    ? []
    : boardSpoilers(
        board.slotIds.filter((id) => id !== wikiId && !g.lockedSlots.includes(id)).map((id) => tree.byId.get(id)),
        // Words that pad hundreds of names ("common", "black") read as plain English
        // in an article, so they aren't blocked in prose. Labels above still are.
        widespreadWords(tree)
      );
  const peekNode = pendingPeek ? tree.byId.get(pendingPeek) ?? null : null;
  // Looking up a species you still have to place forfeits half its point, so it goes
  // through a confirm step; anchors + clade labels are free context and open at once.
  // A slot already locked (correct submit or hint) is free too: it has nothing left
  // to give away.
  const willCost = (id: string) =>
    !over && board.slotIds.includes(id) && !g.lockedSlots.includes(id) && !g.peeked.includes(id);
  const askWiki = (id: string) => (willCost(id) ? setPendingPeek(id) : setWikiId(id));
  const confirmPeek = () => { if (pendingPeek) { g.peek(pendingPeek); setWikiId(pendingPeek); setPendingPeek(null); } };
  // Reading the CARD is free for a clade — the prose above has every unplaced species
  // blanked out of it. The article on Wikipedia blanks nothing, so following the link
  // costs half a point, once per node, and only while a slot is still open. A node
  // already paid for (a peeked species, a locked slot, a clade read once) is free.
  const paidFor = (id: string) => g.reads.includes(id) || g.peeked.includes(id) || g.lockedSlots.includes(id);
  const readCosts = (id: string) => !over && unsolved.length > 0 && !paidFor(id);
  // "Half a point" is the scoring formula's unit, not anything a player can price: it
  // means half of one SLOT, and a slot is the day's weight split across the board. So
  // say it in the currency on the leaderboard instead. It scales with the board — a
  // 4-slot Friday charges 18 where a 7-slot Sunday charges 11 — so it has to be
  // computed, not written into the copy.
  //
  // This is the price on a clean board, hence "up to": a surviving mistake scales the
  // whole board down, which quietly makes a lookup cheaper. Not worth surfacing, since
  // help getting cheaper because you already blundered is a strange thing to advertise.
  const lookupCost = Math.round((tierWeight(g.tier) * 0.5) / board.slotIds.length);
  // A hint forfeits the WHOLE slot where a lookup forfeits half, so it prices at twice
  // the lookup. Same "up to": a mistake already scaled the board down, and a slot that
  // was looked up first has half its value gone, so the hint can only take the rest.
  const hintCost = Math.round(tierWeight(g.tier) / board.slotIds.length);
  const hintSpent = g.hints.length >= BRANCHES_MAX_HINTS;
  const confirmHint = () => { setPendingHint(false); g.hint(); };
  const confirmRead = () => {
    if (!pendingRead) return;
    g.readFull(pendingRead.id);
    window.open(pendingRead.url, "_blank", "noopener,noreferrer");
    setPendingRead(null);
  };
  const closeWiki = () => { setWikiId(null); setPendingRead(null); };

  const info = (id: string) => (
    <button className="branches-info" title={willCost(id) ? `Wikipedia (costs up to ${lookupCost} pts)` : "Wikipedia"} onClick={(e) => { e.stopPropagation(); askWiki(id); }}>ⓘ</button>
  );

  function LeafTile({ id }: { id: string }) {
    if (anchors.has(id)) {
      return (
        <div className="branches-leaf is-anchor" title={sciOf(tree, id)} onClick={() => setWikiId(id)}>
          <span className="branches-leaf-name">{nameOf(tree, id)}</span>
        </div>
      );
    }
    // Tiles are rearranged freely; only submitting grades them. A slot CONFIRMED
    // correct (by a correct submit or a hint) is locked green and can't be moved.
    // A slot left empty at game-over was never solved (a loss) — reveal its species.
    const placed = g.placements[id];
    const hinted = g.hints.includes(id);
    const locked = g.lockedSlots.includes(id);
    const correct = over && placed === id;
    const revealAnswer = over && placed !== id;
    const cls = [
      "branches-leaf is-slot",
      placed ? "is-filled" : "is-empty",
      locked ? "is-locked" : "",
      correct ? "is-correct" : "",
      hinted ? "is-hint" : "",
      dragOver === id ? "is-drop" : "",
      g.wrongSlots.includes(id) ? "is-wrongflash" : "",
      revealAnswer ? "is-wrong" : "",
    ].join(" ");
    // A placed tile's scientific name is a giveaway while the board is live: the
    // genus in "Nephila pilipes" is often the very clade label it belongs under, so
    // a hover would settle the placement. Shown only once the slot is CONFIRMED
    // (locked by a correct submit or a hint) or the board is done; until then the
    // tooltip says what the tile does instead.
    const showSci = locked || over;
    return (
      <div
        className={cls}
        title={placed ? (showSci ? sciOf(tree, placed) : "Drag out to change") : "Drop a species here"}
        onClick={() => { if (!over && !locked) g.placeAt(id); }}
        onDragOver={(e) => { if (!over && !locked) { e.preventDefault(); setDragOver(id); } }}
        onDragLeave={() => setDragOver((d) => (d === id ? null : d))}
        onDrop={(e) => { e.preventDefault(); setDragOver(null); if (over || locked) return; const d = readDrag(e); if (d?.speciesId) g.place(id, d.speciesId); }}
      >
        {placed ? (
          <span className="branches-leaf-line">
            <span
              className="branches-leaf-name"
              draggable={!over && !locked}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ from: "slot", speciesId: placed, slotId: id }))}
            >
              {nameOf(tree, placed)}
            </span>
            {locked && !hinted && <span className="branches-lock-tag" aria-hidden="true">✓</span>}
            {hinted && <span className="branches-hint-tag">hint</span>}
            {info(placed)}
          </span>
        ) : (
          <span className="branches-leaf-blank">place species</span>
        )}
        {revealAnswer && <span className="branches-leaf-answer">= {nameOf(tree, id)} {info(id)}</span>}
      </div>
    );
  }

  return (
    <div className="branches">
      <GameHeader
        game="branches"
        tier={g.tier}
        dayName={rules.dayName}
        difficulty={rules.difficulty}
        onHowItWorks={onHowItWorks}
        blurb={
          <>
            Drag each species onto the clade it belongs to, then Submit. Correct slots lock in. A wrong board costs a
            mistake and sends the misplaced tiles back. A species already placed is a worked example to build from.
            Reading a clade's card is free (species you still have to place are blanked out of the text). Looking up a
            species you have to place costs points, and so does opening the full Wikipedia article, where nothing is
            blanked out.
            <span className="gamehead-blurb-note">
              No outside lookups. The fun is working out the tree from what you already know.
            </span>
          </>
        }
      >
        <div className="branches-viewtoggle" role="tablist" aria-label="Tree view">
          <button role="tab" aria-selected={!radial} className={`branches-viewseg${!radial ? " is-on" : ""}`} onClick={() => setMode("tree")}>Tree</button>
          <button role="tab" aria-selected={radial} className={`branches-viewseg${radial ? " is-on" : ""}`} onClick={() => setMode("radial")}>Radial</button>
        </div>
      </GameHeader>

      {sandbox && <PlaytestBar dev={devSettings} onAutosolve={g.solve} />}

      <div
        ref={stageRef}
        className="branches-stage"
        onPointerDown={onStageDown}
        onPointerMove={onStageMove}
        onPointerUp={onStageUp}
        onPointerCancel={onStageUp}
      >
        <div ref={canvasRef} className="clado-canvas" style={{ width: layout.width, height: layout.height }}>
          <svg className="clado-links" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.links.map((l, i) => (
              <path key={i} d={l.d} className="clado-link" />
            ))}
          </svg>
          {layout.nodes.map((n) => {
            // Leaves are the game's interactive tiles: in radial mode a tip's tile
            // floats out along its branch; in tree mode it hangs from the tip.
            if (n.isLeaf) {
              const style = radial
                ? { left: n.x + (n.ox ?? 0) * TIP_OUT, top: n.y + (n.oy ?? 0) * TIP_OUT }
                : { left: n.x, top: n.y };
              return (
                <div
                  key={n.id}
                  ref={(el) => { if (el) tileEls.current.set(n.id, el); else tileEls.current.delete(n.id); }}
                  className={`branches-node is-leaf${radial ? " is-radial" : ""}`}
                  style={style}
                >
                  <LeafTile id={n.id} />
                </div>
              );
            }
            // Clades + junctions render exactly like Lineage's cladogram points. In the
            // radial fan a clade label extends INWARD (toward the centre), where there's only
            // thin branch structure, rather than outward toward the rim where the big leaf
            // tiles sit. So a right-half label (ox > 0) is mirrored to point left (is-flip)
            // and a left-half label points right — both away from their own tiles.
            const flip = radial && (n.ox ?? 0) > 0;
            if (!groupSet.has(n.id)) {
              // The root shared ancestor gets a clade label (nearest named one);
              // every other unnamed split stays a bare junction dot.
              if (n.id === rootId && rootAnnoId) {
                const anc = tree.byId.get(rootAnnoId);
                return (
                  <button key={n.id} type="button" className={`clado-pt is-clade is-ancestor${flip ? " is-flip" : ""}`} style={{ left: n.x, top: n.y }} onClick={() => setWikiId(rootAnnoId)}>
                    <span className="pt-dot" />
                    <span className="pt-name">{cladeLabel(rootAnnoId)}</span>
                    {!hideRank && <span className="pt-rank">{anc?.rank}</span>}
                  </button>
                );
              }
              return (
                <div key={n.id} className="clado-pt is-junction" style={{ left: n.x, top: n.y }}>
                  <span className="pt-dot" />
                </div>
              );
            }
            const node = tree.byId.get(n.id);
            return (
              <button key={n.id} type="button" className={`clado-pt is-clade${flip ? " is-flip" : ""}`} style={{ left: n.x, top: n.y }} onClick={() => setWikiId(n.id)}>
                <span className="pt-dot" />
                <span className="pt-name">{cladeLabel(n.id)}</span>
                {!hideRank && <span className="pt-rank">{node?.rank}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {!over && (
        <div className="branches-dock">
          <div className={`branches-budget${g.oneAway ? " is-lastchance" : ""}`} aria-label={`${g.allowance + 1 - g.mistakes} mistakes left`}>
            <span className="branches-budget-lbl">Mistakes left</span>
            <span className="branches-dots">
              {Array.from({ length: g.allowance + 1 }, (_, i) => {
                const used = i < g.mistakes;
                const danger = !used && g.oneAway; // the final remaining pip
                return (
                  <span
                    key={i}
                    className={`branches-dot${used ? " is-used" : ""}${danger ? " is-danger" : ""}`}
                    aria-hidden="true"
                  />
                );
              })}
            </span>
            {g.oneAway ? (
              <span className="branches-budget-warn">One mistake away: a wrong board ends it</span>
            ) : (
              <span className="branches-budget-hint">Submit to check: a wrong board costs one.</span>
            )}
          </div>
          <div className="branches-tray-cap">
            {g.tray.length === 0 ? "All placed" : `Species to place · ${g.tray.length} left`}
          </div>
          <div
            className={`branches-tray${trayOver ? " is-over" : ""}${g.tray.length === 0 ? " is-empty" : ""}`}
            aria-label="Species to place"
            onDragOver={(e) => { e.preventDefault(); setTrayOver(true); }}
            onDragLeave={() => setTrayOver(false)}
            onDrop={(e) => { e.preventDefault(); setTrayOver(false); const d = readDrag(e); if (d?.from === "slot" && d.slotId) g.clearSlot(d.slotId); }}
          >
            {g.tray.length === 0 ? (
              <span className="branches-tray-empty">Drag a tile back here to change a placement.</span>
            ) : (
              g.tray.map((id) => (
                <span key={id} className="branches-chip-wrap">
                  <button
                    className={`branches-chip${g.held === id ? " is-held" : ""}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ from: "tray", speciesId: id }))}
                    onClick={() => g.hold(id)}
                    // Same giveaway as a placed tile, and this is the commoner hover:
                    // the tray is only rendered while the board is live, so the
                    // scientific name never belongs here.
                    title="Drag onto a clade, or tap to pick it up"
                  >
                    <span
                      className={`branches-chip-thumb${trayImgs[id] ? " is-clickable" : ""}`}
                      role={trayImgs[id] ? "button" : undefined}
                      tabIndex={trayImgs[id] ? 0 : undefined}
                      title={trayImgs[id] ? "View picture" : undefined}
                      onClick={(e) => { if (trayImgs[id]) { e.stopPropagation(); setZoomId(id); } }}
                      onKeyDown={(e) => { if (trayImgs[id] && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); setZoomId(id); } }}
                    >
                      {trayImgs[id] && <img src={trayImgs[id].thumb} alt="" />}
                    </span>
                    <span className="branches-chip-name">{nameOf(tree, id)}</span>
                  </button>
                  <button
                    className="branches-chip-info"
                    title={willCost(id) ? `Wikipedia (costs up to ${lookupCost} pts)` : "Wikipedia"}
                    onClick={(e) => { e.stopPropagation(); askWiki(id); }}
                  >
                    ⓘ
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="branches-actions">
            <button
              className="linkbtn"
              title={hintSpent ? "You've used this board's hint" : `Reveal one species (costs up to ${hintCost} pts)`}
              onClick={() => setPendingHint(true)}
              disabled={hintSpent || board.slotIds.every((s) => g.placements[s] === s)}
            >
              {hintSpent ? "Hint used" : "Hint: reveal one"}
            </button>
            <button className="branches-submit" onClick={g.submit} disabled={!g.canSubmit}>
              Submit
            </button>
          </div>

          {/* The hint warning sits right under the button that opened it — the peek
              confirm can afford to live at the page foot because a lookup starts from
              a tile anywhere on the board, but this one has a fixed origin. */}
          {pendingHint && (
            <div className="branches-confirm" role="alertdialog" aria-label="Confirm hint">
              <p>
                Reveal one species? It locks a slot in correct, but a hinted slot scores nothing,
                so it forfeits that whole slot: <b>up to {hintCost} points</b>. This is the board's
                only hint.
              </p>
              <div className="branches-confirm-actions">
                <button className="linkbtn" onClick={() => setPendingHint(false)}>Cancel</button>
                <button className="branches-submit" onClick={confirmHint}>Reveal one (−{hintCost} pts)</button>
              </div>
            </div>
          )}
        </div>
      )}

      {over && g.result && (
        <div className={`branches-result${won ? " is-won" : " is-lost"}`}>
          <div className="branches-score">
            <b>{won ? "Solved 😎" : "Missed it"}</b>
            <span className="branches-score-detail"> · {g.result.correct}/{g.result.total} placed
              {[
                g.result.mistakes && `${g.result.mistakes} mistake${g.result.mistakes > 1 ? "s" : ""}`,
                g.result.hinted && `${g.result.hinted} hint${g.result.hinted > 1 ? "s" : ""}`,
                g.result.peeked && `${g.result.peeked} peek${g.result.peeked > 1 ? "s" : ""}`,
              ].filter(Boolean).map((t) => <span key={t as string}> · {t}</span>)}
            </span>
          </div>
          <div className="branches-points">{points} points</div>
          {won && g.result.mistakes > 0 && g.result.mistakes === g.allowance && (
            <p className="branches-result-note">Right at the limit, one more would have ended it! A close call one could say. 🦫 </p>
          )}
          {!won && (
            <p className="branches-result-note">Over the {g.allowance}-mistake limit for today. You keep the slots you locked, at 35% credit; each unsolved slot shows its species.</p>
          )}
          <div className="share">
            <div className="share-head">🌿 Grebe Branches <span>· №{dailyNumber(g.date)}{rules.difficulty ? ` · ${rules.difficulty}` : ""}</span></div>
            <div className="share-grid" aria-label={`placements: ${shareRows.join(", ")}`}>
              {shareRows.map((row, i) => <div key={i}>{row}</div>)}
            </div>
            <div className="share-verdict">
              {won ? "Solved 😎" : "Missed it"} · {g.result.correct}/{g.result.total} placed
              {g.result.mistakes > 0 && <> · {g.result.mistakes} mistake{g.result.mistakes > 1 ? "s" : ""}</>}
              <span className="share-score"> · {points} pts</span>
              {won && streak != null && streak > 0 && <span className="share-streak"> · 🔥{streak}</span>}
            </div>
            <button className="share-btn" onClick={copyShare}>{copied ? "Copied ✓" : "Copy result"}</button>
          </div>
          {g.locked && <p className="daily-lock">✓ You’ve played today’s Branches. Come back tomorrow for a new board. Fun will be had.</p>}
        </div>
      )}

      {over && <LeaderboardNudge show={!!configured && !me} />}

      {over && configured && (
        <Leaderboard
          game="branches" label="Branches" variant="today" me={me ?? null} reloadKey={reloadKey} streak={streak}
          note="Score rewards harder days and correct placements. Hints and peeks trim it."
        />
      )}

      {/* Same reusable board as Lineage and Kinship, different key. Not gated on
          `over` so an unfinished board can still show the one-line nudge. */}
      <DiscussionPanel
        board="branches"
        date={todayKey()}
        configured={!!configured}
        signedIn={!!userId}
        played={over}
        label="today’s Branches"
      />

      {peekNode && (
        <div className="branches-confirm" role="alertdialog" aria-label="Confirm lookup">
          <p>
            Look up <b>{peekNode.common ?? peekNode.sciName}</b>? Its Wikipedia usually names the family,
            which points to the answer, so it forfeits half that slot: <b>up to {lookupCost} points</b>.
          </p>
          <div className="branches-confirm-actions">
            <button className="linkbtn" onClick={() => setPendingPeek(null)}>Cancel</button>
            <button className="branches-submit" onClick={confirmPeek}>Look it up (−{lookupCost} pts)</button>
          </div>
        </div>
      )}

      {zoomId && trayImgs[zoomId] && (
        <div className="branches-zoom" role="dialog" aria-label={`${nameOf(tree, zoomId)} picture`} onClick={() => setZoomId(null)}>
          <img src={trayImgs[zoomId].full} alt={nameOf(tree, zoomId)} />
          <span className="branches-zoom-cap">{nameOf(tree, zoomId)} · tap to close</span>
        </div>
      )}

      {wikiNode && (
        <div ref={wikiRef}>
          <WikiCard
            node={wikiNode}
            tree={tree}
            onClose={closeWiki}
            hideImage={(tree.childrenOf.get(wikiNode.id) ?? []).length > 0}
            redact={hiddenNames}
            // Clades follow their board label: a common name that gives a tile away
            // is not shown on the tree, so it can't be shown on the card either.
            latinTitle={(tree.childrenOf.get(wikiNode.id) ?? []).length > 0 && (cladeLatinOnly || cladeTells(wikiNode.id))}
            // Only intercepted while it would cost: otherwise it stays a plain link.
            onFollowLink={readCosts(wikiNode.id) ? (url) => setPendingRead({ id: wikiNode.id, url }) : undefined}
            linkNote={readCosts(wikiNode.id) ? `(up to ${lookupCost} pts)` : undefined}
          />
        </div>
      )}

      {pendingRead && (
        <div ref={readConfirmRef} className="branches-confirm" role="alertdialog" aria-label="Confirm full article">
          <p>
            Open the full Wikipedia article? The card above blanks out the species you still have
            to place, the article itself doesn’t, so it forfeits half a slot:{" "}
            <b>up to {lookupCost} points</b>.
          </p>
          <div className="branches-confirm-actions">
            <button className="linkbtn" onClick={() => setPendingRead(null)}>Cancel</button>
            <button className="branches-submit" onClick={confirmRead}>Open article (−{lookupCost} pts)</button>
          </div>
        </div>
      )}
    </div>
  );
}
