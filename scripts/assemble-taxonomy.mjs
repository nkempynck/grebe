// Assemble the in-set STRUCTURE (steps 1-3) from sel-inset.json + sel-topology.json:
//   1. prune the OTL Newick to the in-set tips, flatten -> nodes {id,sciName,rank,parentId,views}
//      (species id = GBIF key, else ottID; clade id = ottID). Collapse single-child
//      pass-throughs, keep named clades + real branch points, prune empty clades.
//   2. label clade ranks via OTL TNRS (verify ott matches so homonyms can't mislabel).
//   3. inject monophyletic genus names OTL left unlabeled.
// Names + provenance are separate later steps. Writes node_modules/.cache/sel-nodes.json.
// Run: node scripts/assemble-taxonomy.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OTL = "https://api.opentreeoflife.org/v3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function postJSON(u, b, tries = 4) { for (let i = 0; i < tries; i++) { try { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(b) }); if (r.ok) return await r.json(); if (r.status === 429 || r.status >= 500) { await sleep(600 * (i + 1)); continue; } return { __error: true }; } catch { await sleep(600 * (i + 1)); } } return { __error: true }; }

function parseNewick(s) {
  s = s.trim().replace(/;\s*$/, ""); let i = 0;
  const readLabel = () => { let out = ""; if (s[i] === "'") { i++; while (i < s.length) { if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } i++; break; } out += s[i++]; } } else { while (i < s.length && !"(),".includes(s[i])) out += s[i++]; } return out.trim(); };
  const node = () => { const n = { children: [] }; if (s[i] === "(") { i++; do { n.children.push(node()); } while (s[i] === "," && ++i); i++; } n.label = readLabel(); return n; };
  return node();
}
function parseLabel(raw) {
  const t = (raw ?? "").trim();
  // `mrcaottAottB` is NOT a taxon id — it is OTL saying "the common ancestor of A and B",
  // its label for an internal node that has no name. This test MUST come before the
  // ott-suffix match below: that regex is anchored at the end, so it would capture the
  // TRAILING number and hand the node an id belonging to an unrelated taxon
  // (mrcaott2645ott35778 -> ott35778, which is the shrub Illicium floridanum, while our
  // node is a 940-species clade). That collided with OTL's own id namespace, let a true
  // id clash silently merge two clades via the `if (!nodes.has(nid))` guard in emit(),
  // and moved ids between rebuilds because OTL picks the two representative tips from
  // whatever tip set was requested. Keeping the whole label is OTL's own identifier for
  // the node and cannot collide with the ott or gbif namespaces.
  if (/^mrca/i.test(t)) return { name: null, id: t };
  const m = t.match(/^(.*?)[ _]?ott(\d+)$/);
  if (m) { let name = m[1].replace(/_/g, " ").replace(/\(.*?\)/g, "").trim(); if (!name || /^mrca/i.test(name)) return { name: null, id: `ott${m[2]}` }; return { name, id: `ott${m[2]}` }; }
  const name = t.replace(/_/g, " ").trim();
  return { name: name || null, id: null };
}

// ---- inputs ----
const inset = JSON.parse(readFileSync(resolve(C, "sel-inset.json"), "utf8"));
const topo = JSON.parse(readFileSync(resolve(C, "sel-topology.json"), "utf8"));
const ottByName = topo.ottByName;
const byOtt = new Map(); // ott number -> species record
for (const s of inset) { const o = ottByName[s.sci]; if (o != null && !byOtt.has(o)) byOtt.set(o, s); }
console.log(`in-set placed by OTT: ${byOtt.size}/${inset.length}`);
const root = parseNewick(topo.newick);

