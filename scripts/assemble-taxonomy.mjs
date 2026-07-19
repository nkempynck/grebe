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
  const m = t.match(/^(.*?)[ _]?ott(\d+)$/);
  if (m) { let name = m[1].replace(/_/g, " ").replace(/\(.*?\)/g, "").trim(); if (!name || /^mrca/i.test(name)) return { name: null, id: `ott${m[2]}` }; return { name, id: `ott${m[2]}` }; }
  if (/^mrca/i.test(t)) return { name: null, id: t };
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

// ---- 3. genus injection ----
{
  const childrenOf = new Map();
  for (const n of nodes.values()) { if (n.parentId == null) continue; (childrenOf.get(n.parentId) ?? childrenOf.set(n.parentId, []).get(n.parentId)).push(n.id); }
  const leafCache = new Map();
  const leavesN = (id) => { if (leafCache.has(id)) return leafCache.get(id); const ch = childrenOf.get(id); let r; if (!ch || ch.length === 0) r = [id]; else { r = []; for (const c of ch) r.push(...leavesN(c)); } leafCache.set(id, r); return r; };
  const genusOf = (n) => (n && n.rank === "species" ? n.sciName.split(/\s+/)[0] : null);
  const pathToRoot = (id) => { const p = []; for (let c = id; c; c = nodes.get(c)?.parentId) p.push(c); return p; };
  const mrca = (ids) => { let anc = pathToRoot(ids[0]); for (const id of ids.slice(1)) { const s = new Set(pathToRoot(id)); anc = anc.filter((a) => s.has(a)); if (!anc.length) break; } return anc[0] ?? null; };
  const byGenus = new Map();
  for (const n of nodes.values()) { const g = genusOf(n); if (g) (byGenus.get(g) ?? byGenus.set(g, []).get(g)).push(n.id); }
  let injected = 0;
  for (const [g, sp] of byGenus) {
    if (sp.length < 2) continue;
    const m = mrca(sp); const node = m && nodes.get(m);
    if (!node || node.rank === "species" || node.sciName) continue;
    if (leavesN(m).some((id) => genusOf(nodes.get(id)) !== g)) continue;
    node.sciName = g; node.rank = "genus"; nameToId.set(g, m); injected++;
  }
  console.log(`injected ${injected} monophyletic genus clades`);
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
