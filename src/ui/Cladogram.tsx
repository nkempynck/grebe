import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DisplayTreeNode, GuessResult, TaxonNode, Tree } from "../core";
import { ancestryChain, inducedSubtree, isAncestor } from "../core";
import { WikiCard } from "./WikiCard";
import { warmthColor } from "./temperature";
import { treeLayout, radialLayout, naturalLayout, CLADO_TREE, CLADO_RADIAL, CLADO_NATURAL } from "./cladoLayout";

type CladoView = "tree" | "radial" | "natural";

/** Natural view only. Zoom scales the drawing while labels scale themselves back, so text
 *  holds its size on screen: flying in spreads the branches without growing the names, and
 *  the ones that couldn't fit before appear. That is the whole mechanism by which a coiled
 *  tree stays readable. */
const ZOOM_MIN = 0.25;
// Generous, because labels hold their size on screen: flying right in is how you read a
// tuft of ruled-out guesses that is deliberately drawn small.
const ZOOM_MAX = 10;
const ZOOM_STEP = 1.15;
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
/** How many steps around the hidden species count as "where the game is". Three reaches
 *  the closest shared clade, the guesses hanging off it, and one branch point above. */
const FOCUS_RADIUS = 3;
/** Slack around the focus box when fitting it, leaving room for the labels on its edge. */
const FIT_MARGIN = 1.45;
/** Where down the stage the live end is framed. Above centre on purpose: the page grows
 *  above the tree as you play, so the top of the stage is the part that stays on screen. */
const FOCAL_Y = 0.4;
/** Ceiling on the AUTOMATIC fit. The manual controls still reach ZOOM_MAX. */
const FIT_ZOOM_MAX = 1.25;

interface Props {
  tree: Tree;
  scopeRootId: string;
  results: GuessResult[];
  answerId: string;
  /** Clades revealed via hints (on the answer's lineage). */
  hintIds: string[];
  /** When true, the answer is named and its full lineage is drawn. */
  revealed: boolean;
}

const TARGET = "__target__";

type Kind = "clade" | "guess" | "answer" | "target" | "collapsed";

interface DNode {
  id: string;
  kind: Kind;
  children: DNode[];
  /** For a collapsed run: how many unnamed splits it stands in for. */
  count?: number;
  /** For a junction inside an expanded run: the run's id (click to re-collapse). */
  runId?: string;
}

interface PNode extends DNode {
  x: number;
  y: number;
  isLeaf: boolean;
  /** Outward x component, when the layout supplies one. Natural mode uses its sign to
   *  mirror a label away from the tree, the way Branches already does on its radial fan. */
  ox?: number;
  warmth?: number;
  isWin?: boolean;
}

