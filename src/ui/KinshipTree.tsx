import { useMemo, useState } from "react";
import type { DisplayTreeNode, GridBoard, Tree } from "../core";
import { inducedSubtree } from "../core";
import { treeLayout, radialLayout, CLADO_TREE, CLADO_RADIAL, type GraphLayout } from "./cladoLayout";

interface Props {
  tree: Tree;
  board: GridBoard;
  /** Group level (0..3) for a species id → the game's colour (lvl-N / --gN). */
  levelOf: (id: string) => number;
  /** Open the Wikipedia reader for a node (species or clade). */
  onPick: (id: string) => void;
}

const nameOf = (tree: Tree, id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;

// How far a leaf chip floats out past its branch end in radial mode.
const TIP_OUT = 12;

/** Post-game phylogeny for a Kinship board: the sixteen species on the shared
 *  tree of life, each coloured by the group it belonged to, with the four group
 *  clades (and any other named shared ancestor) annotated and clickable for
 *  Wikipedia. Uses Lineage's layout engine; toggles Tree / Radial. */
export function KinshipTree({ tree, board, levelOf, onPick }: Props) {
  const [radial, setRadial] = useState(false);
  const groupClades = useMemo(() => new Set(board.groups.map((g) => g.cladeId)), [board]);
  const skeleton = useMemo<DisplayTreeNode | null>(
    () => inducedSubtree(tree, board.tiles, (id) => groupClades.has(id)),
    [tree, board.tiles, groupClades]
  );
  const layout = useMemo<GraphLayout | null>(() => {
    if (!skeleton) return null;
    if (radial) return radialLayout(skeleton, { ...CLADO_RADIAL, pad: 30, rim: 66 });
    const L = treeLayout(skeleton, { ...CLADO_TREE, padx: 70 });
    return { ...L, height: L.height + 40 };
  }, [skeleton, radial]);

  if (!skeleton || !layout) return null;

  return (
    <div className="kinship-tree">
      <div className="kinship-tree-head">
        <span className="kinship-tree-ttl">Where they sit on the tree of life</span>
        <div className="branches-viewtoggle" role="tablist" aria-label="Tree view">
          <button role="tab" aria-selected={!radial} className={`branches-viewseg${!radial ? " is-on" : ""}`} onClick={() => setRadial(false)}>Tree</button>
          <button role="tab" aria-selected={radial} className={`branches-viewseg${radial ? " is-on" : ""}`} onClick={() => setRadial(true)}>Radial</button>
        </div>
      </div>

      <div className="kinship-tree-stage">
        <div className="clado-canvas" style={{ width: layout.width, height: layout.height }}>
          <svg className="clado-links" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.links.map((l, i) => (
              <path key={i} d={l.d} className="clado-link" />
            ))}
          </svg>
          {layout.nodes.map((n) => {
            // Leaves are the sixteen species, coloured by their group.
            if (n.isLeaf) {
              const lvl = levelOf(n.id);
              const style = radial
                ? { left: n.x + (n.ox ?? 0) * TIP_OUT, top: n.y + (n.oy ?? 0) * TIP_OUT }
                : { left: n.x, top: n.y };
              return (
                <div key={n.id} className={`kin-node is-leaf${radial ? " is-radial" : ""}`} style={style}>
                  <button type="button" className={`kin-leaf lvl-${lvl}`} title={tree.byId.get(n.id)?.sciName} onClick={() => onPick(n.id)}>
                    {nameOf(tree, n.id)}
                  </button>
                </div>
              );
            }
            // Named shared ancestors (the four group clades and any other named
            // split) get a label; unnamed splits stay bare junctions.
            const node = tree.byId.get(n.id);
            if (!node?.sciName) {
              return (
                <div key={n.id} className="clado-pt is-junction" style={{ left: n.x, top: n.y }}>
                  <span className="pt-dot" />
                </div>
              );
            }
            return (
              <button key={n.id} type="button" className="clado-pt is-clade" style={{ left: n.x, top: n.y }} onClick={() => onPick(n.id)}>
                <span className="pt-dot" />
                <span className="pt-name">{nameOf(tree, n.id)}</span>
                <span className="pt-rank">{node.rank}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