// ---- 1. flatten ----
const nodes = new Map();
nodes.set("life", { id: "life", sciName: "Life", common: "Life", rank: "domain", parentId: null });
const nameToId = new Map();
const live = new Map();
const hasLeaf = (n) => {
  if (live.has(n)) return live.get(n);
  let res;
  if (n.children.length === 0) { const id = parseLabel(n.label).id; const num = id ? Number(id.replace(/\D/g, "")) : null; res = num != null && byOtt.has(num); }
  else res = n.children.some(hasLeaf);
  live.set(n, res); return res;
};
const emit = (n, parentId) => {
  const { name, id } = parseLabel(n.label);
  if (n.children.length === 0) {
    const num = id ? Number(id.replace(/\D/g, "")) : null;
    const spec = num != null ? byOtt.get(num) : null;
    if (!spec) return;
    // Species id = GBIF key (a distinct namespace from clade OTT ids). NOT legacy cruft:
    // OTL reuses some ott ids for both a clade AND a tip, so keying species by ott would
    // collide with those clade nodes and silently drop the species (cat, grebe, whale…).
    const nid = spec.gbif ? String(spec.gbif) : `ott${num}`;
    if (!nodes.has(nid)) nodes.set(nid, { id: nid, sciName: spec.sci, common: undefined, rank: "species", parentId, views: spec.v });
    return;
  }
  const liveKids = n.children.filter(hasLeaf);
  if (name) {
    const nid = id ?? `clade-${name}`;
    if (!nodes.has(nid)) { nodes.set(nid, { id: nid, sciName: name, common: undefined, rank: "clade", parentId }); nameToId.set(name, nid); }
    for (const c of liveKids) emit(c, nid);
  } else if (liveKids.length >= 2) {
    const nid = id ?? n.label;
    if (!nodes.has(nid)) nodes.set(nid, { id: nid, sciName: "", common: undefined, rank: "clade", parentId });
    for (const c of liveKids) emit(c, nid);
  } else { for (const c of liveKids) emit(c, parentId); }
};
emit(root, "life");
// prune childless clades to a fixpoint
for (let pruned = true; pruned;) { pruned = false; const parents = new Set([...nodes.values()].map((n) => n.parentId).filter(Boolean)); for (const [id, n] of nodes) { if (n.parentId !== null && n.rank !== "species" && !parents.has(id)) { nodes.delete(id); pruned = true; } } }

// ---- 2. clade ranks via OTL TNRS ----
const cladeEntries = [...nameToId.entries()].filter(([, nid]) => nid.startsWith("ott") && nodes.has(nid));
console.log(`labelling ranks for ${cladeEntries.length} clades…`);
const rankByName = new Map();
for (let i = 0; i < cladeEntries.length; i += 200) {
  const chunk = cladeEntries.slice(i, i + 200).map(([name]) => name);
  const doc = await postJSON(`${OTL}/tnrs/match_names`, { names: chunk, do_approximate_matching: false });
  if (doc && !doc.__error) for (const r of doc.results ?? []) { const t = r.matches?.[0]?.taxon; if (t) rankByName.set(r.name, { ott: t.ott_id, rank: t.rank }); }
}
for (const [name, nid] of cladeEntries) {
  const hit = rankByName.get(name); const ottNum = Number(nid.replace(/\D/g, ""));
  const rank = hit && hit.ott === ottNum ? hit.rank : null;
  nodes.get(nid).rank = rank && rank !== "species" && !/^no /.test(rank) ? rank.toLowerCase() : "clade";
}

// ---- shared helpers for the name-injection steps (3 and 4) ----
const childrenOf = new Map();
for (const n of nodes.values()) { if (n.parentId == null) continue; (childrenOf.get(n.parentId) ?? childrenOf.set(n.parentId, []).get(n.parentId)).push(n.id); }
const leafCache = new Map();
const leavesN = (id) => { if (leafCache.has(id)) return leafCache.get(id); const ch = childrenOf.get(id); let r; if (!ch || ch.length === 0) r = [id]; else { r = []; for (const c of ch) r.push(...leavesN(c)); } leafCache.set(id, r); return r; };
const pathToRoot = (id) => { const p = []; for (let c = id; c; c = nodes.get(c)?.parentId) p.push(c); return p; };
const mrca = (ids) => { let anc = pathToRoot(ids[0]); for (const id of ids.slice(1)) { const s = new Set(pathToRoot(id)); anc = anc.filter((a) => s.has(a)); if (!anc.length) break; } return anc[0] ?? null; };

/** Name the clade holding a group of species, but ONLY when it holds nothing else.
 *  `groups` is name -> [speciesId]; `keyOf(speciesId)` returns the group name back.
 *  Strictness is the point: a node labelled with half a group would make every use of
 *  that name — Kinship's reveal label, a per-clade rule — silently wrong.
 *  `rank` = null names the node without asserting a Linnaean rank (see step 4).
 *  `dropRedundant` also skips a node whose nearest NAMED ancestor holds the same species
 *  under the SAME name: a stem/crown pair, where the label already exists on the tree and
 *  repeating it would nest a taxon inside itself. Off for genus, where the ancestor's name
 *  differs (Corvus inside Corvidae) and the second label is genuinely useful.
 *  (No node has a `common` yet — build-names adds those later — so sciName settles it.) */
