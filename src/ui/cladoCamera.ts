/** The natural view's camera: screen = canvas × k + (tx, ty), in stage pixels. */
export interface Camera {
  k: number;
  tx: number;
  ty: number;
}

/** Two touch points' spread and midpoint, in the same (client) pixels as the points. */
export interface Spread {
  d: number;
  mx: number;
  my: number;
}

export const spreadOf = (a: { x: number; y: number }, b: { x: number; y: number }): Spread => ({
  d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
  mx: (a.x + b.x) / 2,
  my: (a.y + b.y) / 2,
});

/** The camera partway through a pinch that started at `from` with camera `base`: the zoom
 *  follows the change in spread, and the canvas point that was between the fingers stays
 *  between them, so moving both fingers pans. `left`/`top` are the stage's client offset. */
export function pinchCamera(
  base: Camera,
  from: Spread,
  now: Spread,
  left: number,
  top: number,
  clamp: (k: number) => number
): Camera {
  const k = clamp(base.k * (now.d / from.d));
  const cx = (from.mx - left - base.tx) / base.k;
  const cy = (from.my - top - base.ty) / base.k;
  return { k, tx: now.mx - left - cx * k, ty: now.my - top - cy * k };
}
