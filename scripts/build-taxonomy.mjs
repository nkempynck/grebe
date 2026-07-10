#!/usr/bin/env node
// Build-time taxonomy snapshot. Two sources, each doing what it's best at:
//
//   * GBIF  — picks a BALANCED, RECOGNIZABLE set of species (per-group quotas,
//     filled by occurrence volume) and supplies English common names.
//   * Open Tree of Life — supplies the real evolutionary TOPOLOGY connecting
//     those species, including the named clades GBIF's backbone omits (Amniota,
//     Tetrapoda, …). This is what lets the game teach shared ancestry.
//
// Writes src/data/taxonomy.json (nodes + scopes). Run: npm run build:taxonomy.
// It hits the network; the app itself never does — it just reads the JSON.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const GBIF = "https://api.gbif.org/v1";
const OTL = "https://api.opentreeoflife.org/v3";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "taxonomy.json");

// Per-GROUP quota keeps birds/insects (billions of records) from crowding out
// mammals, reptiles, fish. Occurrence volume then only decides WHICH species fill
// each share. Bumped up for a meatier game.
// Quotas are AMBITIONS, not guarantees — each group fills only as far as it has
// occurrence-ranked species with a clean English common name (the real ceiling).
const ANCHORS = [
  { name: "Mammalia", quota: 210 },
  { name: "Aves", quota: 240 },
  { name: "Squamata", quota: 100 },
  { name: "Testudines", quota: 34 },
  { name: "Crocodylia", quota: 12 },
  { name: "Amphibia", quota: 85, key: 131 },
  // Fish orders are single-order anchors → skip the per-order cap (flat).
  { name: "Perciformes", quota: 75, flat: true },
  { name: "Cypriniformes", quota: 34, flat: true },
  { name: "Salmoniformes", quota: 24, flat: true },
  { name: "Gadiformes", quota: 14, flat: true },
  { name: "Siluriformes", quota: 20, flat: true },
  { name: "Pleuronectiformes", quota: 14, flat: true },
  { name: "Characiformes", quota: 16, flat: true },
  { name: "Anguilliformes", quota: 12, flat: true },
  { name: "Elasmobranchii", quota: 48, key: 121 }, // sharks & rays
  { name: "Insecta", quota: 220 },
  { name: "Arachnida", quota: 55 },
  { name: "Cephalopoda", quota: 26 },
  { name: "Malacostraca", quota: 48 },
  { name: "Anthozoa", quota: 26 },
  { name: "Gastropoda", quota: 44 }, // snails & slugs
  { name: "Bivalvia", quota: 22 }, // clams, mussels
  { name: "Magnoliopsida", quota: 230 }, // dicots
  { name: "Liliopsida", quota: 105 }, // monocots
  { name: "Pinopsida", quota: 32, flat: true }, // conifers (≈ one order)
  { name: "Polypodiopsida", quota: 24 }, // ferns
  { name: "Agaricomycetes", quota: 85 }, // mushrooms
];
// Per-anchor cap so no single order dominates a group; scales with the quota.
const orderCap = (quota) => Math.max(5, Math.ceil(quota / 7));

