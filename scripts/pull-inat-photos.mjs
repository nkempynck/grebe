// Build the species photo map: a CC-licensed iNaturalist photograph for every species we
// can reach, baked into src/data/speciesPhotos.json so play needs no image API at runtime.
//
// WHY NOT WIKIPEDIA'S LEAD IMAGE. An article's lead is chosen to be INFORMATIVE, which is
// not the same as being a picture of the animal: a range map, a pinned museum specimen, a
// 19th-century botanical plate, a market stall, a tree photographed from fifty metres. In a
// blind side-by-side over 30 species those lost to iNaturalist 20-10, and the cases where
// Wikipedia lost were the ones where it lost badly.
//
// HOW THE JOIN WORKS, AND WHY IT COSTS NOTHING. Our species ids ARE GBIF backbone usage
// keys, so there is no name matching to get wrong: Wikidata carries both the GBIF id (P846)
// and the iNaturalist taxon id (P3151) on the same item, ~685k taxa deep. Name matching was
// the alternative and it was worse in both directions — one request per species instead of
// thirty, and a 6% miss rate on synonyms (Myodes glareolus, Dasyatis sabina) that the id
// bridge simply does not have.
//
// LICENCE IS DECIDED BY THE HOSTNAME, not by a field we have to trust. iNaturalist serves
// CC-licensed photos from the AWS open-data bucket and all-rights-reserved ones from
// static.inaturalist.org; a photo is in one or the other. We keep only the open-data bucket,
// so an unlicensable photo cannot enter the file by any route. ND is dropped on top of that:
// Mosaic downsamples and tile-shuffles its photograph, which is a derivative work, and it is
// cheaper to keep one pool every game may use than to track which game may use which photo.
//
//   node scripts/pull-inat-photos.mjs [--limit N] [--fresh]
//   cache: node_modules/.cache/inat-photos.json
//   out:   src/data/speciesPhotos.json (one per species) + speciesPhotosAlt.json (the rest)
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_DIR = resolve(ROOT, "node_modules/.cache");
const CACHE = resolve(CACHE_DIR, "inat-photos.json");
const OUT = resolve(ROOT, "src/data/speciesPhotos.json");
const OUT_ALT = resolve(ROOT, "src/data/speciesPhotosAlt.json");
const UA = "GrebeGames/1.0 (species photo map; https://github.com/nkempynck/grebe)";
const WDQS = "https://query.wikidata.org/sparql";
const INAT = "https://api.inaturalist.org/v1";
const OPEN_BUCKET = "inaturalist-open-data";

/** Licences we will not ship. ND forbids distributing a modified version, and Mosaic
 *  modifies. Everything else in the open-data bucket is fine for a free game. */
const BANNED = /-nd\b|-nd$/i;
/** Photos below this on the long side cannot serve Mosaic, which renders at 1024. */
const MIN_LONG_SIDE = 800;
/** Alternates per species: one to show, two to fall back on when a photo turns out to be
 *  misidentified or simply bad. Cheap at ~50 bytes each, and it is the override lever. */
