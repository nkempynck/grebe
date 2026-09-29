import { describe, expect, it } from "vitest";
import { pinchCamera, spreadOf, type Camera } from "./cladoCamera";

const free = (k: number) => k;
const toScreen = (c: Camera, x: number, y: number, left: number, top: number) => ({
  x: left + x * c.k + c.tx,
  y: top + y * c.k + c.ty,
});

describe("pinchCamera", () => {
  const base: Camera = { k: 1.5, tx: -40, ty: 25 };
  const left = 30, top = 200;

  it("is the identity before the fingers move", () => {
    const s = spreadOf({ x: 100, y: 300 }, { x: 220, y: 380 });
    expect(pinchCamera(base, s, s, left, top, free)).toEqual(base);
  });

  it("scales the zoom by the change in spread", () => {
    const from = spreadOf({ x: 100, y: 300 }, { x: 200, y: 300 });
    const now = spreadOf({ x: 50, y: 300 }, { x: 250, y: 300 });
    expect(pinchCamera(base, from, now, left, top, free).k).toBeCloseTo(3);
  });

  it("keeps the canvas point under the fingers under them, through a zoom and a pan", () => {
    const from = spreadOf({ x: 100, y: 300 }, { x: 200, y: 340 });
    const now = spreadOf({ x: 140, y: 250 }, { x: 330, y: 330 });
    const cam = pinchCamera(base, from, now, left, top, free);
    // The canvas point that was at the starting midpoint...
    const cx = (from.mx - left - base.tx) / base.k;
    const cy = (from.my - top - base.ty) / base.k;
    // ...is now at the current midpoint.
    const p = toScreen(cam, cx, cy, left, top);
    expect(p.x).toBeCloseTo(now.mx);
    expect(p.y).toBeCloseTo(now.my);
  });

  it("respects the zoom clamp", () => {
    const from = spreadOf({ x: 0, y: 0 }, { x: 10, y: 0 });
    const now = spreadOf({ x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(pinchCamera(base, from, now, left, top, (k) => Math.min(10, k)).k).toBe(10);
  });

  it("survives both fingers on the same pixel", () => {
    const s = spreadOf({ x: 5, y: 5 }, { x: 5, y: 5 });
    const cam = pinchCamera(base, s, s, left, top, free);
    expect(Number.isFinite(cam.k) && Number.isFinite(cam.tx) && Number.isFinite(cam.ty)).toBe(true);
  });
});