// Curated must-include species: humans + classic biology model organisms. These
// are added regardless of occurrence volume, with hand-set common names (several
// have no clean vernacular, so the normal recognizability filter would drop
// them). Open Tree still supplies their real placement in the tree.
const EXTRAS = [
  // Humans + classic lab model organisms
  { name: "Homo sapiens", common: "Human" },
  { name: "Mus musculus", common: "House mouse" },
  { name: "Rattus norvegicus", common: "Brown rat" },
  { name: "Danio rerio", common: "Zebrafish" },
  { name: "Gallus gallus", common: "Chicken" },
  { name: "Xenopus laevis", common: "African clawed frog" },
  { name: "Drosophila melanogaster", common: "Fruit fly" },
  { name: "Caenorhabditis elegans", common: "Roundworm" },
  { name: "Apis mellifera", common: "Western honey bee" },
  { name: "Saccharomyces cerevisiae", common: "Brewer's yeast" },
  { name: "Arabidopsis thaliana", common: "Thale cress" },
  { name: "Nematostella vectensis", common: "Starlet sea anemone" },
  { name: "Physcomitrium patens", common: "Spreading earthmoss" },
  { name: "Dictyostelium discoideum", common: "Slime mould" },
  { name: "Escherichia coli", common: "E. coli" },
  // Charismatic / phylogenetically fun tips
  { name: "Ambystoma mexicanum", common: "Axolotl" },
  { name: "Ornithorhynchus anatinus", common: "Platypus" },
  { name: "Sphenodon punctatus", common: "Tuatara" },
  { name: "Latimeria chalumnae", common: "Coelacanth" },
  { name: "Enteroctopus dofleini", common: "Giant Pacific octopus" },
  { name: "Architeuthis dux", common: "Giant squid" },
  { name: "Chelonia mydas", common: "Green sea turtle" },
  { name: "Danaus plexippus", common: "Monarch butterfly" },
  { name: "Phascolarctos cinereus", common: "Koala" },
  { name: "Milnesium tardigradum", common: "Water bear" },
];

// Scope presets: clade NAMES to expose if OTL places them in the pulled tree.
const SCOPE_CANDIDATES = [
  { names: ["life"], label: "All life" },
  { names: ["Metazoa", "Animalia"], label: "Animals" },
  { names: ["Chordata"], label: "Chordates" },
  { names: ["Mammalia"], label: "Mammals" },
  { names: ["Aves"], label: "Birds" },
  { names: ["Actinopterygii", "Actinipterygii"], label: "Fish" },
  { names: ["Insecta"], label: "Insects" },
  { names: ["Arthropoda"], label: "Arthropods" },
  { names: ["Chloroplastida", "Viridiplantae"], label: "Plants" },
  { names: ["Fungi"], label: "Fungi" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (res.ok) return json;
      if (res.status === 429 || res.status >= 500) { await sleep(500 * (i + 1)); continue; }
      return { __error: true, status: res.status, body: json ?? text };
    } catch {
      await sleep(500 * (i + 1));
    }
  }
  return { __error: true, status: 0 };
}
const getJSON = (url) => req(url, { headers: { accept: "application/json" } });
const postJSON = (url, body) =>
  req(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
    })
  );
  return out;
}

// ---------- GBIF: choose a balanced, recognizable species set ----------

async function resolveGbifKey(a) {
  if (a.key) return a.key;
  const doc = await getJSON(`${GBIF}/species/match?name=${encodeURIComponent(a.name)}`);
  return doc && !doc.__error && doc.matchType !== "NONE" ? doc.usageKey ?? null : null;
}

// Resolve one curated extra to a spec (speciesKey + canonical name + our common).
async function resolveExtra(e) {
  const doc = await getJSON(`${GBIF}/species/match?name=${encodeURIComponent(e.name)}`);
  if (!doc || doc.__error || doc.matchType === "NONE") return null;
  const speciesKey = doc.speciesKey ?? doc.usageKey;
  if (!speciesKey) return null;
  return {
    speciesKey,
    canonicalName: doc.canonicalName ?? e.name,
    common: e.common,
    orderKey: doc.orderKey ?? null,
  };
}

function cleanCommon(name) {
  if (!name) return null;
  const n = name.trim();
  if (n.length < 2 || n.length > 30) return null;
  if (/[0-9(){}\[\]\/]/.test(n)) return null;
  if (/[^\x00-\x7F]/.test(n)) return null;
  if (n === n.toUpperCase() && n.length <= 5) return null;
  if (n.split(/\s+/).length > 4) return null;
  return n.charAt(0).toUpperCase() + n.slice(1);
}

async function englishCommonName(key, sciName) {
  const doc = await getJSON(`${GBIF}/species/${key}/vernacularNames?limit=80`);
  if (!doc || doc.__error) return null;
  const eng = (doc.results ?? []).filter((v) => v.language === "eng" && v.vernacularName);
  const preferred = eng.filter((v) => v.preferred).map((v) => v.vernacularName);
  const sciTokens = new Set((sciName ?? "").toLowerCase().split(/\s+/));
  for (const c of [...preferred, ...eng.map((v) => v.vernacularName)]) {
    const cc = cleanCommon(c);
    if (cc && !sciTokens.has(cc.toLowerCase())) return cc;
  }
  return null;
}

