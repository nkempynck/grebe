// Stage Blur's ladder images for local play: work out each day's answer, build its ladder, and
// write it under public/blur/<date>/<rung>.jpg so the dev server can serve it.
//
// PROTOTYPE SCAFFOLDING. In production these belong in object storage, written at pin time and
// addressed by a neutral name so the URL gives nothing away — public/ is fine for playtesting
// on a laptop and is gitignored. The neutral naming is not cosmetic even here: the whole point
// of the game is that the client is never sent anything that identifies the answer, so the
// filename is the rung index and nothing else.
//
//   node scripts/blur-stage.mjs [--from 2026-08-18] [--days 14]
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const shift = (d, n) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

// The answer picker lives in TypeScript, so bundle it once and ask it for the schedule.
const bundle = resolve(ROOT, "node_modules/.cache/blur-schedule.mjs");
const entry = resolve(ROOT, "node_modules/.cache/blur-schedule-entry.ts");
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, `
import taxonomy from "${resolve(ROOT, "src/data/taxonomy.json")}";
import { buildTree } from "${resolve(ROOT, "src/core/index.ts")}";
import { blurAnswerFor, BLUR_LADDER } from "${resolve(ROOT, "src/core/blur.ts")}";
const tree = buildTree((taxonomy as any).nodes);
const out: any[] = [];
for (const d of process.argv[2].split(",")) {
  const id = blurAnswerFor(tree, d);
  const n = id ? tree.byId.get(id) : null;
  out.push({ date: d, id, common: n?.common ?? null, sci: n?.sciName ?? null });
}
process.stdout.write(JSON.stringify({ days: out, ladder: [...BLUR_LADDER] }));
`);
execFileSync("npx", ["esbuild", entry, "--bundle", "--platform=node", "--format=esm",
  "--define:import.meta.env={}", "--loader:.json=json", "--external:@supabase/supabase-js",
  `--outfile=${bundle}`], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });

const from = arg("from", new Date().toISOString().slice(0, 10));
const days = Number(arg("days", "14"));
const dates = Array.from({ length: days }, (_, i) => shift(from, i));
const { days: schedule, ladder } = JSON.parse(execFileSync("node", [bundle, dates.join(",")], { cwd: ROOT }).toString());

const { buildFor, shuffledFor, SHUFFLE_LADDER } = await import(resolve(ROOT, "scripts/blur-images.mjs"));
const cache = resolve(ROOT, "node_modules/.cache/blur");
mkdirSync(cache, { recursive: true });
const index = {};
for (const d of schedule) {
  if (!d.id) { console.error(`  ${d.date}  no answer`); continue; }
  const title = d.common ?? d.sci;
  const dir = resolve(ROOT, "public/blur", d.date);
  if (existsSync(resolve(dir, "0.jpg"))) { console.error(`  ${d.date}  ${title} (cached)`); index[d.date] = d; continue; }
  process.stderr.write(`  ${d.date}  ${title} … `);
  try {
    // The SHIPPING ladder, not the research continuum blur-images defaults to.
    // ladder + 0: the rungs you play against, plus full resolution for the reveal.
    const built = await buildFor(title, cache, [...ladder, 0]);
    if (!built) { process.stderr.write("no image\n"); continue; }
    mkdirSync(dir, { recursive: true });
    // Rung files are named by INDEX only. Never by species, never by pixel width — the
    // network tab is part of the game's surface.
    built.rungs.forEach((r, i) => writeFileSync(resolve(dir,
      i === built.rungs.length - 1 ? "full.jpg" : `${i}.jpg`), r.buf));
    // The shuffle variant of the same photo, so both mechanics can be compared on one board.
    const src = built.rungs[built.rungs.length - 1].buf; // full-resolution rung
    for (let i = 0; i < SHUFFLE_LADDER.length; i++)
      writeFileSync(resolve(dir, `s${i}.jpg`), await shuffledFor(src, SHUFFLE_LADDER[i], `${d.date}:${i}`));
    writeFileSync(resolve(dir, "credit.json"), JSON.stringify(built.attribution));
    index[d.date] = d;
    process.stderr.write(`${built.rungs.length} rungs\n`);
  } catch (e) {
    process.stderr.write(`FAILED ${e.message}\n`);
  }
}
// An index the prototype UI reads so its "new sample" button knows what exists locally.
writeFileSync(resolve(ROOT, "public/blur/index.json"), JSON.stringify(Object.keys(index).sort()));
console.error(`\nstaged ${Object.keys(index).length}/${schedule.length} days into public/blur/`);