const injectNames = (groups, keyOf, rank, dropRedundant = false) => {
  let injected = 0, taken = 0, redundant = 0, collided = 0; const rejects = []; const names = [];
  // A name must identify exactly ONE node, and purity alone does not guarantee that. OTL's
  // labelling can split a family across our tips: its Caprimulgidae node holds 16 of our
  // nightjars while a separate, DISJOINT branch holds 9 more whose family key is also
  // Caprimulgidae. Every leaf under each is a nightjar, so both pass the purity test, and
  // without this guard both are named Caprimulgidae — which lands on a Kinship board as two
  // groups with the IDENTICAL label (11 boards in a generated year: Cebidae, Dasyatidae,
  // Procellariidae, Rosaceae). The already-named node keeps the name; the other stays
  // anonymous, exactly as it was before family injection existed.
  const used = new Set();
  for (const n of nodes.values()) if (n.sciName) used.add(n.sciName);
  for (const [name, sp] of groups) {
    if (sp.length < 2) continue;                       // one species = no clade to name
    const m = mrca(sp); const node = m && nodes.get(m);
    if (!node || node.rank === "species") continue;
    if (node.sciName) { taken++; continue; }           // a finer name already claimed it
    if (used.has(name)) { collided++; continue; }      // the name is already someone else's
    if (leavesN(m).some((id) => keyOf(id) !== name)) { rejects.push(name); continue; }
    if (dropRedundant) {
      let a = node.parentId;
      while (a && !nodes.get(a)?.sciName) a = nodes.get(a)?.parentId;
      // leaf counts only grow upward, so the NEAREST named ancestor settles containment
      if (a && nodes.get(a).sciName === name && leavesN(a).length === leavesN(m).length) { redundant++; continue; }
    }
    node.sciName = name; if (rank) node.rank = rank; nameToId.set(name, m); used.add(name); names.push(name); injected++;
  }
  return { injected, taken, redundant, collided, rejects, names };
};

// ---- 3. genus injection ----
{
  const genusOf = (id) => { const n = nodes.get(id); return n && n.rank === "species" ? n.sciName.split(/\s+/)[0] : null; };
  const byGenus = new Map();
  for (const n of nodes.values()) { const g = genusOf(n.id); if (g) (byGenus.get(g) ?? byGenus.set(g, []).get(g)).push(n.id); }
  const r = injectNames(byGenus, genusOf, "genus");
  console.log(`injected ${r.injected} monophyletic genus clades (${r.collided} name already taken elsewhere)`);
}

// ---- 4. family injection ----
// OTL labels an internal node only when that node IS a taxon in its taxonomy. After pruning
// to our ~3.8k tips, the node holding exactly our corvids is a deeper branch point than OTL's
// Corvidae (~130 species), so it arrives as an anonymous `mrcaott…ott…` label. The name
// therefore CANNOT be recovered from the node's id — there is nothing to look up. It has to
// come from what sits underneath, which sel-inset already records: the family each species
// was pulled under. No extra network call.
// Not cosmetic: both generators skip nameless nodes (a theme must label itself on solve), so
// these clades are invisible to Kinship and Branches today. ~137 names add ~18% more Kinship
// themes — Rosaceae, Lamiaceae, Asteraceae, Cucurbitaceae, Viverridae, Turdidae, Icteridae.
// RANK IS DELIBERATELY LEFT AS "clade". Stamping "family" is a separate, separable change:
// Lineage's resolutionHonoured keys on rank === "family", so it would lift family-day coverage
// from 68% to 87% of species but TIGHTEN the win target for 39% of them, and that target is
// derived at read time, so it would reach days already pinned. Naming alone moves no
// difficulty: separation tier is read off the MRCA *between* two groups, and these family
// crowns (4-12 species) are too small to hold two themes, so none is ever such an MRCA.
// Rejects are genuine disagreements between family circumscription and OTL's topology
// (Amaranthaceae/Chenopodiaceae, the Emberizidae/Thraupidae sparrow reshuffle), not bugs.
// Runs AFTER genus injection: where a family and a genus land on the same node, genus keeps it.
{
  const famBySpecies = new Map();
  for (const s of inset) if (s.gbif && s.family) famBySpecies.set(String(s.gbif), s.family);
  const famOf = (id) => famBySpecies.get(id) ?? null;
  const byFamily = new Map();
  for (const n of nodes.values()) { if (n.rank !== "species") continue; const f = famOf(n.id); if (f) (byFamily.get(f) ?? byFamily.set(f, []).get(f)).push(n.id); }
  const r = injectNames(byFamily, famOf, null, true);
  // `sepRank`, not `rank`: see the header note on separation-only ranks.
  for (const n of r.names) nodes.get(nameToId.get(n)).sepRank = "family";
  console.log(`injected ${r.injected} monophyletic family clades (${r.taken} already named, ${r.collided} name already taken elsewhere, ${r.redundant} redundant with an ancestor, ${r.rejects.length} impure)`);
  if (r.rejects.length) console.log(`  impure (family vs topology): ${r.rejects.slice(0, 12).join(", ")}${r.rejects.length > 12 ? ", …" : ""}`);
}

