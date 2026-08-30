// Resolve the OTL facts needed to SPLIT an unnamed junction into named sub-clades.
//
// THE PROBLEM. Our topology is OTL's induced synthetic tree, which leaves bare junction
// nodes wherever it will not equate a node with a taxon. `Anas` is the case to hold in
// mind: the taxon is broken (Mareca, Spatula and Sibirionetta were split out of it), so
// synth names nothing, and our ten ducks hang off a nameless dot beside four mergansers.
// A node with no name cannot be a Kinship or Branches group at all (see allThemes in
// core/grid.ts), so 42 genera of famous animals are invisible to both games.
//
// THE FIX, AND ITS LIMIT. Those junctions are unresolved polytomies: they assert no
// structure, so refining one adds information rather than contradicting any. Where OTL
// says our species of a genus form a clade that excludes everything else we display under
// the junction, we can adopt that clade as a real node. What we must NOT do is call it the
// genus. The node holding our goats also holds four Hemitragus, so "Capra" would be a claim
// the tree does not support, and "Goats" would be worse: the mountain goat sits right
// outside it. That is the same shape as the bug this all started with.
//
// So this script answers two questions per candidate and nothing else:
//   1. SEPARATION — do our species of the genus form a clade excluding every other species
//      we display under that junction? (Monophyly in the induced subtree over exactly those
//      tips; anything else in the wider tree is invisible to players and irrelevant.)
//   2. COMPOSITION — which genera does that clade actually contain? The label is built from
//      this, never from the genus we happened to search for.
//
// The gates that depend on OUR species set (size, exclusivity) deliberately live in
// patch-junction-splits.mjs instead, because they must be re-checked on every build: add one
// Hieraaetus later and "Aquila & Hieraaetus" quietly becomes false. A name that was true
// when it was written and rotted afterwards is exactly what we are fixing.
//
//   node scripts/pull-junction-splits.mjs [--refresh]
//   reads:  src/data/taxonomy.json, src/data/taxonomyAugment.json
//   writes: node_modules/.cache/sel-junction-splits.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OTL = "https://api.opentreeoflife.org/v3";
const OUT = resolve(C, "sel-junction-splits.json");
const refresh = process.argv.includes("--refresh");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A genus needs this many of our species under one junction before a split is worth it:
// fewer than a Kinship group can use is not a group.
const MIN_SPECIES = 4;

const tax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const aug = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomyAugment.json"), "utf8"));
const byId = new Map();
for (const n of [...tax.nodes, ...aug.nodes]) if (!byId.has(n.id)) byId.set(n.id, n);
const kids = new Map();
for (const n of byId.values()) {
  const k = kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId);
  k.push(n);
}
const genusOf = (sci) => sci.split(/\s+/)[0];

// ---- candidates ----
// A genus with no node of its own whose species all hang, directly, on ONE unnamed junction.
// "Directly" matters: if they were spread over real structure, inserting a node would
// contradict it (the Bison-inside-Bos case build-augment.mjs guards against).
const speciesByGenus = new Map();
for (const n of byId.values()) {
  if (n.rank !== "species" || !n.sciName) continue;
  const g = genusOf(n.sciName);
  (speciesByGenus.get(g) ?? speciesByGenus.set(g, []).get(g)).push(n);
}
const genusNodeNames = new Set();
for (const n of byId.values()) if (n.rank === "genus" && n.sciName) genusNodeNames.add(n.sciName);

const leavesUnder = (id) => {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const c of kids.get(cur) ?? []) (c.rank === "species" ? out : stack).push(c.rank === "species" ? c : c.id);
  }
  return out;
};

const candidates = [];
for (const [genus, sp] of speciesByGenus) {
  if (genusNodeNames.has(genus) || sp.length < MIN_SPECIES) continue;
  const parents = new Set(sp.map((s) => s.parentId));
  if (parents.size !== 1) continue;
  const junction = byId.get([...parents][0]);
  if (!junction || junction.sciName) continue; // already named: nothing to split
  const mine = sp.map((s) => s.sciName);
  const others = leavesUnder(junction.id).map((s) => s.sciName).filter((s) => !mine.includes(s));
  if (!others.length) continue; // the junction IS the genus; naming it is a different job
  candidates.push({ genus, junction: junction.id, mine, others });
}
console.log(`${candidates.length} candidate junctions to test`);

const cache = existsSync(OUT) && !refresh ? JSON.parse(readFileSync(OUT, "utf8")) : { byGenus: {} };

