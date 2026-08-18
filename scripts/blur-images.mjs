// BLUR game — build the progressive-reveal image ladder for a species.
//
// WHY DOWNSAMPLE RATHER THAN BLUR. The other games fetch Wikipedia images live and show them
// at full size, which is fine when the picture is the reward. Here the picture IS the puzzle,
// and a CSS `filter: blur()` over a full-resolution image hides nothing: the bytes still
// contain the animal, the filter is one devtools toggle away, and the Wikipedia filename sits
// in the DOM naming the answer outright.
//
// A 10-pixel-wide JPEG does not contain the animal. No client-side trick recovers what was
// never sent. Upscaled into the frame the browser's own smoothing makes it read as a blur, so
// it looks the same and is actually true. Each guess serves the next rung up.
//
// Licence metadata is captured HERE, at build time, because the attribution has to be shown
// on solve and the runtime never sees the Commons file page.
//
//   node scripts/blur-images.mjs --out <dir> [--species "A,B,C"]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

const REST = "https://en.wikipedia.org/api/rest_v1/page/summary/";
const API = "https://en.wikipedia.org/w/api.php";
const UA = "GrebeGames/1.0 (blur ladder; contact via github.com/nkempynck/grebe)";

/** Widths in pixels. Rung 0 is what you see before guessing; each guess reveals the next.
 *  Geometric rather than linear — the early rungs are where the puzzle lives, and going
 *  8→12 changes far more than 80→84 does.
 *
 *  Starting at 10 with a ratio of 1.5 was far too fast: a flamingo is solved at rung 0 on
 *  colour and silhouette alone, and by rung 2 (22px) half a test set was identifiable. The
 *  ratio is now ~1.33 from a much blurrier 3px, which puts the interesting part of the curve
 *  where the guesses actually are. 0 = full resolution, which is the reveal, not a rung. */
export const LADDER = [3, 4, 6, 8, 11, 15, 20, 26, 34, 45, 60, 80, 106, 0];

/** Tiles per side for the SHUFFLE mechanic, hardest first. Blur and shuffle destroy opposite
 *  halves of the picture: blur keeps low frequencies (silhouette, colour mass) and throws away
 *  texture, which is why an 11px bobcat is a brown smear. Shuffling keeps every pixel at full
 *  detail — spotted fur, scales, an eye — and throws away global shape. For naming a species
 *  that is probably the better trade, and it means there is always SOMETHING to look at rather
 *  than a beige square you can only wait out. */
export const SHUFFLE_LADDER = [10, 8, 6, 5, 4, 3, 2];

/** Side of the square the shuffle works on. Deliberately not full resolution: shuffling leaves
 *  every byte in the client, so unlike downsampling it is only cosmetic hiding, and rendering
 *  at a modest size limits what reassembling would actually win you. */
const SHUFFLE_SIZE = 640;

function shuffleRng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); let a = (h ^= h >>> 16) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One shuffled rung: the square cut into grid x grid tiles, deterministically rearranged. */
export async function shuffledFor(buf, grid, seed) {
  const meta = await sharp(buf).rotate().metadata();
  const side = Math.min(meta.width ?? SHUFFLE_SIZE, meta.height ?? SHUFFLE_SIZE);
  const square = await sharp(buf).rotate()
    .resize(side, side, { fit: "cover", position: "attention" })
    .resize(SHUFFLE_SIZE, SHUFFLE_SIZE, { fit: "fill" })
    .jpeg({ quality: 90 }).toBuffer();
  const t = Math.floor(SHUFFLE_SIZE / grid);
  const tiles = [];
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid; x++)
      tiles.push(await sharp(square).extract({ left: x * t, top: y * t, width: t, height: t }).toBuffer());
  const order = tiles.map((_, i) => i);
  const rnd = shuffleRng(seed);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return sharp({ create: { width: grid * t, height: grid * t, channels: 3, background: { r: 12, g: 12, b: 12 } } })
    .composite(order.map((src, dst) => ({ input: tiles[src], left: (dst % grid) * t, top: Math.floor(dst / grid) * t })))
    .jpeg({ quality: 86 }).toBuffer();
}

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wikipedia rate-limits bursts hard, and each species costs THREE requests (summary, licence,
// the image itself). A per-species pause is the wrong knob: it still lets those three go out
// back to back. This is a global floor on the gap between ANY two requests, which is what
// actually keeps a long run alive — and a pin run will ask for hundreds of species.
const MIN_REQUEST_GAP_MS = 350;
let lastRequest = 0;
async function throttled(url, headers) {
  const wait = lastRequest + MIN_REQUEST_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequest = Date.now();
  return fetch(url, { headers });
}

/** Back off and retry rather than dropping the species. */
async function j(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const r = await throttled(url, { "user-agent": UA, accept: "application/json" });
    if (r.ok) return r.json();
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; }
    throw new Error(`${r.status} ${url.slice(0, 90)}`);
  }
  throw new Error(`gave up after ${tries} tries: ${url.slice(0, 90)}`);
}

