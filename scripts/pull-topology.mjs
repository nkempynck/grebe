// OTL TOPOLOGY over the recognizable pool (sel-pool.json):
//   1. TNRS-match each species' accepted sci name -> OTT id
//   2. induced_subtree over those OTT ids -> shared Newick tree (prunes ids OTL can't
//      place, retrying) -> the branching structure + every clade's OTT id
//   3. parse Newick, report placement + tree shape
// Saves node_modules/.cache/sel-topology.json { ottByName, placed, newick }.
// The taxonomy.json (in-set) and guess-index (out-of-set) builds both derive from this.
// Run: node scripts/pull-topology.mjs
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OUT = resolve(C, "sel-topology.json");
const OTL = "https://api.opentreeoflife.org/v3";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function req(url, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const res = await fetch(url, opts); const text = await res.text(); const json = text ? JSON.parse(text) : null;
      if (res.ok) return json; if (res.status === 429 || res.status >= 500) { await sleep(600 * (i + 1)); continue; }
      return { __error: true, status: res.status, body: json ?? text };
    } catch { await sleep(600 * (i + 1)); }
  }
  return { __error: true, status: 0 };
}
const postJSON = (u, b) => req(u, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(b) });

async function tnrsMatch(names) {
  const out = new Map();
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200);
    const doc = await postJSON(`${OTL}/tnrs/match_names`, { names: chunk, do_approximate_matching: false });
    if (!doc || doc.__error) { process.stderr.write(`  tnrs @${i} err, retry\n`); await sleep(1500); i -= 200; continue; }
    for (const r of doc.results ?? []) { const t = r.matches?.[0]?.taxon; if (t?.ott_id) out.set(r.name, t.ott_id); }
    if (i % 1000 === 0) process.stderr.write(`  tnrs ${Math.min(i + 200, names.length)}/${names.length}\n`);
  }
  return out;
}
async function inducedSubtree(ottIds) {
  let ids = [...ottIds];
  for (let attempt = 0; attempt < 8; attempt++) {
    const doc = await postJSON(`${OTL}/tree_of_life/induced_subtree`, { ott_ids: ids, label_format: "name_and_id" });
    if (doc && !doc.__error && doc.newick) return { newick: doc.newick, ids };
    const body = doc?.body ?? doc; const bad = new Set();
    for (const field of ["unknown_ids", "node_ids_not_in_tree", "broken", "unknown"]) {
      const v = body?.[field];
      if (Array.isArray(v)) v.forEach((x) => bad.add(Number(String(x).replace(/\D/g, ""))));
      else if (v && typeof v === "object") Object.keys(v).forEach((x) => bad.add(Number(String(x).replace(/\D/g, ""))));
    }
    if (typeof body?.message === "string") for (const m of body.message.matchAll(/ott(\d+)/g)) bad.add(Number(m[1]));
    const before = ids.length; ids = ids.filter((id) => !bad.has(id));
    if (ids.length === before || ids.length === 0) return null;
    process.stderr.write(`  induced_subtree: pruned ${before - ids.length} unplaceable, retry (${ids.length} left)\n`);
  }
  return null;
}
// Newick parser tolerant of single-quoted labels.
function parseNewick(s) {
  s = s.trim().replace(/;\s*$/, ""); let i = 0;
  const readLabel = () => { let out = ""; if (s[i] === "'") { i++; while (i < s.length) { if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } i++; break; } out += s[i++]; } } else { while (i < s.length && !"(),".includes(s[i])) out += s[i++]; } return out.trim(); };
  const node = () => { const n = { children: [] }; if (s[i] === "(") { i++; do { n.children.push(node()); } while (s[i] === "," && ++i); i++; } n.label = readLabel(); return n; };
  return node();
}

const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));
const cache = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};

// 1) match names -> ott
let ottByName;
if (cache.ottByName) { ottByName = new Map(Object.entries(cache.ottByName)); console.error(`tnrs: cached (${ottByName.size})`); }
else {
  const names = [...new Set(pool.map((s) => s.sci))];
  process.stderr.write(`tnrs: matching ${names.length} names\n`);
  ottByName = await tnrsMatch(names);
  cache.ottByName = Object.fromEntries(ottByName);
  writeFileSync(OUT, JSON.stringify(cache));
}

// dedup: one species record per ott id (keep highest views)
const byOtt = new Map();
for (const s of pool) { const ott = ottByName.get(s.sci); if (ott == null) continue; const cur = byOtt.get(ott); if (!cur || s.v > cur.v) byOtt.set(ott, s); }
console.log(`matched to OTT: ${byOtt.size}/${pool.length} pool species`);

// 2) induced subtree
if (!cache.newick) {
  process.stderr.write(`induced_subtree over ${byOtt.size} taxa…\n`);
  const res = await inducedSubtree([...byOtt.keys()]);
  if (!res) { console.error("induced_subtree failed"); process.exit(1); }
  cache.newick = res.newick; cache.placedIds = res.ids;
  writeFileSync(OUT, JSON.stringify(cache));
}
console.log(`placed in synthetic tree: ${cache.placedIds.length}`);

// 3) parse + shape report
const root = parseNewick(cache.newick);
let clades = 0, leaves = 0, named = 0;
(function walk(n) { if (n.children.length === 0) { leaves++; return; } clades++; if (n.label && !/^mrca/i.test(n.label)) named++; n.children.forEach(walk); })(root);
console.log(`\n✓ topology: ${leaves} leaves, ${clades} internal nodes (${named} named clades)`);
console.log(`  saved: ${OUT} (ottByName, placedIds, newick)`);
