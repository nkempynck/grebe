// Build the OUT-OF-SET guess index (guessIndex.generated.json) from the Wikipedia-first
// pool + topology, replacing the old GBIF build-guess-index.mjs. Every pool taxon NOT in
// the shipped in-set becomes a guessable entry with a graft lineage (nearest named
// ancestors up to the first shipped node) computed FROM the pool topology — no per-taxon
// OTL calls. Species AND named clades (guessable groups). Now also carries `views`.
//   node scripts/build-taxon-index.mjs   ->  src/data/guessIndex.generated.json
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OTL = "https://api.opentreeoflife.org/v3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function postJSON(u, b, tries = 4) { for (let i = 0; i < tries; i++) { try { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(b) }); if (r.ok) return await r.json(); if (r.status === 429 || r.status >= 500) { await sleep(600 * (i + 1)); continue; } return { __error: true }; } catch { await sleep(600 * (i + 1)); } } return { __error: true }; }
const normalizeName = (s) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();

function parseNewick(s) {
  s = s.trim().replace(/;\s*$/, ""); let i = 0;
  const readLabel = () => { let o = ""; if (s[i] === "'") { i++; while (i < s.length) { if (s[i] === "'") { if (s[i + 1] === "'") { o += "'"; i += 2; continue; } i++; break; } o += s[i++]; } } else { while (i < s.length && !"(),".includes(s[i])) o += s[i++]; } return o.trim(); };
  const node = () => { const n = { children: [] }; if (s[i] === "(") { i++; do { n.children.push(node()); } while (s[i] === "," && ++i); i++; } n.label = readLabel(); return n; };
  return node();
}
function parseLabel(raw) {
  const t = (raw ?? "").trim();
  const m = t.match(/^(.*?)[ _]?ott(\d+)$/);
  if (m) { let name = m[1].replace(/_/g, " ").replace(/\(.*?\)/g, "").trim(); if (!name || /^mrca/i.test(name)) return { name: null, id: `ott${m[2]}` }; return { name, id: `ott${m[2]}` }; }
  if (/^mrca/i.test(t)) return { name: null, id: t };
  return { name: t.replace(/_/g, " ").trim() || null, id: null };
}

const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));
const topo = JSON.parse(readFileSync(resolve(C, "sel-topology.json"), "utf8"));
const tax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const shipped = new Set(tax.nodes.map((n) => n.id)); // in-set node ids (graft targets)
const shippedSci = new Set(tax.nodes.filter((n) => n.rank === "species").map((n) => n.sciName)); // in-set species are GBIF-keyed, so `shipped` (ott) doesn't catch them — exclude by name
const bySci = new Map(pool.map((s) => [s.sci, s]));

// build parent map + node info from the pool newick. Key nodes by a UNIQUE traversal
// id (an ott id can appear on more than one tree node — keying by it corrupts the
// parent map into a cycle). Store the ott separately; match shipped/lineage by ott.
const root = parseNewick(topo.newick);
const parentOf = new Map(); const info = new Map(); // nid -> {name, ott (string|null)}
const leafByOtt = new Map(); // ott string -> leaf nid (species lookup)
let auto = 0;
(function walk(n, parentId) {
  const { name, id } = parseLabel(n.label);
  const nid = `n${auto++}`;
  info.set(nid, { name, ott: id ?? null });
  if (parentId != null) parentOf.set(nid, parentId);
  if (n.children.length === 0 && id) leafByOtt.set(id, nid);
  for (const c of n.children) walk(c, nid);
})(root, null);

// rank the NAMED clades via OTL TNRS (batched)
const namedClades = [...info.entries()].filter(([, v]) => v.name && v.ott);
const rankByOtt = new Map(); // ott number -> rank
console.error(`ranking ${namedClades.length} clades…`);
const names = [...new Set(namedClades.map(([, v]) => v.name))];
for (let i = 0; i < names.length; i += 200) {
  const doc = await postJSON(`${OTL}/tnrs/match_names`, { names: names.slice(i, i + 200), do_approximate_matching: false });
  if (doc && !doc.__error) for (const r of doc.results ?? []) { const t = r.matches?.[0]?.taxon; if (t) rankByOtt.set(`ott${t.ott_id}`, t.rank); }
  process.stderr.write(`  ${Math.min(i + 200, names.length)}/${names.length}\r`);
}
process.stderr.write("\n");
const rankOf = (ott) => { const r = rankByOtt.get(ott); return r && r !== "species" && !/^no /.test(r) ? r.toLowerCase() : "clade"; };

// lineage: walk up collecting NAMED clades, truncate at (incl.) the first shipped one.
// Nodes keyed by unique nid; shipped/lineage matched by the node's ott.
function graftLineage(startNid) {
  const out = [];
  let hops = 0;
  for (let cur = parentOf.get(startNid); cur != null && hops++ < 300; cur = parentOf.get(cur)) {
    const v = info.get(cur);
    if (v.name && v.ott) out.push({ id: v.ott, sciName: v.name, rank: rankOf(v.ott) });
    if (v.ott && shipped.has(v.ott)) {
      if (out.length && out[out.length - 1].id === v.ott) return out;    // last collected IS the shipped node
      return [...out, { id: v.ott, sciName: v.name ?? "", rank: rankOf(v.ott) }]; // connect to an unnamed shipped node
    }
  }
  return null; // no shipped ancestor -> orphan
}

const entries = [];
let orphan = 0;
console.error(`building entries (info ${info.size} nodes, ${leafByOtt.size} leaves)…`);
// species entries
for (const s of pool) {
  const ott = topo.ottByName[s.sci]; if (ott == null) continue;
  const id = `ott${ott}`;
  if (shipped.has(id) || shippedSci.has(s.sci)) continue; // already in the in-set
  const leaf = leafByOtt.get(id); if (leaf == null) continue;
  const lineage = graftLineage(leaf); if (!lineage) { orphan++; continue; }
  const common = s.article && s.article.toLowerCase() !== s.sci.toLowerCase() ? s.article : null;
  const keys = [...new Set([normalizeName(common), normalizeName(s.sci)].filter(Boolean))];
  entries.push({ keys, graft: { id, sciName: s.sci, common, rank: "species", views: s.v, lineage } });
}
// named-clade entries (guessable groups not already shipped). Skip any ott already
// used by a species entry — OTL reuses otts across a tip and an internal node, so a
// species can also appear as a named internal node; the species entry wins.
const speciesOtts = new Set(entries.map((e) => e.graft.id));
const seenClade = new Set();
for (const [nid, v] of namedClades) {
  if (shipped.has(v.ott) || seenClade.has(v.ott) || speciesOtts.has(v.ott)) continue;
  seenClade.add(v.ott);
  const lineage = graftLineage(nid); if (!lineage) continue;
  entries.push({ keys: [normalizeName(v.name)], graft: { id: v.ott, sciName: v.name, common: null, rank: rankOf(v.ott), views: null, lineage } });
}

writeFileSync(resolve(ROOT, "src/data/guessIndex.generated.json"), JSON.stringify({ generatedAt: new Date().toISOString(), source: "Wikipedia-first pool × OTL topology", entries }));
const sp = entries.filter((e) => e.graft.rank === "species").length;
console.log(`✓ guessIndex: ${entries.length} entries (${sp} species, ${entries.length - sp} clades), ${orphan} orphaned (no shipped ancestor)`);
