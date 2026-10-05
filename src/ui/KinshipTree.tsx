import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DisplayTreeNode, GridBoard, Tree } from "../core";
import { inducedSubtree, displayRank } from "../core";
import { treeLayout, radialLayout, organicLayout, ribbonPath, CLADO_TREE, CLADO_RADIAL, type GraphLayout } from "./cladoLayout";
import { placeCladeLabels, nudgeLeafBoxes, resetCladeLabels } from "./cladoLabels";

interface Props {
  tree: Tree;
  board: GridBoard;
  /** Group level (0..3) for a species id → the game's colour (lvl-N / --gN). */
  levelOf: (id: string) => number;
  /** Open the Wikipedia reader for a node (species or clade). */
  onPick: (id: string) => void;
}

const nameOf = (tree: Tree, id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;

type View = "tree" | "radial" | "natural";

// How far a leaf chip floats out past its branch end in the radial and natural views.
const TIP_OUT = 14;
// The share of a ring an unnamed junction takes in the radial view, as in Branches.
const JUNCTION_STEP = 0.25;
// Natural view zoom, as in Lineage: the drawing scales, labels and chips hold their screen size
// (`--cz`), so zooming in spreads a crowded tree apart. Stems stop widening past STEM_ZOOM_CAP.
const ZOOM_MIN = 0.5, ZOOM_MAX = 6, ZOOM_STEP = 1.25, STEM_ZOOM_CAP = 2;
// Natural view: the radial fan turned to grow upward, drawn with curved tapered stems
// (organicLayout). Lineage's own natural layout lets siblings swing freely, and with a chip on
// every one of sixteen tips its branches crossed into each other; on the fan every subtree owns
// a wedge, so nothing crosses. Spacing chosen by measuring chip and label overlaps over random
// boards (2026-10-05); the zoom covers what the wider drawing costs.
const NATURAL_SPACING = { ring: 80, gapx: 220, spanMax: 3.4 };
const NATURAL_STEMS = { curl: 0.5, girth: 15, taper: 1.5, minGirth: 0.9 };
const countLeaves = (n: DisplayTreeNode): number =>
  n.children.length ? n.children.reduce((sum, c) => sum + countLeaves(c), 0) : 1;

/** Post-game phylogeny for a Kinship board: the sixteen species on the shared
 *  tree of life, each coloured by the group it belonged to, with the four group
 *  clades (and any other named shared ancestor) annotated and clickable for
 *  Wikipedia. Uses the shared layout engine: Tree, Radial (Branches' compact fan) and Natural
 *  (Lineage's growing tree, drawn whole since sixteen species need no camera). */
export function KinshipTree({ tree, board, levelOf, onPick }: Props) {
  const [view, setView] = useState<View>("tree");
  const radial = view === "radial";
  const natural = view === "natural";
  const [zoom, setZoom] = useState(1);
  const k = natural ? zoom : 1;
  useEffect(() => setZoom(1), [view, board]);
  // The natural drawing is wider than the column: open it centred rather than at its left edge.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage && natural) stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural, board]);
  const groupClades = useMemo(() => new Set(board.groups.map((g) => g.cladeId)), [board]);
  // Named clades ABOVE the groups are kept even where they do not branch, so the path from the
  // shared ancestor to each group reads Primates > Haplorhini > … > Hominidae instead of four
  // groups apparently on one level. Below a group only the branching nodes show, as before, and
  // stitched labels ("A & B", synthetic) are left out as clutter.
  const pathClades = useMemo(() => {
    const out = new Set<string>();
    for (const g of groupClades)
      for (let p = tree.byId.get(g)?.parentId; p; p = tree.byId.get(p)?.parentId) {
        const n = tree.byId.get(p);
        if ((n?.sciName || n?.common) && !n?.synthetic) out.add(p);
      }
    return out;
  }, [tree, groupClades]);
  const skeleton = useMemo<DisplayTreeNode | null>(
    () => inducedSubtree(tree, board.tiles, (id) => groupClades.has(id) || pathClades.has(id)),
    [tree, board.tiles, groupClades, pathClades]
  );
  const layout = useMemo<GraphLayout | null>(() => {
    if (!skeleton) return null;
    const named = (id: string) => { const n = tree.byId.get(id); return !!(n?.sciName || n?.common); };
    // Radial: Branches' compact fan. A bare junction takes a quarter ring, the root sits in the
    // middle, and the radius grows with the leaf count so chips keep their spacing.
    if (radial) {
      const k = Math.min(1.6, Math.max(1, countLeaves(skeleton) / 9));
      return radialLayout(skeleton, {
        ...CLADO_RADIAL, ring: 66 * k, innerRadius: 75 * k, spanMax: 5, gapx: 160,
        pad: 40, rim: 70, focusId: null,
        tipOut: TIP_OUT, leafBox: { halfW: 72, halfH: 16 }, labelW: 150, labelHalfH: 14,
        stepOf: (id, isLeaf) => (isLeaf || named(id) ? 1 : JUNCTION_STEP),
        rootAtCentre: true,
      });
    }
    if (natural) {
      const k = Math.min(1.6, Math.max(1, countLeaves(skeleton) / 9));
      return organicLayout(skeleton, {
        ...CLADO_RADIAL, ring: NATURAL_SPACING.ring * k, innerRadius: (NATURAL_SPACING.ring + 10) * k,
        spanMax: NATURAL_SPACING.spanMax, gapx: NATURAL_SPACING.gapx, pad: 40, rim: 70, focusId: null,
        tipOut: TIP_OUT, leafBox: { halfW: 60, halfH: 15 }, labelW: 120, labelHalfH: 14,
        stepOf: (id, isLeaf) => (isLeaf || named(id) ? 1 : JUNCTION_STEP),
        rootAtCentre: true,
      }, NATURAL_STEMS);
    }
    const L = treeLayout(skeleton, { ...CLADO_TREE, padx: 70 });
    return { ...L, height: L.height + 40 };
  }, [tree, skeleton, radial, natural]);

  // Radial and natural: clade labels find free spots, then leaf chips slide outward along their
  // branch until clear (shared with Branches). The tree view stacks cleanly.
  const canvasRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const chipEls = useRef<Map<string, HTMLElement>>(new Map());
  // Zoom about a point on screen (the cursor, or the middle of the stage for the buttons): the
  // drawing point under it stays put, by scrolling the stage once the new size has rendered.
  const anchor = useRef<{ cx: number; cy: number; ax: number; ay: number } | null>(null);
  const zoomTo = (next: number, clientX?: number, clientY?: number) => {
    const stage = stageRef.current;
    const nk = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next));
    if (!stage || nk === zoom) return;
    const r = stage.getBoundingClientRect();
    const ax = (clientX ?? r.left + r.width / 2) - r.left, ay = (clientY ?? r.top + r.height / 2) - r.top;
    anchor.current = { cx: (stage.scrollLeft + ax) / zoom, cy: (stage.scrollTop + ay) / zoom, ax, ay };
    setZoom(nk);
  };
  useLayoutEffect(() => {
    const stage = stageRef.current, a = anchor.current;
    if (!stage || !a) return;
    stage.scrollLeft = a.cx * zoom - a.ax;
    stage.scrollTop = a.cy * zoom - a.ay;
    anchor.current = null;
  }, [zoom]);
  // Pinch on a trackpad arrives as ctrl+wheel; plain wheel keeps scrolling the page. Bound by
  // hand because React's wheel listener is passive and cannot stop the browser's own zoom.
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !natural) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomRef.current(zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [natural, zoom]);
  const nodeById = useMemo(() => new Map((layout?.nodes ?? []).map((n) => [n.id, n])), [layout]);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    resetCladeLabels(canvas, chipEls.current.values());
    if (view === "tree") return;
    placeCladeLabels(canvas);
    nudgeLeafBoxes(canvas, chipEls.current, nodeById, natural ? 60 : 120, k);
  }, [layout, view, nodeById, k, natural]);

  if (!skeleton || !layout) return null;

  // Always label the first common ancestor (the skeleton's root). If that node is
  // an unnamed split, walk up to the nearest named clade so it still gets a label.
  const rootId = skeleton.id;
  const namedAncestorOf = (id: string): string | null => {
    for (let cur: string | null = id; cur; cur = tree.byId.get(cur)?.parentId ?? null) {
      // A name is a name whichever field holds it. Junction splits carry only `common`
      // (sciName is "" by the tree's convention), so testing sciName alone walked past them.
      const n = tree.byId.get(cur);
      if (n?.sciName || n?.common) return cur;
    }
    return null;
  };
  const rootAnnoId = namedAncestorOf(rootId);

  return (
    <div className="kinship-tree">
      <div className="kinship-tree-head">
        <span className="kinship-tree-ttl">Where they sit on the tree of life</span>
        <div className="branches-viewtoggle" role="tablist" aria-label="Tree view">
          {(["tree", "radial", "natural"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={`branches-viewseg${view === v ? " is-on" : ""}`} onClick={() => setView(v)}>
              {v === "tree" ? "Tree" : v === "radial" ? "Radial" : "Natural"}
            </button>
          ))}
        </div>
        {natural && (
          <div className="clado-zoombar" role="group" aria-label="Zoom">
            <button type="button" onClick={() => zoomTo(zoom / ZOOM_STEP)} disabled={zoom <= ZOOM_MIN} title="Zoom out">−</button>
            <span className="clado-zoomval">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => zoomTo(zoom * ZOOM_STEP)} disabled={zoom >= ZOOM_MAX} title="Zoom in">+</button>
          </div>
        )}
      </div>

      <div ref={stageRef} className={`kinship-tree-stage${natural ? " is-natural-k" : ""}`}>
        <div ref={canvasRef} className="clado-canvas" style={{ width: layout.width * k, height: layout.height * k }}>
          <div
            className="clado-zoomwrap"
            style={{ width: layout.width, height: layout.height, transform: k !== 1 ? `scale(${k})` : undefined, ["--cz" as string]: 1 / k }}
          >
          <svg className="clado-links" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.links.map((l, i) => (
              // Natural stems arrive as closed tapered outlines to fill; the others are centrelines.
              <path
                key={i}
                d={l.ribbon ? ribbonPath(l.ribbon, Math.min(1, STEM_ZOOM_CAP / k)) : l.d}
                className={`clado-link${l.filled ? " is-stem" : ""}`}
                style={l.filled ? { fill: "var(--clado-line)" } : undefined}
              />
            ))}
          </svg>
          {layout.nodes.map((n) => {
            // Leaves are the sixteen species, coloured by their group.
            if (n.isLeaf) {
              const lvl = levelOf(n.id);
              const out = radial || natural;
              const style = out
                ? { left: n.x + (n.ox ?? 0) * TIP_OUT, top: n.y + (n.oy ?? 0) * TIP_OUT }
                : { left: n.x, top: n.y };
              return (
                <div
                  key={n.id}
                  ref={(el) => { if (el) chipEls.current.set(n.id, el); else chipEls.current.delete(n.id); }}
                  className={`kin-node is-leaf${out ? " is-radial" : ""}`}
                  style={style}
                >
                  <button type="button" className={`kin-leaf lvl-${lvl}`} title={tree.byId.get(n.id)?.sciName} onClick={() => onPick(n.id)}>
                    {nameOf(tree, n.id)}
                  </button>
                </div>
              );
            }
            // Named shared ancestors (the four group clades and any other named
            // split) get a label; unnamed splits stay bare junctions.
            const node = tree.byId.get(n.id);
            // Radial mirrors right-half labels inward, as Branches does (the chips sit outward);
            // natural mirrors labels on branches heading left, so text runs away from the tree.
            const flip = (radial && (n.ox ?? 0) > 0) || (natural && (n.ox ?? 0) < 0) ? " is-flip" : "";
            if (!node?.sciName && !node?.common) {
              // The root always gets a label (nearest named ancestor); other
              // unnamed splits stay bare junction dots.
              if (n.id === rootId && rootAnnoId) {
                const anc = tree.byId.get(rootAnnoId);
                return (
                  <button key={n.id} type="button" className={`clado-pt is-clade is-ancestor${flip}`} style={{ left: n.x, top: n.y }} onClick={() => onPick(rootAnnoId)}>
                    <span className="pt-dot" />
                    <span className="pt-name">{nameOf(tree, rootAnnoId)}</span>
                    <span className="pt-rank">{displayRank(anc)}</span>
                  </button>
                );
              }
              return (
                <div key={n.id} className="clado-pt is-junction" style={{ left: n.x, top: n.y }}>
                  <span className="pt-dot" />
                </div>
              );
            }
            return (
              <button key={n.id} type="button" className={`clado-pt is-clade${flip}`} style={{ left: n.x, top: n.y }} onClick={() => onPick(n.id)}>
                <span className="pt-dot" />
                <span className="pt-name">{nameOf(tree, n.id)}</span>
                <span className="pt-rank">{displayRank(node)}</span>
              </button>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}
