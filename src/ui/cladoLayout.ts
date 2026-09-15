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
  /** Outward unit vector (radial + natural) for orienting labels/tiles. */
  ox?: number;
  oy?: number;
  /** Natural only: the direction this node's own stem runs, in radians clockwise from
   *  straight up. Lets a caller lay a clade's label ALONG its branch, which is the one
   *  place a label can never collide with the branch it names. */
  angle?: number;
  /** Natural only: the stem's width in px where it meets this node. */
  girth?: number;
}

export interface GraphLink {
  parentId: string;
  childId: string;
  /** SVG path in translated screen space. */
  d: string;
  /** When true `d` is a CLOSED tapered outline to be filled, not a centreline to stroke.
   *  A stroke has one width for its whole length, and a tree whose branches don't thin as
   *  they divide doesn't read as a tree. */
  filled?: boolean;
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
export const CLADO_NATURAL: NaturalOpts = {
  trunk: 128,
  twig: 74,
  girth: 15,
  spread: 1.0,
  // ~26° of turn at every fork on the main line. A Lineage board only has a handful of
  // spine forks, so a gentle per-fork turn adds up to a lean rather than a coil.
  spin: 0.42,
  // 0.42 rad a step means a full turn takes ~15 forks; at 0.93 a step the radius is a
  // third of what it was by then, so the spiral clears its own previous lap comfortably.
  shrinkLive: 0.93,
  // A dead coil's whole reach is its first segment over (1 - shrink): 0.72 keeps that to
  // ~3.6x, where 0.84 allowed 6.25x, which is far enough for a heavily guessed branch to
  // cross the trunk.
  shrinkDead: 0.72,
  curl: 1.0,
  deadBase: 0.62,
  hook: 0.45,
  // Below da Vinci's 2, deliberately. At 2.2 a one-species branch still came out a third of
  // the trunk's width, which reads as a stump rather than a twig; 1.5 takes it to a sixth,
  // so the trunk stays heavy, the limbs are clearly lighter, and the twigs are hairs.
  taper: 1.5,
  minGirth: 0.9,
  flare: 1.45,
  tipBox: { halfW: 92, halfH: 26 },
  pad: 48,
};

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
  /** Footprint hints so the canvas is sized to what's actually drawn and nothing clips.
   *  All optional; omitted → legacy behaviour (node points + a radial `rim` for leaves).
   *  A caller that renders wide labels/tiles passes these so edge elements stay in view. */
  /** Half-width the leaf element extends around its tip (tip = node + tipOut along the
   *  outward ray). When set, leaves reserve a box instead of the radial `rim`. */
  leafBox?: { halfW: number; halfH: number };
  /** Outward offset of a leaf element's centre from its node (matches the render). */
  tipOut?: number;
  /** Width an internal node's LABEL extends in its outward (left/right of centre)
   *  direction, so clade labels are never clipped. 0/undefined → no label allowance. */
  labelW?: number;
  /** Half-height of an internal node's label (for vertical bounds). */
  labelHalfH?: number;
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
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  for (const p of raw.values()) {
    grow(p.x, p.y);
    if (p.isLeaf && o.leafBox) {
      // Leaf renders as a box centred at the tip (node + tipOut along the ray); reserve
      // its full extent so a tile near the rim never clips.
      const cx = p.x + Math.sin(p.theta) * (o.tipOut ?? 0);
      const cy = p.y + Math.cos(p.theta) * (o.tipOut ?? 0);
      grow(cx - o.leafBox.halfW, cy - o.leafBox.halfH);
      grow(cx + o.leafBox.halfW, cy + o.leafBox.halfH);
    } else if (p.isLeaf) {
      grow(p.x + Math.sin(p.theta) * o.rim, p.y + Math.cos(p.theta) * o.rim);
    } else if (o.labelW) {
      // Internal label extends INWARD, toward the vertical centre line (right half → left,
      // left half → right), matching the render, so it never clips and stays clear of the
      // rim tiles.
      const dir = p.x >= 0 ? -1 : 1;
      const hh = o.labelHalfH ?? 12;
      grow(p.x + dir * o.labelW, p.y - hh);
      grow(p.x + dir * o.labelW, p.y + hh);
    }
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

export interface NaturalOpts {
  /** Length of the root stem in px: the longest any single segment gets. */
  trunk: number;
  /** Length of a segment carrying one species. Every stem is between this and `trunk`. */
  twig: number;
  /** Width of the root stem in px. */
  girth: number;
  /** How far a sibling swings off its parent's heading, in radians, when it carries one
   *  species. A branch holding more swings proportionally less. */
  spread: number;
  /** The constant, always same-signed turn the HEAVIEST child takes at every fork. This
   *  one number is what makes the shape: a long lopsided lineage adds the same small turn
   *  at every step and winds into a coil, which is the look OneZoom is known for. */
  spin: number;
  /** How much a segment shrinks per generation ALONG THE LIVE PATH. Must be under 1, and
   *  not for looks: a constant turn with a constant length walks a regular polygon, so a
   *  long spine closes into a circle and laps itself. Shrinking as it turns is what makes
   *  it a logarithmic spiral instead, which can wind forever without ever meeting itself.
   *  Kept gentle, because this is the branch that needs room. */
  shrinkLive: number;
  /** The same, per generation off the live path, and far stronger: a ruled-out branch
   *  should roll up into a small tight coil and stop competing for space. */
  shrinkDead: number;
  /** The per-fork turn INSIDE a dead branch. Much tighter than `spin`, so a branch you have
   *  already ruled out curls up on itself instead of reaching across the drawing. */
  curl: number;
  /** Scales down every segment of a dead branch, its spokes included. The turn alone can't
   *  keep a heavily guessed branch tidy: at a tight curl it simply closes a full lap, and a
   *  big first lap brings the stem back alongside itself with its twigs crossing. Making
   *  the whole sub-coil smaller is what turns it into a tuft rather than a ring. */
  deadBase: number;
  /** Extra turn applied to the far end of a dead twig's ribbon, so even a single wrong
   *  guess hooks inward rather than projecting straight out. Cosmetic: it bends the stem
   *  without moving the node or its label. */
  hook: number;
  /** Which nodes are on the live path — root down to the hidden species, or to the answer
   *  once revealed. Everything else is a dead end. Omitted → everything is live, and the
   *  layout behaves as one open spiral. */
  live?: (id: string) => boolean;
  /** Exponent on the width-from-species-count rule. 2 is da Vinci's (a branch's area
   *  equals its children's); a little over that thins the twigs faster and reads better
   *  on a phone. */
  taper: number;
  /** Twigs never thinner than this, or they vanish under a hairline. */
  minGirth: number;
  /** How much wider than itself a branch is where it joins its parent. Just a fillet: a
   *  stem that left at its parent's full width would swallow its siblings at the fork and
   *  the whole join would read as one lump, which is what it did before this existed. */
  flare: number;
  /** Room a tip's disc + label needs around it, so nothing clips at the canvas edge. */
  tipBox: { halfW: number; halfH: number };
  pad: number;
}

/** A tapering, self-similar tree: the root stem runs up from the bottom and every fork
 *  hands its children a shorter, thinner stem turned off the parent's heading.
 *
 *  Unlike `treeLayout` and `radialLayout`, depth does NOT set a node's distance from the
 *  root here. Length and width both come from how many species sit below a branch, which
 *  is what makes the drawing look like a tree rather than a diagram of one: the trunk is
 *  thick because everything hangs off it, and a twig with one species on it is thin.
 *
 *  The heaviest child at each fork turns by a constant `spin` in a constant direction and
 *  its lighter siblings fan off the other way, so the shape a Lineage board actually has
 *  (a long spine of splits with a guess or two hanging off each) comes out as a coil with
 *  bristles rather than as a stick.
 *
 *  Stems are returned as CLOSED tapered outlines (`filled`), since a stroked path can't
 *  narrow along its length. */
export function naturalLayout(root: TreeLike, o: NaturalOpts): GraphLayout {
  // Species below each node: the only input to length, width and turn.
  const below = new Map<string, number>();
  (function count(n: TreeLike): number {
    const c = n.children.length === 0 ? 1 : n.children.reduce((s, k) => s + count(k), 0);
    below.set(n.id, c);
    return c;
  })(root);

  // Length, width and turn are ABSOLUTE functions of what a branch carries, not fractions
  // of its parent. That is what makes the drawing grow with play rather than just fan out:
  // guess into one clade repeatedly and that branch gains segments, so it lengthens,
  // thickens, straightens up towards the trunk's heading and begins to coil on its own,
  // a smaller copy of the whole tree. Relative scaling shrank a sub-branch away before it
  // could develop, which is why a board with one guess per clade came out as thorns.
  const total = below.get(root.id) ?? 1;
  const reach = Math.log2(1 + total) || 1;
  const weight = (id: string) => Math.log2(1 + (below.get(id) ?? 1)) / reach; // 0…1
  // Three factors. The weight term is the play part: at a given depth, the branch you have
  // guessed into most is the longest of its siblings. The two shrink terms are the fractal
  // part, counted separately along and away from the live path, so the live branch winds
  // out slowly while a ruled-out one collapses into a coil.
  // How much a whole generation is scaled down, length and width alike. Both dimensions
  // must carry it or the drawing stops being self-similar: length alone was shrinking with
  // depth while width held, so each generation came out squatter than the one above it
  // until the twigs were stubs.
  const scaleAt = (depth: number, dead: number) =>
    Math.pow(o.shrinkLive, depth - dead) * Math.pow(o.shrinkDead, dead);
  const lenOf = (id: string, depth: number, dead: number) =>
    (o.twig + (o.trunk - o.twig) * weight(id)) * (dead > 0 ? o.deadBase : 1) * scaleAt(depth, dead);
  const isLive = (id: string) => (o.live ? o.live(id) : true);
  const girthOf = (id: string, depth: number, dead: number) =>
    Math.max(
      o.minGirth,
      o.girth * Math.pow((below.get(id) ?? 1) / total, 1 / o.taper) * scaleAt(depth, dead)
    );
  // A twig sticks out; a limb carrying many species stays nearer the parent's heading.
  const turnOf = (id: string) => o.spread / (1 + Math.log2(below.get(id) ?? 1));

  interface Placed extends Pt {
    depth: number;
    isLeaf: boolean;
    angle: number;
    girth: number;
  }
  const raw = new Map<string, Placed>();
  const stems: {
    parentId: string;
    childId: string;
    a: Pt;
    b: Pt;
    /** Headings at each end, so the stem can leave its parent tangentially. */
    ha: number;
    hb: number;
    wa: number;
    wb: number;
    main: boolean;
  }[] = [];

  // θ=0 points straight up, and screen y grows downward, hence the minus on cos.
  const dir = (angle: number): Pt => ({ x: Math.sin(angle), y: -Math.cos(angle) });
  const step = (p: Pt, angle: number, len: number): Pt => ({
    x: p.x + Math.sin(angle) * len,
    y: p.y - Math.cos(angle) * len,
  });

  (function walk(
    n: TreeLike,
    base: Pt,
    angle: number,
    len: number,
    width: number,
    depth: number,
    parentId: string | null,
    parentWidth: number,
    parentAngle: number,
    dead: number,
    /** True when this node continues its parent's branch (the heaviest child). Only the
     *  continuation inherits the parent's heading; a branch peeling off must not, or it
     *  runs alongside the trunk before turning and merges into it visually. */
    main: boolean
  ) {
    const tip = step(base, angle, len);
    const leaf = n.children.length === 0;
    raw.set(n.id, { x: tip.x, y: tip.y, depth, isLeaf: leaf, angle, girth: width });
    if (parentId !== null) {
      // A dead twig has no children to carry a coil onward, so its own ribbon does the
      // curling: the far end arrives turned the way the spiral winds, hooking it inward
      // rather than letting it stick out into the live branch's room. The node and its
      // label stay exactly where `angle` put them.
      // Away from the main spiral, not back into it: a dead twig leaves on the outer flank,
      // so hooking it the way the trunk winds would curl it straight back across the trunk.
      // A dead twig bends the way its own coil winds, tucking its tip back toward the tuft
      // rather than flicking it further out into whatever is beyond.
      const hb = dead > 0 && leaf ? angle - Math.sign(o.spin) * o.hook : angle;
      // The base is this branch's OWN width plus a fillet, never the parent's. Starting
      // every child at the parent's width meant two siblings each left a fork as a
      // full-width wedge, overlapping into a single blob before either had tapered.
      const base0 = Math.min(parentWidth, width * o.flare);
      // The continuation carries the parent's heading, so the spine stays one smooth curve.
      // A branch peeling off starts almost along its OWN heading, leaving the trunk at an
      // angle immediately instead of running beside it. That parallel run was what fused a
      // fork's children into a single slab.
      const ha = main ? parentAngle : angle + (parentAngle - angle) * 0.15;
      stems.push({ parentId, childId: n.id, a: base, b: tip, ha, hb, wa: base0, wb: width, main });
    }

    // Index 0 is the branch that carries the drawing onward: it takes the small `spin` turn
    // and keeps the parent's heading, so the spine reads as one curve. The LIVE child claims
    // that slot whatever its size, because the hidden species is the point of the picture —
    // sorted purely by weight it came last, fanned out sideways like any dead twig, and its
    // stem crossed the guesses hanging off the same fork.
    const kids = [...n.children].sort(
      (a, b) =>
        Number(isLive(b.id)) - Number(isLive(a.id)) || (below.get(b.id) ?? 1) - (below.get(a.id) ?? 1)
    );
    const minors = kids.length - 1;
    kids.forEach((k, i) => {
      // Once a branch is off the live path it stays off it, and every further generation
      // tightens: `curl` instead of `spin`, and one more factor of `shrink` in its length.
      const kDead = isLive(k.id) ? 0 : dead + 1;
      let turn: number;
      if (i === 0) {
        // A dead branch coils the OPPOSITE way to the trunk. It left on the outer flank, so
        // winding it the same way would carry it back over the spine; winding it outward
        // keeps the whole sub-coil clear of the main spiral however far it develops.
        turn = kDead > 0 ? -Math.sign(o.spin) * o.curl : o.spin;
      } else {
        // Every lighter branch fans to the OUTSIDE of the coil, never across its inside.
        // The inside is where the spine is about to travel, so a branch sent in there is a
        // collision waiting to happen — which is what was crossing the trunk before.
        // Several of them spread out along that outer flank rather than stacking.
        // `turnOf` holds a heavy branch near its parent's heading, which is right for a limb
        // that still leads somewhere and wrong for a dead end: a ruled-out branch with six
        // guesses in it was leaving at barely 16° and running alongside the trunk, which is
        // the pair of parallel stems. A dead branch always takes the full angle and gets out
        // of the way, however much has been guessed into it.
        const fan = minors === 1 ? 1 : 0.6 + (0.8 * (i - 1)) / (minors - 1);
        // Away from whichever way THIS branch is winding. The live spine turns by +spin, so
        // its twigs go negative; a dead branch curls the other way, so its twigs go positive.
        // Getting this wrong put a dead coil's continuation and its guesses on the very same
        // heading — `curl` and `spread` are both 1.0 — and drew them as parallel ribbons.
        const outward = dead > 0 ? Math.sign(o.spin) : -Math.sign(o.spin);
        turn = outward * (kDead > 0 ? o.spread : turnOf(k.id)) * fan;
      }
      walk(k, tip, angle + turn, lenOf(k.id, depth + 1, kDead), girthOf(k.id, depth + 1, kDead), depth + 1, n.id, width, angle, kDead, i === 0);
    });
  })(root, { x: 0, y: 0 }, 0, lenOf(root.id, 0, 0), girthOf(root.id, 0, 0), 0, null, girthOf(root.id, 0, 0), 0, 0, true);

  // ---- fit the canvas to what will actually be drawn ----
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  grow(0, 0); // the root stem's foot
  for (const p of raw.values()) {
    // A stem's outline reaches half its width either side of the node it ends at; a tip
    // additionally carries its disc and label.
    const hw = p.isLeaf ? o.tipBox.halfW : p.girth / 2;
    const hh = p.isLeaf ? o.tipBox.halfH : p.girth / 2;
    grow(p.x - hw, p.y - hh);
    grow(p.x + hw, p.y + hh);
  }
  const dx = -minX + o.pad;
  const dy = -minY + o.pad;

  const nodes: GraphNode[] = [];
  raw.forEach((p, id) => {
    nodes.push({
      id,
      x: p.x + dx,
      y: p.y + dy,
      depth: p.depth,
      isLeaf: p.isLeaf,
      ox: Math.sin(p.angle),
      oy: -Math.cos(p.angle),
      angle: p.angle,
      girth: p.girth,
    });
  });

  const f = (n: number) => n.toFixed(1);
  /** How many points a stem's centreline is sampled at before it's offset into a ribbon.
   *  Offsetting a curve exactly is awkward; sampling it is not, and at this density the
   *  joins are invisible. */
  const SAMPLES = 18;

  const links: GraphLink[] = stems.map((s) => {
    const a = { x: s.a.x + dx, y: s.a.y + dy };
    const b = { x: s.b.x + dx, y: s.b.y + dy };
    // A stem leaves its parent along the PARENT's heading and arrives along its own, so
    // consecutive stems share a tangent and a spine reads as one continuous curve rather
    // than a chain of straight wedges. That tangent continuity is what makes the coil look
    // like a coil; more `spin` alone just bends a wire at sharper corners.
    // Short for a branch peeling off: a long control arm would hold it parallel to the
    // trunk for half its length, which is exactly the merging this avoids.
    const reachOut = (s.main ? 0.5 : 0.28) * Math.hypot(b.x - a.x, b.y - a.y);
    const da = dir(s.ha), db = dir(s.hb);
    const c1 = { x: a.x + da.x * reachOut, y: a.y + da.y * reachOut };
    const c2 = { x: b.x - db.x * reachOut, y: b.y - db.y * reachOut };
    const at = (t: number): Pt => {
      const u = 1 - t;
      const k0 = u * u * u, k1 = 3 * u * u * t, k2 = 3 * u * t * t, k3 = t * t * t;
      return {
        x: k0 * a.x + k1 * c1.x + k2 * c2.x + k3 * b.x,
        y: k0 * a.y + k1 * c1.y + k2 * c2.y + k3 * b.y,
      };
    };

    // Walk the centreline, offsetting half a width to each side; the width eases from the
    // parent's to this branch's so a thick limb narrows smoothly into a thin one.
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const t = i / SAMPLES;
      const p = at(t);
      const q = at(Math.min(1, t + 1e-3));
      const r = at(Math.max(0, t - 1e-3));
      const vx = q.x - r.x, vy = q.y - r.y;
      const m = Math.hypot(vx, vy) || 1;
      const nx = -vy / m, ny = vx / m;
      // Concave, not linear: the fillet falls away fast and the rest of the branch runs at
      // its own width, which is the shape a real join has. A straight interpolation makes
      // every branch a long triangle, which is where the stumpiness came from.
      const hw = (s.wb + (s.wa - s.wb) * (1 - t) * (1 - t)) / 2;
      left.push({ x: p.x + nx * hw, y: p.y + ny * hw });
      right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
    }
    const d =
      `M ${f(left[0].x)} ${f(left[0].y)}` +
      left.slice(1).map((p) => ` L ${f(p.x)} ${f(p.y)}`).join("") +
      right.reverse().map((p) => ` L ${f(p.x)} ${f(p.y)}`).join("") +
      " Z";
    return { parentId: s.parentId, childId: s.childId, filled: true, d };
  });

  return { nodes, links, width: maxX - minX + o.pad * 2, height: maxY - minY + o.pad * 2 };
}