async function post(path, body, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${OTL}/${path}`, {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) { await sleep(1000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(1000 * (i + 1)); }
  }
  return null;
}

// name -> ott, exact matches only: an approximate match is a different species.
const need = candidates.filter((c) => cache.byGenus[c.genus] === undefined);
const names = [...new Set(need.flatMap((c) => [...c.mine, ...c.others]))];
const ott = new Map();
for (let i = 0; i < names.length; i += 250) {
  const doc = await post("tnrs/match_names", { names: names.slice(i, i + 250), do_approximate_matching: false });
  for (const r of doc?.results ?? []) if (r.matches.length) ott.set(r.name, r.matches[0].taxon.ott_id);
  process.stderr.write(`  matched ${Math.min(i + 250, names.length)}/${names.length}\r`);
}
process.stderr.write("\n");

/** Every internal clade of a newick string, as sets of LEAF ott ids.
 *
 *  Two traps, both of which turn a separable genus into a false "interleaved":
 *
 *  QUOTED LABELS COME FIRST IN THE TOKENIZER. OTL disambiguates homonyms inside the label
 *  itself, and those labels contain brackets: `'Capra hircus (species in domain Eukaryota)
 *  ott19017'`. Splitting on raw parentheses shreds that into phantom clades, and the ten
 *  goats stop looking like a clade even though the newick plainly says they are.
 *
 *  THE TOKEN AFTER `)` IS THE NODE'S OWN LABEL, not a member. OTL writes them as
 *  `)mrcaott190881ott604182`. Counted as leaves they pollute every clade above the deepest. */
function cladesOf(newick) {
  const stack = [[]];
  const out = [];
  let prev = null;
  for (const [tok] of newick.matchAll(/'(?:[^']|'')*'|\(|\)|,|[^(),;']+/g)) {
    if (tok === "(") stack.push([]);
    else if (tok === ")") { const c = stack.pop(); out.push(new Set(c)); stack[stack.length - 1].push(...c); }
    else if (tok !== "," && prev !== ")") { const m = /ott(\d+)/.exec(tok); if (m) stack[stack.length - 1].push(Number(m[1])); }
    prev = tok;
  }
  return out;
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

let pass = 0, fail = 0, skip = 0;
for (const c of need) {
  const mine = c.mine.map((n) => ott.get(n)).filter(Boolean);
  const others = c.others.map((n) => ott.get(n)).filter(Boolean);
  if (mine.length < MIN_SPECIES || !others.length) {
    cache.byGenus[c.genus] = null;
    console.log(`  skip  ${c.genus.padEnd(16)} only ${mine.length} species resolved`);
    skip++; continue;
  }
  // 1. SEPARATION, over exactly the tips we display under this junction. OTL rejects the
  //    whole request if any one id is absent from the synth tree, so drop the ones it names
  //    and retry rather than losing the candidate to a single missing species.
  let induced = await post("tree_of_life/induced_subtree", { ott_ids: [...mine, ...others] });
  if (!induced?.newick) {
    const bad = new Set(
      Object.keys(induced?.unknown ?? {}).map((k) => Number(String(k).replace(/\D/g, ""))).filter(Boolean)
    );
    if (bad.size) {
      const m2 = mine.filter((o) => !bad.has(o));
      const o2 = others.filter((o) => !bad.has(o));
      if (m2.length >= MIN_SPECIES && o2.length) {
        mine.length = 0; mine.push(...m2);
        others.length = 0; others.push(...o2);
        induced = await post("tree_of_life/induced_subtree", { ott_ids: [...mine, ...others] });
      }
    }
  }
  const newick = induced?.newick;
  if (!newick) {
    cache.byGenus[c.genus] = null;
    console.log(`  skip  ${c.genus.padEnd(16)} OTL could not induce a subtree`);
    skip++; continue;
  }
  const want = new Set(mine);
  if (!cladesOf(newick).some((cl) => sameSet(cl, want))) {
    cache.byGenus[c.genus] = null;
    console.log(`  FAIL  ${c.genus.padEnd(16)} not a clade: something we display sits inside it`);
    fail++; continue;
  }
  // 2. COMPOSITION of the clade we would adopt.
  const mrca = await post("tree_of_life/mrca", { ott_ids: mine });
  const nodeId = mrca?.mrca?.node_id;
  const sub = nodeId ? await post("tree_of_life/subtree", { node_id: nodeId, format: "newick" }) : null;
  if (!nodeId || !sub?.newick) {
    cache.byGenus[c.genus] = null;
    console.log(`  skip  ${c.genus.padEnd(16)} no MRCA/subtree from OTL`);
    skip++; continue;
  }
  const genera = {};
  for (const m of sub.newick.matchAll(/([A-Z][a-z]+)_[a-z]/g)) genera[m[1]] = (genera[m[1]] ?? 0) + 1;
  cache.byGenus[c.genus] = { junction: c.junction, nodeId, genera, species: c.mine };
  console.log(`  pass  ${c.genus.padEnd(16)} ${nodeId} holds ${Object.keys(genera).join(", ")}`);
  pass++;
  await sleep(80);
}
writeFileSync(OUT, JSON.stringify(cache));
console.log(`\n✓ ${pass} separable, ${fail} interleaved, ${skip} unresolved — wrote ${OUT}`);
console.log("  Labels and the exclusivity check are patch-junction-splits.mjs's job, by design.");