export function Cladogram({ tree, scopeRootId, results, answerId, hintIds, revealed }: Props) {
  // Runs of unnamed splits the player has chosen to expand back into dots.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleRun = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const [mode, setMode] = useState<CladoView>("tree");
  const model = useMemo(
    () => buildModel(tree, scopeRootId, results, answerId, hintIds, revealed, expanded, mode),
    [tree, scopeRootId, results, answerId, hintIds, revealed, expanded, mode]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId && selectedId !== TARGET ? tree.byId.get(selectedId) ?? null : null;
  const stageRef = useRef<HTMLDivElement>(null);

  /** The natural view's camera: screen = canvas × k + (tx, ty).
   *
   *  Deliberately NOT the stage's own scrollLeft/scrollTop, which is what tree and radial
   *  use. A scroll container is owned by the browser: when the canvas resizes — and every
   *  guess resizes it, because a guess changes the species counts every length and angle is
   *  derived from — the browser clamps the scroll offset to the new size before any of our
   *  code runs, and a correction applied afterwards is already working from a position that
   *  was silently thrown away. That is the lurch. A transform has no such owner: nothing
   *  clamps it, nothing resets it, and holding a landmark still across a re-layout is one
   *  subtraction. */
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const natural = mode === "natural";
  const zoomed = natural ? view.k : 1;

  // Put a canvas point in the middle of the viewport.
  const centerOn = useCallback((x: number, y: number, behavior: ScrollBehavior = "smooth") => {
    const stage = stageRef.current;
    if (!stage) return;
    if (natural) {
      setView((v) => ({ ...v, tx: stage.clientWidth / 2 - x * v.k, ty: stage.clientHeight * FOCAL_Y - y * v.k }));
      return;
    }
    stage.scrollTo({ left: x - stage.clientWidth / 2, top: y - stage.clientHeight / 2, behavior });
  }, [natural]);

  /** Change the zoom, keeping one point of the drawing pinned under one point of the
   *  viewport. Given a client position that's the cursor, which is what makes wheel zoom
   *  feel like a map: whatever you point at is what you fly into. Given nothing it's the
   *  viewport centre, which is what the ± buttons want. */
  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    setView((v) => {
      const k = clampZoom(v.k * factor);
      if (k === v.k) return v;
      // Anchor, in viewport pixels from the stage's top-left.
      const px = clientX == null ? stage.clientWidth / 2 : clientX - rect.left;
      const py = clientY == null ? stage.clientHeight / 2 : clientY - rect.top;
      // Keep whatever canvas point is under that pixel under it afterwards.
      const cx = (px - v.tx) / v.k;
      const cy = (py - v.ty) / v.k;
      return { k, tx: px - cx * k, ty: py - cy * k };
    });
  }, []);

  /** Hold the hidden species still across a re-layout.
   *
   *  Every guess changes the species counts a branch carries, and length, width and heading
   *  all derive from those, so one guess moves EVERY node on the canvas. Holding the camera
   *  still then holds the wrong thing: the view stays put while the drawing slides out from
   *  under it. Anchoring on the hidden species instead means it stays exactly where it was
   *  on screen and the tree grows around it. */
  const lastFocal = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const f = model?.nodes.find((n) => n.kind === "target" || n.kind === "answer");
    if (!natural || !f) {
      lastFocal.current = null;
      return;
    }
    const prev = lastFocal.current;
    lastFocal.current = { x: f.x, y: f.y };
    // No previous position means this is the first paint in this view, which the fit
    // effect frames deliberately; it clears `lastFocal`, so a fit is never corrected away.
    if (!prev || (prev.x === f.x && prev.y === f.y)) return;
    setView((v) => ({ ...v, tx: v.tx - (f.x - prev.x) * v.k, ty: v.ty - (f.y - prev.y) * v.k }));
  }, [model, natural]);

  // Holding the camera steady isn't enough on its own, because the PAGE moves too: a guess
  // adds a caption line, a hint row and another result, all above the tree, and the focused
  // input keeps itself in view, so the stage slides and its lower half — where the live end
  // of the spiral is — ends up below the fold. `nearest` does nothing when the stage is
  // already fully visible and makes the smallest correction when it isn't.
  useEffect(() => {
    if (!natural || results.length === 0) return;
    stageRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [natural, results.length]);

  // Drag the background to pan. Only from the background: a pointerdown that landed on a
  // node is that node's click to handle, so panning can never steal it.
  const [panning, setPanning] = useState(false);
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!natural || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".clado-pt")) return;
    const stage = stageRef.current;
    if (!stage) return;
    pan.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty };
    stage.setPointerCapture(e.pointerId);
    setPanning(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p) return;
    setView((v) => ({ ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const stage = stageRef.current;
    if (pan.current && stage?.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    pan.current = null;
    setPanning(false);
  };

  // Wheel zoom, the way a map does it: a plain wheel zooms about the cursor rather than
  // scrolling the stage, and pinch (which arrives as ctrl+wheel) does the same. Panning is
  // by drag instead, which is the other half of the same convention.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || mode !== "natural") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Continuous rather than stepped, so a trackpad glides instead of clunking. Pinch
      // gestures send small deltas and a mouse wheel sends large ones; the exponential
      // keeps both proportional, and the clamp stops one violent notch flinging the view.
      const scale = e.ctrlKey ? 0.01 : 0.0022;
      const factor = Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * scale);
      zoomAt(factor, e.clientX, e.clientY);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [mode, zoomAt]);

  // Leaving natural mode resets the camera, so coming back starts from a framed whole tree
  // rather than wherever you happened to stop flying.
  useEffect(() => {
    if (!natural) setView({ k: 1, tx: 0, ty: 0 });
  }, [natural]);

  /** Which nodes get to show their name in the natural view, or null when every label is
   *  drawn (tree and radial are laid out so labels fit by construction).
   *
   *  This is how OneZoom handles a crowded tree, and the only reason it works is that
   *  labels keep a constant size ON SCREEN while the drawing scales: flying in spreads the
   *  branches apart without making the text bigger, so more names fit and they appear as
   *  you go. Zoomed out you read the shape; zoomed in you read the names. Priority decides
   *  who wins a collision, and what the player needs most wins: the answer, the hidden
   *  species, the closest shared branch, then guesses (warmest first), then clade labels. */
  /** Label priority: lower wins the space. Read by the measured cull below, via `data-pri`.
   *  The hidden species and the answer come first, then the closest shared branch, then
   *  guesses — warmest first, and among equals the most recent — then clade labels. */
  const labelPriority = useCallback(
    (p: PNode) => {
      if (p.kind === "answer") return 0;
      if (p.kind === "target") return 1;
      if (p.id === model?.closestId) return 2;
      if (p.kind === "guess") {
        const i = results.findIndex((r) => r.guess.id === p.id);
        return 10 + (1 - (p.warmth ?? 0)) * 100 + (i < 0 ? 99 : i) / 1000;
      }
      return 1e6;
    },
    [model?.closestId, results]
  );


  /** Hide labels that would overlap, measured rather than estimated.
   *
   *  This started as a calculation — box the label at 150 wide by a guessed height and test
   *  those boxes. It was wrong twice, because a label's real height depends on where its name
   *  wraps inside 150px, and labels that visibly overlapped kept passing a test run on boxes
   *  that didn't. The browser already knows every one of those rectangles exactly, so ask it.
   *
   *  Everything renders labelled; this pass then reads the real rectangles in priority order,
   *  keeps the ones that don't collide with a survivor, and hides the rest. Zoomed out only a
   *  few names survive; flying in shrinks the drawing's crowding around labels that hold
   *  their size on screen, so more of them come back. */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const els = [...stage.querySelectorAll<HTMLElement>(".clado-pt[data-pri]")];
    // Start from a clean slate so the measurement sees full-width labels, not collapsed ones.
    for (const el of els) el.classList.remove("is-nolabel");
    if (!natural) return;
    const measured = els
      .map((el) => ({ el, pri: Number(el.dataset.pri ?? 1e6), r: el.getBoundingClientRect() }))
      .sort((a, b) => a.pri - b.pri);
    const kept: DOMRect[] = [];
    for (const m of measured) {
      const hit = kept.some(
        (k) => m.r.left < k.right && k.left < m.r.right && m.r.top < k.bottom && k.top < m.r.bottom
      );
      if (hit) m.el.classList.add("is-nolabel");
      else kept.push(m.r);
    }
  }, [model, natural, view]);

  // The hidden species while playing, or the answer once revealed.
  const focal = model?.nodes.find((n) => n.kind === "target" || n.kind === "answer");
  const focalX = focal?.x;
  const focalY = focal?.y;

  /** Zoom and scroll so the live end of the spiral fills the viewport.
   *
   *  The spiral puts the root's deep clades on the outermost, longest sweep and the part
   *  you are actually playing in the tight middle, so showing the whole canvas shows mostly
   *  Metazoa and Bilateria at full size and the hidden species as a speck. Fitting to the
   *  focus neighbourhood inverts that. */
  const fitToFocus = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !model) return false;
    const wanted = new Set(model.focusIds);
    const pts = model.nodes.filter((n) => wanted.has(n.id));
    if (pts.length === 0) return false;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const bw = Math.max(1, Math.max(...xs) - Math.min(...xs)) * FIT_MARGIN;
    const bh = Math.max(1, Math.max(...ys) - Math.min(...ys)) * FIT_MARGIN;
    // Capped well below ZOOM_MAX. Deep generations are small by construction, so a focus
    // box a few branches wide would otherwise fit at maximum magnification and drop you
    // into a wall of trunk with no context around it. Flying closer is the player's call.
    const k = Math.min(FIT_ZOOM_MAX, clampZoom(Math.min(stage.clientWidth / bw, stage.clientHeight / bh)));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // One atomic camera change: scale and position land together, so there is no frame in
    // which the drawing is scaled but not yet placed.
    setView({ k, tx: stage.clientWidth / 2 - cx * k, ty: stage.clientHeight * FOCAL_Y - cy * k });
    // A deliberate framing; don't let the landmark correction undo it on the same commit.
    lastFocal.current = null;
    return true;
  }, [model]);

  const centerOnHidden = useCallback(() => {
    if (mode === "natural" && fitToFocus()) return;
    if (focalX != null && focalY != null) centerOn(focalX, focalY);
  }, [mode, fitToFocus, focalX, focalY, centerOn]);

  // Re-frame on a view switch and on the reveal, and then leave the view alone. Re-fitting
  // on every guess throws the whole drawing about and overrides wherever the player has
  // flown to, which is worse than the crowding it was meant to relieve. A landing guess
  // gets a nudge instead, below, and only if it landed off screen.
  useEffect(() => {
    if (mode === "natural") { fitToFocus(); return; }
    if (focalX != null && focalY != null) centerOn(focalX, focalY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, revealed]);

  // When a NEW guess lands, pan to where it slotted in, so you see the result of
  // the guess rather than being yanked back to the hidden species. The "Center on
  // hidden" button brings you back.
  const prevCount = useRef(results.length);
  const latestGuessId = results[0]?.guess.id ?? null;
  useEffect(() => {
    if (results.length > prevCount.current && latestGuessId && model) {
      // Natural mode holds the hidden species still instead (see the layout effect above),
      // so a new guess appears in place and the view never jumps. "Center on hidden" is
      // there for getting back if you have flown somewhere else.
      const g = mode === "natural" ? null : model.nodes.find((n) => n.id === latestGuessId);
      if (g) centerOn(g.x, g.y);
    }
    prevCount.current = results.length;
    // model read via closure; we only want to react to a guess landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.length, latestGuessId, centerOn]);

  if (!model) return null;
  const { nodes, links, width, height, closestName } = model;

  return (
    <figure className="clado">
      <figcaption className="clado-cap">
        {revealed
          ? "The answer's place on the tree of life. Each guess sits where it splits away from the answer's branch."
          : closestName
          ? <>Closest shared branch so far: <b>{closestName}</b>. Every guess hangs where it splits from the hidden species.</>
          : "Each guess hangs at the clade it shares with the hidden species. Guess to grow the tree downward."}
      </figcaption>

      {/* Lineage only, and deliberately not in About's shared sources block: Kinship, Branches
          and Mosaic are played without outside lookups, and Branches goes as far as blanking
          clade members out of its cards and charging for the unedited article. A general note
          about browsing the tree alongside Grebe would undercut that. This component only
          renders in Lineage, so the note is scoped by where it lives. */}
      <p className="clado-note">
        An extra fun and educational source for playing Lineage:{" "}
        <a href="https://www.onezoom.org" target="_blank" rel="noreferrer">OneZoom</a>. If you think this is a bit too overpowered and
        takes the fun out of Lineage, leave it as feedback. But it's a great website that gave me more Lineage joy than Wikipedia lookups.
      </p>

      <div className="clado-toolbar">
        <div className="branches-viewtoggle" role="tablist" aria-label="Tree view">
          <button role="tab" aria-selected={mode === "tree"} className={`branches-viewseg${mode === "tree" ? " is-on" : ""}`} onClick={() => setMode("tree")}>Tree</button>
          <button role="tab" aria-selected={mode === "radial"} className={`branches-viewseg${mode === "radial" ? " is-on" : ""}`} onClick={() => setMode("radial")}>Radial</button>
          <button role="tab" aria-selected={mode === "natural"} className={`branches-viewseg${mode === "natural" ? " is-on" : ""}`} onClick={() => setMode("natural")}>Natural</button>
        </div>
        <div className="clado-tools">
          {/* Zoom belongs to the natural view alone: tree and radial are laid out to fit the
              column, so there is nothing there to fly into. */}
          {mode === "natural" && (
            <div className="clado-zoombar" role="group" aria-label="Zoom">
              <button type="button" onClick={() => zoomAt(1 / ZOOM_STEP)} disabled={view.k <= ZOOM_MIN} title="Zoom out">−</button>
              <span className="clado-zoomval">{Math.round(view.k * 100)}%</span>
              <button type="button" onClick={() => zoomAt(ZOOM_STEP)} disabled={view.k >= ZOOM_MAX} title="Zoom in">+</button>
            </div>
          )}
          <button
            type="button"
            className="clado-center"
            onClick={centerOnHidden}
            disabled={focalX == null}
            title={`Scroll to the ${revealed ? "answer" : "hidden species"}`}
          >
            ◎ Center on {revealed ? "answer" : "hidden"}
          </button>
        </div>
      </div>

      <div
        className={`clado-stage${natural ? " is-viewport is-pannable" : ""}${panning ? " is-panning" : ""}`}
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* The canvas carries the SCALED size, so the stage scrolls the right distance; the
            wrapper inside it keeps the layout's own unscaled coordinate space, which is what
            every node position, centerOn and the layout maths are expressed in. */}
        {/* Tree and radial size the canvas and let the stage scroll it. The natural view
            doesn't size anything: its camera is the transform below, so nothing the browser
            owns can clamp or reset the framing when a guess changes the drawing. */}
        <div className="clado-canvas" style={natural ? undefined : { width, height }}>
          <div
            className={`clado-zoomwrap${natural ? " is-natural" : ""}`}
            style={{
              width,
              height,
              transform: natural ? `translate(${view.tx}px, ${view.ty}px) scale(${view.k})` : undefined,
              // Inherited by every label, which scales itself back by this so its size on
              // screen stays put while the branches spread apart.
              ["--cz" as string]: 1 / zoomed,
            }}
          >
          <svg className="clado-links" width={width} height={height} aria-hidden="true">
            {links.map((l, i) => (
              // A natural-view stem arrives as a closed tapered outline to FILL; the other
              // two views send a centreline to stroke.
              <path
                key={i}
                d={l.d}
                className={`clado-link${l.strong ? " is-strong" : ""}${l.filled ? " is-stem" : ""}`}
                style={l.filled ? { fill: l.color } : { stroke: l.color }}
              />
            ))}
          </svg>

          {nodes.map((p) => {
            const flipLabel = natural && (p.ox ?? 0) < 0;
            if (p.kind === "target") {
              return (
                <div key={p.id} className="clado-pt is-target" data-pri={labelPriority(p)} style={{ left: p.x, top: p.y }}>
                  <span className="pt-mark">?</span>
                  <span className="pt-name">hidden species</span>
                </div>
              );
            }
            // A collapsed run of unnamed splits — one compact marker, click to expand.
            if (p.kind === "collapsed") {
              return (
                <button
                  key={p.id}
                  type="button"
                  className="clado-pt is-collapsed"
                  style={{ left: p.x, top: p.y }}
                  title={`${p.count} unnamed splits, click to expand`}
                  onClick={() => toggleRun(p.id)}
                >
                  <span className="pt-dot" />
                  <span className="pt-collapsed">⋯ {p.count} splits</span>
                </button>
              );
            }
            const t = tree.byId.get(p.id)!;
            // Unnamed phylogenetic junction — draw a bare dot, no label, no wiki.
            // If it belongs to an expanded run, clicking re-collapses that run.
            if (p.kind === "clade" && !t.sciName) {
              const cls = `clado-pt is-junction${p.id === model.closestId ? " is-closest" : ""}${p.runId ? " is-expanded" : ""}`;
              if (p.runId) {
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cls}
                    style={{ left: p.x, top: p.y }}
                    title="Collapse these splits"
                    onClick={() => toggleRun(p.runId!)}
                  >
                    <span className="pt-dot" />
                  </button>
                );
              }
              return (
                <div key={p.id} className={cls} style={{ left: p.x, top: p.y }}>
                  <span className="pt-dot" />
                </div>
              );
            }
            const color =
              p.kind === "answer" ? "var(--vermilion)" : p.kind === "guess" ? warmthColor(p.warmth ?? 0, !!p.isWin) : undefined;
            // Grafted out-of-set organisms (and the clades added with them) are
            // drawn dashed and flagged, so it's clear they aren't playable answers.
            const oos = !!t.virtual;
            const cls = [
              "clado-pt",
              p.kind === "clade" ? "is-clade" : p.kind === "answer" ? "is-answer" : "is-guess",
              oos ? "is-oos" : "",
              p.id === model.closestId ? "is-closest" : "",
              selectedId === p.id ? "is-selected" : "",
              // Natural view: branches leave in every direction, so a label that always ran
              // rightward would lie back across its own tree. Mirror the ones on branches
              // heading left — and any the collision pass moved to its other side.
              flipLabel ? "is-flip" : "",
            ].join(" ");
            // Species show common name over scientific name; clades show name over rank.
            const isSpecies = p.kind === "guess" || p.kind === "answer";
            const line1 = isSpecies ? t.common ?? t.sciName : t.sciName;
            const line2 = isSpecies ? (t.common ? t.sciName : t.rank) : t.rank;
            return (
              <button
                key={p.id}
                type="button"
                className={cls}
                data-pri={labelPriority(p)}
                style={{ left: p.x, top: p.y }}
                onClick={() => setSelectedId((cur) => (cur === p.id ? null : p.id))}
              >
                <span className="pt-dot" style={color ? { background: color, borderColor: color } : undefined} />
                <span className="pt-name" style={color ? { color } : undefined}>
                  {line1}
                  {isSpecies && (
                    <span className="pt-warm" style={color ? { color } : undefined}>
                      {p.kind === "answer" ? " · answer" : p.isWin ? " · found" : ` · ${Math.round((p.warmth ?? 0) * 100)}°`}
                      {oos && " · not in set"}
                    </span>
                  )}
                </span>
                <span className={`pt-rank${isSpecies && t.common ? " is-sci" : ""}`}>{line2}</span>
              </button>
            );
          })}
          </div>
        </div>
      </div>

      <WikiPanel node={selected} tree={tree} onClose={() => setSelectedId(null)} />
    </figure>
  );
}

