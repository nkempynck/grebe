// Where the genera of every augment-created FAMILY really belong, from Open Tree's synthetic tree,
// written to the committed scripts/augment-anchors.json that build-augment.mjs --fix-only reads.
//
// WHY. build-augment phase 3 adds a family the base tree has no NAMED node for under its nearest
// named ancestor. For many families the base tree already held other members of that family in an
// unnamed clade, so the family appeared twice: a flat bag of new genera beside the real clade.
// New parrots sat in a "Psittacidae" bag next to Psittacoidea, so a lovebird and an amazon read
// as one family while an amazon and a macaw read as merely one order.
//
// HOW. Our clade ids ARE synthetic-tree node ids (the tree is an induced subtree of the release
// in taxonomy.json provenance), so each species' synthetic lineage names the exact base-tree node
// it belongs under: the first ancestor that exists in the base tree. A genus goes to the base-tree
// MRCA of its species' anchors. Guard: an anchor must lie inside the node the family already hangs
// under (a wrong match can only leave a genus where it is), and the synthetic release must be the
// one the tree was built from, or node ids would not line up.
//
//   node scripts/pull-augment-anchors.mjs
//   reads: src/data/taxonomy.json, src/data/taxonomyAugment.json
//   writes: scripts/augment-anchors.json  { synth, byGenus: { "<genus node id>": "<anchor id>" | null } }
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "scripts/augment-anchors.json");
const OTL = "https://api.opentreeoflife.org/v3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const base = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const aug = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomyAugment.json"), "utf8"));
const baseById = new Map(base.nodes.map((n) => [n.id, n]));
const all = [...base.nodes, ...aug.nodes];
const byId = new Map(all.map((n) => [n.id, n]));
const kids = new Map();
for (const n of all) if (n.parentId != null) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)).push(n);