// Scan occurrence-ranked species deepest-first, keeping only those with a clean
// English common name, until the quota fills or the pool (or common names) run
// out. Lazy/batched so we stop early instead of fetching the whole deep pool.
async function speciesForAnchor(a, key) {
  const facetLimit = Math.min(a.quota * 8, 1500);
  const doc = await getJSON(`${GBIF}/occurrence/search?taxonKey=${key}&facet=speciesKey&facetLimit=${facetLimit}&limit=0`);
  const ranked = (doc?.facets?.[0]?.counts ?? []).map((c) => c.name);
  const cap = a.flat ? Infinity : orderCap(a.quota);
  const perOrder = new Map();
  const chosen = [];
  for (let i = 0; i < ranked.length && chosen.length < a.quota; i += 24) {
    const batch = ranked.slice(i, i + 24);
    const recs = (await mapLimit(batch, 8, (sk) => getJSON(`${GBIF}/species/${sk}`)))
      .filter((s) => s && !s.__error && s.rank === "SPECIES" && s.speciesKey && s.canonicalName);
    await mapLimit(recs, 8, async (s) => { s.common = await englishCommonName(s.speciesKey, s.canonicalName); });
    for (const s of recs) {
      if (chosen.length >= a.quota) break;
      if (!s.common) continue; // drop Latin-only — recognizability filter
      if (s.orderKey != null) {
        const n = perOrder.get(s.orderKey) ?? 0;
        if (n >= cap) continue;
        perOrder.set(s.orderKey, n + 1);
      }
      chosen.push(s);
    }
  }
  return chosen;
}

// ---------- Open Tree of Life: topology ----------

async function tnrsMatch(names) {
  const out = new Map(); // canonicalName -> ott_id
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200);
    const doc = await postJSON(`${OTL}/tnrs/match_names`, { names: chunk, do_approximate_matching: false });
    if (!doc || doc.__error) continue;
    for (const r of doc.results ?? []) {
      const t = r.matches?.[0]?.taxon;
      if (t?.ott_id) out.set(r.name, t.ott_id);
    }
  }
  return out;
}

async function inducedSubtree(ottIds) {
  let ids = [...ottIds];
  for (let attempt = 0; attempt < 6; attempt++) {
    const doc = await postJSON(`${OTL}/tree_of_life/induced_subtree`, { ott_ids: ids, label_format: "name_and_id" });
    if (doc && !doc.__error && doc.newick) return { newick: doc.newick, ids };
    // Prune any ott ids the synthetic tree rejected, then retry.
    const body = doc?.body ?? doc;
    const bad = new Set();
    for (const field of ["unknown_ids", "node_ids_not_in_tree", "broken", "unknown"]) {
      const v = body?.[field];
      if (Array.isArray(v)) v.forEach((x) => bad.add(Number(String(x).replace(/\D/g, ""))));
      else if (v && typeof v === "object") Object.keys(v).forEach((x) => bad.add(Number(String(x).replace(/\D/g, ""))));
    }
    if (typeof body?.message === "string") {
      for (const m of body.message.matchAll(/ott(\d+)/g)) bad.add(Number(m[1]));
    }
    const before = ids.length;
    ids = ids.filter((id) => !bad.has(id));
    if (ids.length === before || ids.length === 0) return null;
    console.log(`   induced_subtree: pruned ${before - ids.length} taxa OTL couldn't place, retrying…`);
  }
  return null;
}

// Newick parser that tolerates single-quoted labels.
function parseNewick(s) {
  s = s.trim().replace(/;\s*$/, "");
  let i = 0;
  const readLabel = () => {
    let out = "";
    if (s[i] === "'") {
      i++;
      while (i < s.length) {
        if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } i++; break; }
        out += s[i++];
      }
    } else {
      while (i < s.length && !"(),".includes(s[i])) out += s[i++];
    }
    return out.trim();
  };
  const node = () => {
    const n = { children: [] };
    if (s[i] === "(") {
      i++;
      do { n.children.push(node()); } while (s[i] === "," && ++i);
      i++; // consume ')'
    }
    n.label = readLabel();
    return n;
  };
  return node();
}