function WikiPanel({ node, tree, onClose }: { node: TaxonNode | null; tree: Tree; onClose: () => void }) {
  // Already sits directly under the tree, but a tall cladogram can push it off the bottom,
  // so bring it into view like Kinship and Branches do. `nearest` means no movement at all
  // when it is already on screen, so moving from one clade to the next stays still.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (node) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [node?.id]);
  if (!node) {
    return <p className="clado-hint">Tap any clade or guess above to read about it.</p>;
  }
  // Shares the games' reader, so Lineage species get the same photo-preferring
  // image (a real photo instead of a range map / drawing where possible).
  return (
    <div ref={ref}>
      <WikiCard node={node} tree={tree} onClose={onClose} />
    </div>
  );
}

interface Model {
  nodes: PNode[];
  /** The live end of the spiral plus its immediate surroundings: what the natural view
   *  zooms itself to. Everything nearer the root is settled history. */
  focusIds: string[];
  links: { d: string; color: string; strong: boolean; filled?: boolean }[];
  width: number;
  height: number;
  closestId: string | null;
  closestName: string | null;
}

function buildModel(
  tree: Tree,
  scopeRootId: string,
  results: GuessResult[],
  answerId: string,
  hintIds: string[],
  revealed: boolean,
  expanded: Set<string>,
  mode: CladoView
): Model | null {
  if (results.length === 0 && hintIds.length === 0 && !revealed) return null;

  const byGuess = new Map(results.map((r) => [r.guess.id, r]));
  const depthOf = (id: string) => tree.depthOf.get(id) ?? 0;

  // Keep the guesses, the clades they each share with the answer, any hint-revealed
  // branches, and — on reveal — the answer plus its full lineage. inducedSubtree then
  // stitches in EVERY branch point among them, so we learn how the guesses relate to
  // each other (Amniotes, Tetrapods…) even when that says nothing about the answer.
  const keep = new Set<string>();
  keep.add(scopeRootId); // always anchor the drawing at the scope you're playing
  for (const r of results) {
    if (r.guess.id !== answerId) keep.add(r.guess.id);
    keep.add(r.mrca.id);
  }
  for (const h of hintIds) keep.add(h);
  if (revealed) {
    const chain = ancestryChain(tree, answerId).reverse();
    const start = chain.indexOf(scopeRootId);
    for (const id of chain.slice(start === -1 ? 0 : start)) keep.add(id);
  }

  // Annotate a named clade only when it's meaningful:
  //  • it's on the SHARED spine (the answer's own lineage — "you've narrowed to X"), or
  //  • it groups ≥2 guesses AND is the SHALLOWEST named clade to group that exact set
  //    (below where they split from the answer). So Buzzard+Eagle get labelled by
  //    their order; the redundant family only surfaces once a guess lands in the
  //    order but outside that family.
  const guessCount = new Map<string, number>();
  for (const r of results) {
    if (r.guess.id === answerId) continue;
    for (const anc of ancestryChain(tree, r.guess.id)) guessCount.set(anc, (guessCount.get(anc) ?? 0) + 1);
  }
  const onSpine = (id: string) => isAncestor(tree, id, answerId);
  // Guess-count of the nearest off-spine named ancestor (Infinity if none).
  const outerGroupCount = (id: string) => {
    for (let cur = tree.byId.get(id)?.parentId; cur; cur = tree.byId.get(cur)?.parentId ?? null) {
      if (tree.byId.get(cur)?.sciName && !onSpine(cur)) return guessCount.get(cur) ?? 0;
    }
    return Infinity;
  };
  const keepClade = (id: string) => {
    if (!tree.byId.get(id)?.sciName) return false;
    if (onSpine(id)) return true;
    const c = guessCount.get(id) ?? 0;
    // keep only if it groups ≥2 guesses and isn't redundant with a same-set outer clade
    return c >= 2 && outerGroupCount(id) > c;
  };
  const induced = inducedSubtree(tree, [...keep], keepClade);
  if (!induced) return null;

  // Squash redundant off-spine chains: if a kept named clade (Ecdysozoa) has a
  // single child that is itself the guesses' branch point (Pterygota, same guess
  // set), pull that split up so the group is labelled by the shallowest clade
  // (Ecdysozoa), not the deeper subclass. Never touch the answer's spine.
  const compress = (node: DisplayTreeNode): DisplayTreeNode => {
    node.children = node.children.map(compress);
    while (!onSpine(node.id) && node.children.length === 1 && node.children[0].children.length > 0) {
      node.children = node.children[0].children;
    }
    return node;
  };
  compress(induced);

  // Closest shared clade so far = deepest branch on the answer's lineage exposed by
  // a guess MRCA or a hint.
  let closestId: string | null = null;
  let closestDepth = -1;
  for (const id of [...results.map((r) => r.mrca.id), ...hintIds]) {
    const d = depthOf(id);
    if (d > closestDepth) { closestDepth = d; closestId = id; }
  }
  // The closest shared node may be a nameless junction — name the caption after
  // the nearest NAMED clade at or above it.
  let closestName: string | null = null;
  for (let id: string | null | undefined = closestId; id; id = tree.byId.get(id)?.parentId) {
    const n = tree.byId.get(id);
    if (n?.sciName) { closestName = n.common ?? n.sciName; break; }
  }

  // ---- assemble the display tree from the induced skeleton ----
  const kindOf = (id: string): Kind => {
    if (id === TARGET) return "target";
    if (id === answerId) return "answer";
    if (byGuess.has(id)) return "guess";
    return "clade";
  };
  const toDNode = (n: DisplayTreeNode): DNode => ({ id: n.id, kind: kindOf(n.id), children: n.children.map(toDNode) });
  const root = toDNode(induced);

  // While playing, hang the hidden species off the closest shared clade.
  if (!revealed && closestId) {
    const attach = (n: DNode): boolean => {
      if (n.id === closestId) { n.children.push({ id: TARGET, kind: "target", children: [] }); return true; }
      return n.children.some(attach);
    };
    attach(root);
  }

  // Collapse linear runs of ≥2 unnamed single-child junctions into one compact
  // marker — the deep stretches between named clades (e.g. order → genus) carry
  // no information, so hide the individual splits until the player expands them.
  // The closest shared branch (where the hidden species hangs) stays visible even
  // if it's nameless — never fold it into a run.
  const isJunction = (n: DNode) =>
    n.kind === "clade" && n.id !== closestId && !tree.byId.get(n.id)?.sciName;
  const collapse = (node: DNode): DNode => {
    const out: DNode[] = [];
    for (const child of node.children) {
      const run: DNode[] = [];
      let cur = child;
      while (isJunction(cur) && cur.children.length === 1) {
        run.push(cur);
        cur = cur.children[0];
      }
      const tail = collapse(cur); // recurse past the run
      if (run.length >= 2 && !expanded.has(run[0].id)) {
        out.push({ id: run[0].id, kind: "collapsed", count: run.length, children: [tail] });
      } else {
        // Keep the junctions (short run, or expanded): relink them above the tail,
        // tagging each with the run id so a click re-collapses the whole run.
        let acc = tail;
        for (let i = run.length - 1; i >= 0; i--) {
          run[i].children = [acc];
          if (run.length >= 2) run[i].runId = run[0].id;
          acc = run[i];
        }
        out.push(acc);
      }
    }
    node.children = out;
    return node;
  };
  collapse(root);

  // Branch colour + weight, keyed on the CHILD node's role (shared by both views).
  const linkColor = (kind: Kind, cr?: GuessResult) =>
    kind === "answer" ? "var(--vermilion)" : kind === "target" ? "var(--ink-faint)"
    : cr ? warmthColor(cr.warmth, cr.isWin) : "var(--clado-line)";

  // ---- lay the collapsed tree out via the shared engine, then colour it here ----
  // Radial rotates the hidden species (or, on reveal, the answer) to the bottom.
  const dById = new Map<string, DNode>();
  (function index(n: DNode) { dById.set(n.id, n); n.children.forEach(index); })(root);

  // The live path: root down to the hidden species, or to the answer once revealed. The
  // natural view spends its space on this branch and rolls the ruled-out ones up tight, so
  // it has to know which is which. The other two views don't care.
  const liveIds = new Set<string>();
  const goal = !revealed && dById.has(TARGET) ? TARGET : answerId;
  (function findPath(n: DNode, trail: string[]): boolean {
    const here = [...trail, n.id];
    if (n.id === goal) { here.forEach((id) => liveIds.add(id)); return true; }
    return n.children.some((c) => findPath(c, here));
  })(root, []);

  // The stretch of the spiral worth looking at: the goal plus everything within a few
  // steps of it. On a long spine the deep clades near the root (Metazoa, Bilateria,
  // Chordata) are most of the drawing and none of the information — they were settled
  // several guesses ago — so the view zooms itself to this instead of to the whole tree.
  const parentOf = new Map<string, string>();
  (function index(n: DNode) { n.children.forEach((c) => { parentOf.set(c.id, n.id); index(c); }); })(root);
  const focus = new Set<string>();
  if (dById.has(goal)) {
    focus.add(goal);
    let frontier = [goal];
    for (let step = 0; step < FOCUS_RADIUS && frontier.length; step++) {
      const next: string[] = [];
      for (const id of frontier) {
        const up = parentOf.get(id);
        const neighbours = [...(dById.get(id)?.children ?? []).map((c) => c.id), ...(up ? [up] : [])];
        for (const nb of neighbours) if (!focus.has(nb)) { focus.add(nb); next.push(nb); }
      }
      frontier = next;
    }
  }
  const geo =
    mode === "radial"
      ? radialLayout(root, { ...CLADO_RADIAL, focusId: revealed ? answerId : dById.has(TARGET) ? TARGET : null })
      : mode === "natural"
      ? naturalLayout(root, { ...CLADO_NATURAL, live: (id) => liveIds.has(id) })
      : treeLayout(root, CLADO_TREE);

  const nodes: PNode[] = geo.nodes.map((gn) => {
    const d = dById.get(gn.id)!;
    const r = byGuess.get(gn.id);
    return {
      ...d,
      x: gn.x,
      y: gn.y,
      isLeaf: gn.isLeaf,
      ox: gn.ox,
      warmth: r?.warmth,
      isWin: r?.isWin,
    };
  });
  const links: Model["links"] = geo.links.map((l) => {
    const c = dById.get(l.childId)!;
    return {
      d: l.d,
      filled: l.filled,
      color: linkColor(c.kind, byGuess.get(c.id)),
      strong: c.kind === "guess" || c.kind === "answer",
    };
  });

  return { nodes, focusIds: [...focus], links, width: geo.width, height: geo.height, closestId, closestName };
}
