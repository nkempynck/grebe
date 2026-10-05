// Post-render tidy-up for the radial and natural cladograms, shared by Branches and Kinship's
// post-game tree: clade labels first, then leaf boxes. Both work on the rendered DOM, because
// only the browser knows how wide a label or a tile came out.

import type { GraphNode } from "./cladoLayout";

type R = { x: number; y: number; w: number; h: number };
const GAP = 5; // min clear space between boxes
const hit = (a: R, b: R) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Undo an earlier pass, e.g. when switching back to the plain tree. */
export function resetCladeLabels(canvas: HTMLElement, tiles: Iterable<HTMLElement> = []): void {
  for (const el of tiles) el.style.transform = "";
  for (const el of canvas.querySelectorAll<HTMLElement>(".clado-pt.is-clade")) {
    el.style.removeProperty("--ly");
    el.removeAttribute("data-side");
  }
}

/** LABELS FIRST. Neighbouring clades on the same ring put their names on top of each other
 *  ("Cephalophus" over "Tragelaphus" at the foot of the fan). Each label, in reading order,
 *  takes the nearest free spot: its own side, a small shift, the other side of the dot, then
 *  larger shifts on either side. The text moves, never the dot, so it stays on its branch
 *  (the same pass Lineage's natural view runs). Trying every shift on one side before the
 *  other side sent a label 40px down when the other side of its dot was free. */
export function placeCladeLabels(canvas: HTMLElement): void {
  const c = canvas.getBoundingClientRect();
  const rect = (el: Element): R => {
    const r = el.getBoundingClientRect();
    return { x: r.left - c.left - GAP, y: r.top - c.top - GAP, w: r.width + 2 * GAP, h: r.height + 2 * GAP };
  };
  const labels = [...canvas.querySelectorAll<HTMLElement>(".clado-pt.is-clade")];
  const textRect = (el: HTMLElement): R => {
    const parts = [...el.querySelectorAll(".pt-name, .pt-rank")].map((p) => p.getBoundingClientRect());
    const l = Math.min(...parts.map((p) => p.left)), t = Math.min(...parts.map((p) => p.top));
    const r = Math.max(...parts.map((p) => p.right)), b = Math.max(...parts.map((p) => p.bottom));
    return { x: l - c.left - GAP, y: t - c.top - GAP, w: r - l + 2 * GAP, h: b - t + 2 * GAP };
  };
  const dots = [...canvas.querySelectorAll(".clado-pt .pt-dot")].map((d) => ({ d, r: rect(d) }));
  const placed: R[] = [];
  // Nearest first: [other side?, vertical shift].
  const SPOTS: Array<[boolean, number]> = [
    [false, 0], [false, -14], [false, 14], [true, 0], [true, -14], [true, 14],
    [false, -28], [false, 28], [true, -28], [true, 28], [false, -42], [false, 42], [true, -42], [true, 42],
  ];
  const ordered = labels
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left)
    .map(({ el }) => el);
  for (const el of ordered) {
    const own = el.querySelector(".pt-dot");
    const others = dots.filter(({ d }) => d !== own).map(({ r }) => r);
    const clear = () => { const r = textRect(el); return !placed.some((p) => hit(r, p)) && !others.some((d) => hit(r, d)); };
    const other = el.classList.contains("is-flip") ? "r" : "l";
    let done = false;
    for (const [flip, dy] of SPOTS) {
      if (flip) el.setAttribute("data-side", other); else el.removeAttribute("data-side");
      el.style.setProperty("--ly", `${dy}px`);
      if (clear()) { done = true; break; }
    }
    if (!done) { el.removeAttribute("data-side"); el.style.removeProperty("--ly"); }
    placed.push(textRect(el));
  }
}

/** THEN LEAF BOXES: slide any that overlaps a clade label (or an earlier box) outward along its
 *  own branch until it is clear. The boxes carry no branch-anchored dot, so moving them along
 *  the ray reads naturally. `max` is the furthest a box may slide: 40 left a crowded tile stuck
 *  under its neighbour once boards grew, 120 clears three quarters of what the labels leave. */
export function nudgeLeafBoxes(
  canvas: HTMLElement,
  tiles: Map<string, HTMLElement>,
  nodeById: Map<string, GraphNode>,
  max = 120,
  /** The drawing's zoom, when its wrapper is scaled (a box's offset is in drawing units, its
   *  collisions are measured on screen). Boxes keep their screen size via `--cz`. */
  zoom = 1
): void {
  const c = canvas.getBoundingClientRect();
  const rect = (el: Element): R => {
    const r = el.getBoundingClientRect();
    return { x: r.left - c.left - GAP, y: r.top - c.top - GAP, w: r.width + 2 * GAP, h: r.height + 2 * GAP };
  };
  const obstacles: R[] = [...canvas.querySelectorAll(".clado-pt")].map(rect);
  const STEP = 8;
  for (const id of [...tiles.keys()].sort()) {
    const el = tiles.get(id)!;
    const node = nodeById.get(id);
    if (!node) continue;
    const ox = node.ox ?? 0, oy = node.oy ?? 0;
    let r = rect(el), delta = 0;
    while (delta < max && obstacles.some((o) => hit(r, o))) {
      delta += STEP;
      r = { x: r.x + ox * STEP, y: r.y + oy * STEP, w: r.w, h: r.h };
    }
    const d = delta / zoom;
    if (delta > 0) el.style.transform = `translate(calc(-50% + ${(ox * d).toFixed(1)}px), calc(-50% + ${(oy * d).toFixed(1)}px)) scale(var(--cz, 1))`;
    obstacles.push(r); // this box is now an obstacle for the ones after it
  }
}