const KEEP = 3;

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d;
};
const has = (n) => process.argv.includes(`--${n}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the species we need pictures for ----
const load = (p) => {
  const j = JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
  return (j.nodes ?? j).filter((n) => n.rank === "species");
};
let species = [...load("src/data/taxonomy.json"), ...load("src/data/taxonomyAugment.json")];
const limit = Number(arg("limit", "0"));
if (limit) species = species.slice(0, limit);

// Three id shapes, three bridges. The first covers seven in eight.
const gbifOf = (id) => (/^\d+$/.test(id) ? id : /^aug\d+$/.test(id) ? id.slice(3) : null);
const qidOf = (id) => (/^augQ\d+$/.test(id) ? id.slice(3) : null);

const byGbif = new Map(); // gbif key -> [species]
const byQid = new Map();  // wikidata qid -> [species]
const byName = [];        // no external id at all (OTT-only nodes): fall back to a name search
const push = (map, key, value) => {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
};
for (const s of species) {
  const g = gbifOf(s.id), q = qidOf(s.id);
  // The same GBIF key appears in both trees (base and augment), so a key maps to a LIST:
  // one lookup, two species ids to fill in.
  if (g) push(byGbif, g, s);
  else if (q) push(byQid, q, s);
  else byName.push(s);
}

console.error(`species: ${species.length} (${byGbif.size} by GBIF key, ${byQid.size} by QID, ${byName.length} by name)`);

// ---- cache ----
mkdirSync(CACHE_DIR, { recursive: true });
const cache = !has("fresh") && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
cache.inatIdByGbif ??= {};
cache.inatIdByQid ??= {};
cache.inatIdByName ??= {};
cache.taxa ??= {}; // iNat taxon id -> kept photos
const flush = () => writeFileSync(CACHE, JSON.stringify(cache));

// ---- phase 1: resolve to iNaturalist taxon ids ----
async function sparql(query, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(WDQS, {
        method: "POST",
        headers: { "user-agent": UA, accept: "application/sparql-results+json",
          "content-type": "application/sparql-query" },
        body: query,
      });
      if (r.ok) return (await r.json()).results.bindings;
      if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
      console.error(`  WDQS ${r.status}`);
      return null;
    } catch { await sleep(3000 * (i + 1)); }
  }
  return null;
}

/** VALUES blocks get sent in chunks: one query for 6,983 ids is refused, and a chunk that
 *  fails costs only its own ids rather than the whole run. */
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function resolveByProperty(ids, prop, store, label) {
  const todo = ids.filter((id) => store[id] === undefined);
  if (!todo.length) { console.error(`${label}: all ${ids.length} cached`); return; }
  console.error(`${label}: ${todo.length} to resolve`);
  let done = 0;
  for (const part of chunk(todo, 400)) {
    const values = part.map((v) => (prop === "P846" ? `"${v}"` : `wd:${v}`)).join(" ");
    const q = prop === "P846"
      ? `SELECT ?k ?inat WHERE { VALUES ?k { ${values} } ?t wdt:P846 ?k ; wdt:P3151 ?inat . }`
      : `SELECT ?k ?inat WHERE { VALUES ?t { ${values} } ?t wdt:P3151 ?inat . BIND(STRAFTER(STR(?t), "entity/") AS ?k) }`;
    const rows = await sparql(q);
    if (rows) for (const b of rows) store[b.k.value] = b.inat.value;
    // A key with no answer is cached as null so a re-run does not ask Wikidata again.
    for (const id of part) store[id] ??= null;
    done += part.length;
    process.stderr.write(`  ${done}/${todo.length}\r`);
    flush();
    await sleep(800);
  }
  process.stderr.write("\n");
}

async function jget(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
      if (r.ok) return r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

/** Last resort for the handful of nodes carrying neither a GBIF key nor a QID. */
async function resolveByName(list) {
  const todo = list.filter((s) => cache.inatIdByName[s.sciName] === undefined);
  if (!todo.length) { console.error(`by name: all ${list.length} cached`); return; }
  console.error(`by name: ${todo.length} to resolve`);
  for (const s of todo) {
    await sleep(1100);
    const j = await jget(`${INAT}/taxa?q=${encodeURIComponent(s.sciName)}&rank=species&per_page=5`);
    const hit = j?.results?.find((t) => t.name.toLowerCase() === s.sciName.toLowerCase());
    cache.inatIdByName[s.sciName] = hit ? String(hit.id) : null;
    flush();
  }
}

await resolveByProperty([...byGbif.keys()], "P846", cache.inatIdByGbif, "by GBIF key");
await resolveByProperty([...byQid.keys()], "QID", cache.inatIdByQid, "by QID");
await resolveByName(byName);

// species id -> iNat taxon id
const inatIdBySpecies = new Map();
for (const [g, list] of byGbif) { const t = cache.inatIdByGbif[g]; if (t) for (const s of list) inatIdBySpecies.set(s.id, t); }
for (const [q, list] of byQid) { const t = cache.inatIdByQid[q]; if (t) for (const s of list) inatIdBySpecies.set(s.id, t); }
for (const s of byName) { const t = cache.inatIdByName[s.sciName]; if (t) inatIdBySpecies.set(s.id, t); }
console.error(`resolved ${inatIdBySpecies.size}/${species.length} species to an iNaturalist taxon`);

// ---- phase 2: the photographs, thirty taxa per request ----
/** Keep only what the client needs to build a URL and print a credit. The extension is
 *  stored only when it is not jpg, which is the overwhelming majority. */
function keepPhotos(taxon) {
  const out = [];
  for (const tp of taxon.taxon_photos ?? []) {
    const p = tp.photo;
    if (!p?.url || !p.url.includes(OPEN_BUCKET)) continue;      // all-rights-reserved lives elsewhere
    if (!p.license_code || BANNED.test(p.license_code)) continue;
    const w = p.original_dimensions?.width ?? 0, h = p.original_dimensions?.height ?? 0;
    if (Math.max(w, h) < MIN_LONG_SIDE) continue;
    const id = Number((p.url.match(/\/photos\/(\d+)\//) ?? [])[1]);
    if (!id) continue;
    const ext = ((p.url.split("?")[0].match(/\.([a-z0-9]+)$/i) ?? [])[1] ?? "jpg").toLowerCase();
    if (out.some((o) => o.p === id)) continue;
    out.push({ p: id, l: p.license_code, by: p.attribution_name ?? null, w, h, ...(ext === "jpg" ? {} : { e: ext }) });
    if (out.length >= KEEP) break;
  }
  return out;
}

const wanted = [...new Set(inatIdBySpecies.values())].filter((t) => cache.taxa[t] === undefined);
console.error(`photos: ${wanted.length} taxa to fetch (${[...new Set(inatIdBySpecies.values())].length - wanted.length} cached)`);
let fetched = 0;
for (const part of chunk(wanted, 30)) {
  await sleep(1100);
  const j = await jget(`${INAT}/taxa/${part.join(",")}`);
  if (j?.results) for (const t of j.results) cache.taxa[String(t.id)] = keepPhotos(t);
  // Anything the batch did not return gets an empty list rather than being asked for forever.
  for (const t of part) cache.taxa[t] ??= [];
  fetched += part.length;
  process.stderr.write(`  ${fetched}/${wanted.length}\r`);
  flush();
}
process.stderr.write("\n");

// ---- phase 3: write the maps ----
//
// SPLIT BY HOW THEY ARE USED, not by species. A board reads ONE photo per species and the
// alternates exist for the rare moment someone pages through them, so shipping all three in
// one file made every player download roughly 18,600 records to read sixteen. The primary
// file is what the games load; the alternates are a second chunk that downloads only when a
// player actually opens the pager, which most never will.
const photos = {};   // species id -> the one photo the games show
const alts = {};     // species id -> the rest, same order
let withPhoto = 0, altCount = 0, licences = {};
for (const s of species) {
  const t = inatIdBySpecies.get(s.id);
  const list = t ? cache.taxa[t] ?? [] : [];
  if (!list.length) continue;
  photos[s.id] = list[0];
  if (list.length > 1) { alts[s.id] = list.slice(1); altCount += list.length - 1; }
  withPhoto++;
  for (const p of list) licences[p.l] = (licences[p.l] ?? 0) + 1;
}
const NOTE = "CC-licensed iNaturalist photos. URL: https://inaturalist-open-data.s3.amazonaws.com/photos/<p>/<size>.<e|jpg>, size in square|small|medium|large|original.";
const built = new Date().toISOString().slice(0, 10);
writeFileSync(OUT, JSON.stringify({ built, note: NOTE, photos }));
writeFileSync(OUT_ALT, JSON.stringify({ built, note: `${NOTE} Alternates only; the first photo of each species is in speciesPhotos.json.`, photos: alts }));

const kb = (o) => (JSON.stringify(o).length / 1024).toFixed(0);
console.error(`\n${withPhoto}/${species.length} species have a CC photo (${(100 * withPhoto / species.length).toFixed(1)}%)`);
console.error(`licences: ${Object.entries(licences).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.error(`${OUT} — ${withPhoto} photos, ${kb({ photos })} KB raw`);
console.error(`${OUT_ALT} — ${altCount} alternates, ${kb({ photos: alts })} KB raw`);