// ---- 5. parent-taxon injection (the mid-rank layer, for SEPARATION only) ----
// Kinship reads difficulty off the RANK of the MRCA between two groups, so an unranked
// stretch of tree reads as "trivially separable" no matter how close the groups really
// are. That is not spread evenly: only 4% of plant group-pairs have a ranked MRCA against
// 29-40% everywhere else, because the node holding exactly our Asparagales species is a
// different branch point from OTL's Asparagales and so arrives anonymous — nine of the
// twenty major plant orders were missing from the tree entirely. Four Asparagales families
// then read as far apart as a bird and a beetle, and the difficulty gates threw out every
// plant board. sel-families.json already records each family's PARENT taxon (Wikidata
// P171), covering 100% of in-set species with no extra network call, so the same injection
// that named the families names this layer too: Amaryllidaceae/Iridaceae/Orchidaceae ->
// Asparagales, Melanthiaceae -> Liliales, Primulaceae -> Ericales.
//
// The rank lands in `sepRank`, NEVER in `rank`. Lineage's nearestAncestorOfRank stops at
// the first ancestor ranked ABOVE the one it wants, so a real "order" here would make the
// search for a species' family fail wherever that family crown is one of our unranked
// injected clades — silently tightening the win target on days that are already pinned.
// separationTierOf reads sepRank ?? rank; nothing else looks at it.
{
  const famsDoc = JSON.parse(readFileSync(resolve(C, "sel-families.json"), "utf8"));
  const parentOfFamily = new Map();
  for (const f of Object.values(famsDoc.fams ?? {})) if (f.name && f.parentName) parentOfFamily.set(f.name, f.parentName);
  const famBySpecies = new Map();
  for (const s of inset) if (s.gbif && s.family) famBySpecies.set(String(s.gbif), s.family);
  const parentOf = (id) => { const f = famBySpecies.get(id); return (f && parentOfFamily.get(f)) || null; };
  const byParent = new Map();
  for (const n of nodes.values()) { if (n.rank !== "species") continue; const p = parentOf(n.id); if (p) (byParent.get(p) ?? byParent.set(p, []).get(p)).push(n.id); }
  const r = injectNames(byParent, parentOf, null, true);
  // Rank them from the same OTL TNRS used for clade ranks in step 2. A name matching more
  // than one taxon is a homonym we can't resolve without an ott to check against, so it is
  // left unranked — which just keeps today's walk-up behaviour, never a wrong tier.
  let ranked = 0, ambiguous = 0;
  for (let i = 0; i < r.names.length; i += 200) {
    const chunk = r.names.slice(i, i + 200);
    const doc = await postJSON(`${OTL}/tnrs/match_names`, { names: chunk, do_approximate_matching: false });
    if (!doc || doc.__error) continue;
    for (const res of doc.results ?? []) {
      if ((res.matches?.length ?? 0) !== 1) { ambiguous++; continue; }
      const rank = String(res.matches[0].taxon?.rank ?? "").toLowerCase();
      if (!rank || rank === "species" || /^no /.test(rank)) continue;
      const node = nodes.get(nameToId.get(res.name));
      if (node) { node.sepRank = rank; ranked++; }
    }
  }
  console.log(`injected ${r.injected} parent-taxon clades (${r.taken} already named, ${r.collided} name taken elsewhere, ${r.redundant} redundant, ${r.rejects.length} impure); ranked ${ranked}, ${ambiguous} ambiguous`);
}

// ---- report ----
const list = [...nodes.values()];
writeFileSync(resolve(C, "sel-nodes.json"), JSON.stringify(list));
const byRank = {}; for (const n of list) byRank[n.rank] = (byRank[n.rank] ?? 0) + 1;
console.log(`\n✓ nodes: ${list.length} (species ${byRank.species}, clades ${list.length - byRank.species})`);
console.log("  by rank:", JSON.stringify(Object.fromEntries(Object.entries(byRank).sort((a, b) => b[1] - a[1]))));
// arity check (the equal-children concern)
const kids = {}; for (const n of list) if (n.parentId) kids[n.parentId] = (kids[n.parentId] ?? 0) + 1;
const arities = Object.values(kids); const wide = Object.entries(kids).filter(([, k]) => k >= 9);
console.log(`  internal nodes: ${arities.length}; wide splits (>=9 children): ${wide.length}`);
for (const [id, k] of wide.sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`     ${k} children under ${nodes.get(id)?.sciName || nodes.get(id)?.rank || id}`);