/** Lead image URL + the Commons file title, for a Wikipedia article title. */
async function leadImage(title) {
  const s = await j(REST + encodeURIComponent(title.replace(/ /g, "_")));
  const src = s?.originalimage?.source ?? s?.thumbnail?.source;
  if (!src) return null;
  // .../commons/thumb/a/ab/Some_File.jpg/3840px-Some_File.jpg?utm_source=… → "File:Some_File.jpg"
  // The query string is NOT decorative: Wikipedia now appends utm_* params, and leaving them
  // on the derived title made every single licence lookup come back `missing`.
  const file = decodeURIComponent(src.split("?")[0].split("/").pop().replace(/^\d+px-/, ""));
  return { src, file: `File:${file}`, pageTitle: s.title };
}

/** Author + licence for a Commons file, so the solve screen can credit it.
 *
 *  THROWS rather than returning blanks. These images are CC-licensed and attribution is a
 *  condition of use, so a species we cannot credit is a species we cannot ship. An earlier
 *  version swallowed every failure and returned nulls, and a transient rate-limit then lost
 *  the credit for an image that was otherwise perfectly usable — silently, which is the worst
 *  way to get this wrong. */
async function attribution(fileTitle) {
  const url = `${API}?action=query&format=json&prop=imageinfo&iiprop=extmetadata|url` +
    `&titles=${encodeURIComponent(fileTitle)}`;
  const d = await j(url);
  const page = Object.values(d?.query?.pages ?? {})[0];
  // `missing` is NOT the test. Most of these files live on Commons, and en.wikipedia reports
  // a Commons file as missing (there is no LOCAL page: imagerepository === "shared") while
  // still returning full imageinfo. Rejecting on `missing` threw away the credit for seven of
  // twelve images that were perfectly well documented.
  if (!page?.imageinfo?.length) throw new Error(`no image info for ${fileTitle}`);
  const m = page.imageinfo[0].extmetadata ?? {};
  const strip = (v) => (v?.value ?? "").replace(/<[^>]*>/g, "").trim() || null;
  const licence = strip(m.LicenseShortName);
  if (!licence) throw new Error(`no licence recorded for ${fileTitle}`);
  return {
    artist: strip(m.Artist),
    licence,
    credit: strip(m.Credit),
    filePage: page.imageinfo[0].descriptionurl ?? null,
  };
}

/** The ladder for one image buffer: JPEGs at each width, square-cropped so every rung frames
 *  the subject identically (a changing aspect ratio is itself a clue). */
export async function ladderFor(buf, widths = LADDER) {
  const out = [];
  for (const w of widths) {
    const img = sharp(buf).rotate();
    const meta = await img.metadata();
    const side = Math.min(meta.width ?? 512, meta.height ?? 512);
    let pipe = sharp(buf).rotate().resize(side, side, { fit: "cover", position: "attention" });
    if (w) pipe = pipe.resize(w, w, { fit: "fill", kernel: "lanczos3" });
    out.push({ width: w || side, buf: await pipe.jpeg({ quality: w && w <= 33 ? 92 : 82 }).toBuffer() });
  }
  return out;
}

/** Source image + licence, cached on disk. Tuning the ladder is an iterative business and the
 *  original photo never changes, so a re-run should cost zero requests. */
async function source(title, cacheDir) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const meta = resolve(cacheDir, `${slug}.src.json`);
  const bin = resolve(cacheDir, `${slug}.src.bin`);
  if (existsSync(meta) && existsSync(bin)) {
    return { ...JSON.parse(readFileSync(meta, "utf8")), buf: readFileSync(bin) };
  }
  const lead = await leadImage(title);
  if (!lead) return null;
  const res = await throttled(lead.src, { "user-agent": UA });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const attr = await attribution(lead.file);
  writeFileSync(bin, buf);
  writeFileSync(meta, JSON.stringify({ lead, attribution: attr }));
  return { lead, attribution: attr, buf };
}

export async function buildFor(title, cacheDir, widths = LADDER) {
  const s = await source(title, cacheDir);
  if (!s) return null;
  return { title, lead: s.lead, attribution: s.attribution, rungs: await ladderFor(s.buf, widths) };
}

// ---- CLI ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const DEFAULT = [
    "Lion", "Giant panda", "Plains zebra", "Emperor penguin", "American flamingo",
    "Monarch butterfly", "Great white shark", "Common sunflower", "Corn snake",
    "Common chiffchaff", "Harbour porpoise", "Atlantic salmon",
  ];
  const names = (arg("species") ?? DEFAULT.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
  const outDir = arg("out", "node_modules/.cache/blur");
  mkdirSync(outDir, { recursive: true });

  const built = [];
  for (const n of names) {
    process.stderr.write(`  ${n} … `);
    try {
      const b = await buildFor(n, outDir);
      if (!b) { process.stderr.write("no image\n"); continue; }
      built.push(b);
      const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      b.rungs.forEach((r, i) => writeFileSync(resolve(outDir, `${slug}-${i}-${r.width}.jpg`), r.buf));
      process.stderr.write(`${b.rungs.map((r) => `${r.width}px:${(r.buf.length / 1024).toFixed(1)}k`).join(" ")}\n`);
    } catch (e) { process.stderr.write(`FAILED ${e.message}\n`); }
  }
  writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(
    built.map((b) => ({ title: b.title, file: b.lead.file, ...b.attribution,
      rungs: b.rungs.map((r) => ({ width: r.width, bytes: r.buf.length })) })), null, 2));

  console.error(`\n${built.length}/${names.length} built into ${outDir}`);
}