// Split "Panthera_leo_ott563151" / "Amniota_ott5246131" / "mrcaott786ott83926".
function parseLabel(raw) {
  const t = (raw ?? "").trim();
  const m = t.match(/^(.*?)[ _]?ott(\d+)$/);
  if (m) {
    let name = m[1].replace(/_/g, " ").replace(/\(.*?\)/g, "").trim();
    if (!name || /^mrca/i.test(name)) return { name: null, id: `ott${m[2]}` };
    return { name, id: `ott${m[2]}` };
  }
  if (/^mrca/i.test(t)) return { name: null, id: t };
  const name = t.replace(/_/g, " ").trim();
  return { name: name || null, id: null };
}

async function main() {
  console.log("→ [GBIF] resolving anchor groups…");
  const anchors = [];
  for (const a of ANCHORS) {
    const key = await resolveGbifKey(a);
    if (key) anchors.push({ ...a, key });
    else console.warn(`   ! could not resolve ${a.name} — skipping`);
  }

  console.log("→ [GBIF] filling per-group quotas by occurrence volume…");
  const nested = await mapLimit(anchors, 4, async (a) => {
    const chosen = await speciesForAnchor(a, a.key);
    console.log(`   ${a.name}: ${chosen.length}/${a.quota}`);
    return chosen;
  });
  const seen = new Set();
  const specs = nested.flat().filter((s) => (seen.has(s.speciesKey) ? false : seen.add(s.speciesKey)));
  console.log(`   ${specs.length} species selected (all with common names)`);

  console.log("→ [GBIF] adding curated extras (humans + model organisms)…");
  const extras = (await mapLimit(EXTRAS, 6, resolveExtra)).filter(Boolean);
  for (const s of extras) {
    if (!seen.has(s.speciesKey)) { seen.add(s.speciesKey); specs.push(s); }
  }
  console.log(`   +${extras.length} extras (${extras.map((e) => e.common).join(", ")})`);

  console.log("→ [OTL] matching names → OTT ids…");
  const nameToOtt = await tnrsMatch(specs.map((s) => s.canonicalName));
  const byOtt = new Map();
  for (const s of specs) {
    const ott = nameToOtt.get(s.canonicalName);
    if (ott != null && !byOtt.has(ott)) byOtt.set(ott, s);
  }
  console.log(`   ${byOtt.size}/${specs.length} placed in the Open Tree`);

  console.log("→ [OTL] fetching induced topology…");
  const res = await inducedSubtree([...byOtt.keys()]);
  if (!res) { console.error("induced_subtree failed"); process.exit(1); }
  const root = parseNewick(res.newick);

  // ---- flatten newick → nodes ----
  // Collapse only single-child PASS-THROUGHS. Keep every named clade, and keep
  // UNNAMED branch points (≥2 live children) too — OTL labels most real clades
  // (Neoaves, Laridae, even genus Larus in an induced tree) as unnamed "mrca"
  // nodes, and dropping them flattens the tree into useless polytomies. Unnamed
  // clades are stored with an empty sciName and drawn as bare junctions.
  const nodes = new Map();
  nodes.set("life", { id: "life", sciName: "Life", common: "Life", rank: "domain", parentId: null });
  const nameToId = new Map();

  // Does this subtree contain at least one keepable (common-named) species?
  const live = new Map();
  const hasLeaf = (n) => {
    if (live.has(n)) return live.get(n);
    let res;
    if (n.children.length === 0) {
      const num = parseLabel(n.label).id ? Number(parseLabel(n.label).id.replace(/\D/g, "")) : null;
      const spec = num != null ? byOtt.get(num) : null;
      res = !!(spec && spec.common);
    } else {
      res = n.children.some(hasLeaf);
    }
    live.set(n, res);
    return res;
  };

  const emit = (n, parentId) => {
    const { name, id } = parseLabel(n.label);
    if (n.children.length === 0) {
      const ottNum = id ? Number(id.replace(/\D/g, "")) : null;
      const spec = ottNum != null ? byOtt.get(ottNum) : null;
      if (!spec || !spec.common) return; // no Latin-only leaves
      const nid = String(spec.speciesKey);
      if (!nodes.has(nid))
        nodes.set(nid, { id: nid, sciName: spec.canonicalName, common: spec.common ?? undefined, rank: "species", parentId });
      return;
    }
    const liveKids = n.children.filter(hasLeaf);
    if (name) {
      const nid = id ?? `clade-${name}`;
      if (!nodes.has(nid)) {
        nodes.set(nid, { id: nid, sciName: name, common: undefined, rank: "clade", parentId });
        nameToId.set(name, nid);
      }
      for (const c of liveKids) emit(c, nid);
    } else if (liveKids.length >= 2) {
      // unnamed branch point — preserve the split as an unlabeled junction
      const nid = id ?? n.label;
      if (!nodes.has(nid)) nodes.set(nid, { id: nid, sciName: "", common: undefined, rank: "clade", parentId });
      for (const c of liveKids) emit(c, nid);
    } else {
      for (const c of liveKids) emit(c, parentId); // single-child pass-through → collapse
    }
  };
  emit(root, "life");

  // Dropping Latin-only leaves can leave clades with no descendants — prune them
  // to a fixpoint so they don't show up as phantom guessable tips.
  for (let pruned = true; pruned; ) {
    pruned = false;
    const parents = new Set([...nodes.values()].map((n) => n.parentId).filter(Boolean));
    for (const [id, n] of nodes) {
      if (n.parentId !== null && n.rank !== "species" && !parents.has(id)) { nodes.delete(id); pruned = true; }
    }
  }

  // Ranks via ONE batched TNRS pass over the clade names (fast). Verify the
  // resolved ott id matches the clade's own id, so homonyms (a moth genus named
  // "Tetrapoda") can't mislabel a clade. Unverified/unranked → generic "clade".
  const cladeEntries = [...nameToId.entries()].filter(([, nid]) => nid.startsWith("ott") && nodes.has(nid));
  console.log(`→ [OTL] labelling ranks for ${cladeEntries.length} clades (batched)…`);
  const rankByName = new Map();
  for (let i = 0; i < cladeEntries.length; i += 200) {
    const chunk = cladeEntries.slice(i, i + 200).map(([name]) => name);
    const doc = await postJSON(`${OTL}/tnrs/match_names`, { names: chunk, do_approximate_matching: false });
    if (doc && !doc.__error) for (const r of doc.results ?? []) {
      const t = r.matches?.[0]?.taxon;
      if (t) rankByName.set(r.name, { ott: t.ott_id, rank: t.rank });
    }
  }
  for (const [name, nid] of cladeEntries) {
    const hit = rankByName.get(name);
    const ottNum = Number(nid.replace(/\D/g, ""));
    const rank = hit && hit.ott === ottNum ? hit.rank : null;
    // A node with children is a clade, never a species — ignore a "species" rank.
    nodes.get(nid).rank = rank && rank !== "species" && !/^no /.test(rank) ? rank.toLowerCase() : "clade";
  }

  const list = [...nodes.values()].map((n) => ({
    id: n.id, sciName: n.sciName, ...(n.common ? { common: n.common } : {}), rank: n.rank, parentId: n.parentId,
  }));

  // scopes: first present name in each candidate group
  const scopes = [];
  for (const c of SCOPE_CANDIDATES) {
    if (c.names.includes("life")) { scopes.push({ id: "life", label: c.label }); continue; }
    const hit = c.names.map((nm) => nameToId.get(nm)).find((id) => id && nodes.has(id));
    if (hit) scopes.push({ id: hit, label: c.label });
  }

  const species = list.filter((n) => n.rank === "species").length;
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "GBIF (species + common names) × Open Tree of Life (topology)",
    counts: { nodes: list.length, species },
    scopes, nodes: list,
  }, null, 2));
  console.log(`✓ wrote ${OUT}`);
  console.log(`  ${list.length} nodes, ${species} species, ${scopes.length} scopes: ${scopes.map((s) => s.label).join(", ")}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
