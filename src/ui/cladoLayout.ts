// Shared cladogram layout for both games. Lineage and Branches each build a
// display tree of {id, children} nodes; this module lays one out two ways —
// top-down (tree) or as a circular fan (radial) — so the two games share
// identical spacing, link geometry, and projection maths. The games differ only
// in how they render the nodes at the returned coordinates.

export interface Pt {
  x: number;
  y: number;
}

/** Any display tree: a node id plus its children. Both games' node types fit. */
export interface TreeLike {
  id: string;
  children: TreeLike[];
}

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  depth: number;
  isLeaf: boolean;
  /** Outward unit vector (radial only) for orienting labels/tiles. */
  ox?: number;
  oy?: number;
}

export interface GraphLink {
  parentId: string;
  childId: string;
  /** SVG path in translated screen space. */
  d: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  links: GraphLink[];
  width: number;
  height: number;
}

// Shared spacing so the two games line up pixel-for-pixel.
export const CLADO_TREE = { gapx: 172, gapy: 62, padx: 26, pady: 30 };
export const CLADO_RADIAL = { gapx: 150, ring: 84, innerRadius: 96, spanMax: 2.4, pad: 40, rim: 60 };

interface Measured {
  depthById: Map<string, number>;
  colById: Map<string, number>;
  leafIds: Set<string>;
  leaves: number;
  maxDepth: number;
}

/** Depth of every node, sequential leaf columns, parents centred over children. */
function measure(root: TreeLike): Measured {
  const depthById = new Map<string, number>();
  const leafIds = new Set<string>();
  let maxDepth = 0;
  (function walk(n: TreeLike, d: number) {
    depthById.set(n.id, d);
    maxDepth = Math.max(maxDepth, d);
    if (n.children.length === 0) leafIds.add(n.id);
    n.children.forEach((c) => walk(c, d + 1));
  })(root, 0);

  const colById = new Map<string, number>();
  let leaves = 0;
  (function assign(n: TreeLike): number {
    if (n.children.length === 0) {
      const c = leaves++;
      colById.set(n.id, c);
      return c;
    }
    const cs = n.children.map(assign);
    const c = (Math.min(...cs) + Math.max(...cs)) / 2;
    colById.set(n.id, c);
    return c;
  })(root);

  return { depthById, colById, leafIds, leaves, maxDepth };
}

export interface TreeOpts {
  gapx: number;
  gapy: number;
  padx: number;
  pady: number;
}

/** Top-down cladogram: leaf columns, tiers by depth, orthogonal elbow links. */
export function treeLayout(root: TreeLike, o: TreeOpts): GraphLayout {
  const { depthById, colById, leafIds, leaves, maxDepth } = measure(root);
  const xOf = (id: string) => o.padx + colById.get(id)! * o.gapx;
  const yOf = (d: number) => o.pady + d * o.gapy;

  const nodes: GraphNode[] = [];
  depthById.forEach((d, id) => {
    nodes.push({ id, x: xOf(id), y: yOf(d), depth: d, isLeaf: leafIds.has(id) });
  });

  const links: GraphLink[] = [];
  (function link(n: TreeLike) {
    const x = xOf(n.id), y = yOf(depthById.get(n.id)!);
    for (const c of n.children) {
      const cx = xOf(c.id), cy = yOf(depthById.get(c.id)!);
      const midY = y + (cy - y) / 2;
      links.push({ parentId: n.id, childId: c.id, d: `M ${x} ${y} L ${x} ${midY} L ${cx} ${midY} L ${cx} ${cy}` });
      link(c);
    }
  })(root);

  return {
    nodes,
    links,
    width: o.padx * 2 + Math.max(1, leaves) * o.gapx,
    height: o.pady * 2 + maxDepth * o.gapy + 20,
  };
}

export interface RadialOpts {
  gapx: number;
  ring: number;
  innerRadius: number;
  spanMax: number;
  pad: number;
  rim: number;
  /** If set, rotate the fan so this node sits at the bottom (θ=0). */
  focusId?: string | null;
}

/** Circular fan: depth grows the radius outward from a centre above the tips,
 *  leaf order sweeps the angle. θ=0 points straight down; an optional focus node
 *  is rotated there so the active part sits on the straightest stretch of arc.
 *  Branches are the classic radial-dendrogram elbow — an arc along the parent's
 *  ring to the child's angle, then a radial spoke out to the child. */
export function radialLayout(root: TreeLike, o: RadialOpts): GraphLayout {
  const { depthById, colById, leafIds, leaves, maxDepth } = measure(root);
  const denom = Math.max(1, leaves - 1);
  const uOf = (id: string) => (leaves <= 1 ? 0.5 : colById.get(id)! / denom);

  const span = leaves <= 1 ? 0 : Math.min(o.spanMax, (leaves * o.gapx) / (o.innerRadius + maxDepth * o.ring));
  const rOf = (d: number) => o.innerRadius + d * o.ring;
  const focusU = o.focusId != null && colById.has(o.focusId) ? uOf(o.focusId) : 0.5;
  const rot = (focusU - 0.5) * span;
  const angleOf = (u: number) => (u - 0.5) * span - rot;
  const proj = (u: number, d: number): Pt => {
    const th = angleOf(u), r = rOf(d);
    return { x: r * Math.sin(th), y: r * Math.cos(th) };
  };

  interface Raw extends Pt { depth: number; isLeaf: boolean; theta: number; }
  const raw = new Map<string, Raw>();
  depthById.forEach((d, id) => {
    const p = proj(uOf(id), d);
    raw.set(id, { x: p.x, y: p.y, depth: d, isLeaf: leafIds.has(id), theta: angleOf(uOf(id)) });
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of raw.values()) {
    const ex = p.x + (p.isLeaf ? Math.sin(p.theta) * o.rim : 0);
    const ey = p.y + (p.isLeaf ? Math.cos(p.theta) * o.rim : 0);
    minX = Math.min(minX, p.x, ex); maxX = Math.max(maxX, p.x, ex);
    minY = Math.min(minY, p.y, ey); maxY = Math.max(maxY, p.y, ey);
  }
  const tx = (p: Pt): Pt => ({ x: p.x - minX + o.pad, y: p.y - minY + o.pad });

  const nodes: GraphNode[] = [];
  raw.forEach((p, id) => {
    const t = tx(p);
    nodes.push({ id, x: t.x, y: t.y, depth: p.depth, isLeaf: p.isLeaf, ox: Math.sin(p.theta), oy: Math.cos(p.theta) });
  });

  const f = (n: number) => n.toFixed(1);
  const links: GraphLink[] = [];
  (function link(n: TreeLike) {
    const uP = uOf(n.id), dP = depthById.get(n.id)!;
    for (const c of n.children) {
      const uC = uOf(c.id), dC = depthById.get(c.id)!;
      const p = tx(proj(uP, dP)), elbow = tx(proj(uC, dP)), cc = tx(proj(uC, dC));
      const rP = rOf(dP);
      const sweep = angleOf(uC) > angleOf(uP) ? 0 : 1;
      links.push({
        parentId: n.id,
        childId: c.id,
        d: `M ${f(p.x)} ${f(p.y)} A ${f(rP)} ${f(rP)} 0 0 ${sweep} ${f(elbow.x)} ${f(elbow.y)} L ${f(cc.x)} ${f(cc.y)}`,
      });
      link(c);
    }
  })(root);

  return { nodes, links, width: maxX - minX + o.pad * 2, height: maxY - minY + o.pad * 2 };
}
