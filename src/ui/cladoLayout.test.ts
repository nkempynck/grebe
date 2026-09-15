import { describe, it, expect } from "vitest";
import { naturalLayout, CLADO_NATURAL, type TreeLike } from "./cladoLayout";

// The natural view is geometry, and geometry is the one thing a screenshot check is bad at
// and a test is good at. These assert the properties the drawing depends on: everything
// lands inside the canvas the layout reports, stems thin as they divide, and a lopsided
// lineage actually coils instead of running off in a straight line.

/** A caterpillar: a spine of forks each shedding one leaf, which is the shape a Lineage
 *  board really has (every guess hangs where it split from the answer). */
function caterpillar(n: number, p = ""): TreeLike {
  let node: TreeLike = { id: `${p}tip`, children: [] };
  for (let i = n; i > 0; i--) {
    node = { id: `${p}fork${i}`, children: [node, { id: `${p}guess${i}`, children: [] }] };
  }
  return node;
}

/** One fork whose two sides have been played very differently: six guesses went into the
 *  left branch and one into the right. This is the case the view exists for. */
function lopsided(): TreeLike {
  return { id: "root", children: [caterpillar(6, "dev-"), { id: "lone", children: [] }] };
}

/** A balanced binary tree, the other extreme. */
function balanced(depth: number, prefix = "b"): TreeLike {
  if (depth === 0) return { id: `${prefix}`, children: [] };
  return { id: prefix, children: [balanced(depth - 1, `${prefix}L`), balanced(depth - 1, `${prefix}R`)] };
}

describe("naturalLayout", () => {
  it("is deterministic", () => {
    const a = naturalLayout(caterpillar(8), CLADO_NATURAL);
    const b = naturalLayout(caterpillar(8), CLADO_NATURAL);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("keeps every node inside the canvas it reports", () => {
    for (const tree of [caterpillar(1), caterpillar(6), caterpillar(15), balanced(4)]) {
      const g = naturalLayout(tree, CLADO_NATURAL);
      expect(g.width).toBeGreaterThan(0);
      expect(g.height).toBeGreaterThan(0);
      for (const n of g.nodes) {
        expect(Number.isFinite(n.x)).toBe(true);
        expect(Number.isFinite(n.y)).toBe(true);
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x).toBeLessThanOrEqual(g.width);
        expect(n.y).toBeLessThanOrEqual(g.height);
      }
    }
  });

  it("gives every node but the root exactly one stem, closed and fillable", () => {
    const g = naturalLayout(caterpillar(7), CLADO_NATURAL);
    expect(g.links).toHaveLength(g.nodes.length - 1);
    for (const l of g.links) {
      expect(l.filled).toBe(true);
      expect(l.d.endsWith("Z")).toBe(true);
      expect(l.d).not.toMatch(/NaN/);
    }
  });

  it("thins branches as they divide, never below the floor", () => {
    const g = naturalLayout(caterpillar(10), CLADO_NATURAL);
    const root = g.nodes.find((n) => n.id === "fork1")!;
    expect(root.girth).toBeCloseTo(CLADO_NATURAL.girth);
    for (const n of g.nodes) {
      expect(n.girth!).toBeGreaterThanOrEqual(CLADO_NATURAL.minGirth);
      expect(n.girth!).toBeLessThanOrEqual(CLADO_NATURAL.girth);
    }
    // A single-species twig must be thinner than the spine it hangs off.
    const twig = g.nodes.find((n) => n.id === "guess3")!;
    const spine = g.nodes.find((n) => n.id === "fork3")!;
    expect(twig.girth!).toBeLessThan(spine.girth!);
  });

  it("coils a lopsided lineage rather than drawing it straight", () => {
    const g = naturalLayout(caterpillar(12), CLADO_NATURAL);
    const spine = ["fork1", "fork6", "fork12"].map((id) => g.nodes.find((n) => n.id === id)!);
    // Each step down the spine adds the same constant turn, so the heading keeps rising.
    expect(spine[1].angle!).toBeGreaterThan(spine[0].angle!);
    expect(spine[2].angle!).toBeGreaterThan(spine[1].angle!);
    // ...and over a long spine it turns far enough to be a visible curve, not a lean.
    expect(spine[2].angle! - spine[0].angle!).toBeGreaterThan(1);
  });

  it("does not stack two tips on the same point", () => {
    const g = naturalLayout(caterpillar(12), CLADO_NATURAL);
    const tips = g.nodes.filter((n) => n.isLeaf);
    for (let i = 0; i < tips.length; i++) {
      for (let j = i + 1; j < tips.length; j++) {
        expect(Math.hypot(tips[i].x - tips[j].x, tips[i].y - tips[j].y)).toBeGreaterThan(4);
      }
    }
  });

  // The point of the view: keep guessing into one clade and that branch should visibly
  // develop rather than stay a thorn. Length, width and heading all have to respond.
  it("develops the branch that has been guessed into", () => {
    const g = naturalLayout(lopsided(), CLADO_NATURAL);
    const at = (id: string) => g.nodes.find((n) => n.id === id)!;
    const root = at("root");
    const dev = at("dev-fork1"); // six guesses under it
    const lone = at("lone"); // one
    const runFrom = (n: { x: number; y: number }) => Math.hypot(n.x - root.x, n.y - root.y);

    expect(runFrom(dev)).toBeGreaterThan(runFrom(lone)); // longer
    expect(dev.girth!).toBeGreaterThan(lone.girth!); // thicker
    // ...and it stays nearer the trunk's heading, while the single guess sticks out.
    expect(Math.abs(dev.angle! - root.angle!)).toBeLessThan(Math.abs(lone.angle! - root.angle!));
  });

  it("coils inside a developed branch, not only along the trunk", () => {
    const g = naturalLayout(lopsided(), CLADO_NATURAL);
    const spine = ["dev-fork1", "dev-fork3", "dev-fork6"].map((id) => g.nodes.find((n) => n.id === id)!);
    expect(spine[1].angle!).toBeGreaterThan(spine[0].angle!);
    expect(spine[2].angle!).toBeGreaterThan(spine[1].angle!);
  });

  it("handles a lone tip without dividing by zero", () => {
    const g = naturalLayout({ id: "only", children: [] }, CLADO_NATURAL);
    expect(g.nodes).toHaveLength(1);
    expect(g.links).toHaveLength(0);
    expect(Number.isFinite(g.width)).toBe(true);
  });
});