async function post(path, body, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${OTL}/${path}`, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1)); continue; }
      return null; // 400: not in the synthetic tree (pruned or broken) — no answer, not an error
    } catch { await sleep(1000 * (i + 1)); }
  }
  return null;
}

const want = base.provenance?.otlSynthRelease;
const about = await post("tree_of_life/about", {});
if (!want || about?.synth_id !== want) {
  console.error(`synthetic release mismatch: tree built on ${want}, API serves ${about?.synth_id}. Node ids would not line up; refusing.`);
  process.exit(1);
}

const ancestors = (id) => { const out = []; for (let c = id; c; c = baseById.get(c)?.parentId) out.push(c); return out; };
const mrcaOf = (ids) => {
  let common = ancestors(ids[0]);
  for (const id of ids.slice(1)) { const a = new Set(ancestors(id)); common = common.filter((c) => a.has(c)); }
  return common[0] ?? null;
};
const inside = (id, root) => ancestors(id).includes(root);

// Every genus directly under an augment-created family, with its species.
const families = aug.nodes.filter((n) => n.rank === "family");
const jobs = [];
for (const f of families)
  for (const g of kids.get(f.id) ?? []) {
    // A species directly under the family (the caiman lizard, moved there by the kingdom guard)
    // is placed like a genus of one.
    const species = g.rank === "species" ? [g] : (kids.get(g.id) ?? []).filter((s) => s.rank === "species");
    if ((g.rank === "genus" || g.rank === "species") && species.length) jobs.push({ genus: g, home: f.parentId, species });
  }
console.log(`${families.length} augment families, ${jobs.length} genera, ${jobs.reduce((s, j) => s + j.species.length, 0)} species to place (synth ${want})`);

// 1) species name -> ott id, exact matches only.
const ottOf = new Map();
const names = [...new Set(jobs.flatMap((j) => j.species.map((s) => s.sciName)))];
for (let i = 0; i < names.length; i += 100) {
  const doc = await post("tnrs/match_names", { names: names.slice(i, i + 100), do_approximate_matching: false });
  for (const r of doc?.results ?? []) {
    const m = r.matches.filter((x) => !x.is_synonym && x.taxon?.rank === "species");
    if (m.length === 1) ottOf.set(r.name, m[0].taxon.ott_id);
  }
  process.stderr.write(`  matched ${Math.min(i + 100, names.length)}/${names.length}\r`);
}
process.stderr.write("\n");

// 2) each species' first base-tree ancestor in the synthetic tree.
const anchorOfSpecies = new Map();
const queue = names.filter((n) => ottOf.has(n));
let qi = 0, done = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (qi < queue.length) {
    const sci = queue[qi++];
    const doc = await post("tree_of_life/node_info", { ott_id: ottOf.get(sci), include_lineage: true });
    const hit = (doc?.lineage ?? []).map((a) => a.node_id).find((id) => baseById.has(id));
    if (hit) anchorOfSpecies.set(sci, hit);
    if (++done % 50 === 0) process.stderr.write(`  placed ${done}/${queue.length}\r`);
  }
}));
process.stderr.write("\n");

// 3) A BAG is a family whose Open Tree taxon also holds base species outside it (the family is
//    already in the tree, unnamed): its genera move one by one to where their species sit. A
//    genuinely new family stays whole, and the family node itself moves if its genera agree on a
//    deeper home. Either way an anchor must be strictly deeper than the current home and inside
//    it, or nothing moves.
const L = JSON.parse(readFileSync(resolve(ROOT, "scripts/ott-lineages.json"), "utf8"));
const lineage = (sci) => { const out = new Set(); for (let t = L.species[sci]; t != null; t = L.taxa[t]?.[2]) out.add(String(t)); return out; };
const speciesUnder = (id) => { const out = []; const walk = (i) => { for (const k of kids.get(i) ?? []) { if (k.rank === "species") out.push(k); walk(k.id); } }; walk(id); return out; };
const baseSpecies = base.nodes.filter((n) => n.rank === "species");
const isBag = (f) => {
  const ott = f.id.replace(/^ott/, "");
  const mine = new Set(speciesUnder(f.id).map((s) => s.id));
  return baseSpecies.some((s) => !mine.has(s.id) && lineage(s.sciName).has(ott));
};
const deeper = (a, home) => a && a !== home && inside(a, home);
// Never INSIDE another genus. The synthetic tree nests genera in genera where a genus is not a
// natural group (Tanygnathus and Mascarinus sit inside Psittacula), and grafting there would put
// them under that genus's label. Climb to just above the outermost genus on the way up.
const rankOf = (id) => baseById.get(id)?.sepRank ?? baseById.get(id)?.rank;
const aboveGenera = (a) => {
  let out = a;
  for (const c of ancestors(a)) if (rankOf(c) === "genus" || rankOf(c) === "species") out = baseById.get(c).parentId;
  return out;
};
const genusAnchor = (j) => {
  const anchors = j.species.map((s) => anchorOfSpecies.get(s.sciName)).filter(Boolean);
  return anchors.length ? aboveGenera(mrcaOf(anchors)) : null;
};
const byGenus = {}, byFamily = {};
let bags = 0, moved = 0, famMoved = 0;
for (const f of families) {
  const mine = jobs.filter((j) => j.genus.parentId === f.id);
  if (isBag(f)) {
    // Every genus leaves the bag: the bag itself is the error. Where a genus's relatives sit at
    // the bag's own parent (no deeper base-tree node holds them, as for most pigeons), that
    // parent IS its place. A genus the synthetic tree cannot place goes to the base-tree MRCA of
    // the species sharing its nearest Open Tree ancestor, else to the parent.
    bags++;
    for (const j of mine) {
      const a = genusAnchor(j);
      let home = a && inside(a, f.parentId) ? a : null;
      if (!home) {
        const mineIds = new Set(speciesUnder(f.id).map((s) => s.sciName));
        for (const t of [...lineage(j.species[0].sciName)].slice(1)) {
          const kin = baseSpecies.filter((s) => !mineIds.has(s.sciName) && lineage(s.sciName).has(t));
          if (kin.length < 2) continue;
          const m = aboveGenera(mrcaOf(kin.map((s) => s.parentId)));
          if (m && inside(m, f.parentId)) home = m;
          break;
        }
      }
      byGenus[j.genus.id] = home ?? f.parentId;
      moved++;
    }
  } else {
    const anchors = mine.map(genusAnchor).filter(Boolean);
    const a = anchors.length === mine.length && anchors.length ? mrcaOf(anchors) : null;
    byFamily[f.id] = deeper(a, f.parentId) ? a : null;
    if (byFamily[f.id]) famMoved++;
  }
}
writeFileSync(OUT, JSON.stringify({ synth: want, byGenus, byFamily }, null, 0));
console.log(`✓ ${bags} bag families: ${moved} of their genera placed in the base tree; ` +
  `${families.length - bags} new families: ${famMoved} moved deeper. Wrote ${OUT}`);
