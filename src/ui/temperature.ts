// Maps warmth (0..1) to the cold->warm->hit color scale used across the UI.

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function hex(n: number) { return Math.round(n).toString(16).padStart(2, "0"); }

// "Specimen at dusk" axis on a warm indigo ground:
// cold = distant clade (teal), warm = close relative (terracotta),
// hit = the specimen itself (bright gold — a different hue so a win pops).
const COLD = [0x57, 0x9d, 0xac];
const WARM = [0xdd, 0x77, 0x51];
const HIT = [0xf2, 0xc1, 0x4e];

export function warmthColor(warmth: number, isWin: boolean): string {
  if (isWin) return `#${hex(HIT[0])}${hex(HIT[1])}${hex(HIT[2])}`;
  const t = Math.max(0, Math.min(1, warmth));
  const c = [0, 1, 2].map((i) => lerp(COLD[i], WARM[i], t));
  return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`;
}

export function warmthLabel(warmth: number, isWin: boolean): string {
  if (isWin) return "Found";
  if (warmth >= 0.85) return "Scalding";
  if (warmth >= 0.65) return "Hot";
  if (warmth >= 0.45) return "Warm";
  if (warmth >= 0.25) return "Cool";
  return "Cold";
}
