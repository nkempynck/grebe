// Select the IN-SET (Lineage answer pool) from the cleaned pool + topology:
//   - in-set view floor (INSET_FLOOR, default 1500) — recognizability bar for daily answers
//   - cap 3 species/genus (top by pageviews) — no single genus floods the pool
//   - prominence-SCALED family cap — how many a family contributes scales with its fame
//     (best-species views, blended with count of recognizable members so families famous
//     as a GROUP — ants, butterflies — go deeper too). Iconic ~12, mid ~7, obscure ~2.
// Writes node_modules/.cache/sel-inset.json (selected species). Run: node scripts/build-inset.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const FLOOR = Number(process.env.INSET_FLOOR ?? 1500);
const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));
const topo = JSON.parse(readFileSync(resolve(C, "sel-topology.json"), "utf8"));
const placed = new Set(topo.placedIds), ott = topo.ottByName;
const inTree = pool.filter((s) => { const o = ott[s.sci]; return o != null && placed.has(o); });

const capTop = (t) => t > 150000 ? 12 : t > 50000 ? 10 : t > 10000 ? 7 : t > 2000 ? 4 : 2;
const capRich = (r) => r >= 20 ? 12 : r >= 12 ? 10 : r >= 6 ? 8 : r >= 3 ? 6 : 0;

const byFam = new Map();
for (const s of inTree) { if (s.v < FLOOR) continue; if (!byFam.has(s.family)) byFam.set(s.family, []); byFam.get(s.family).push(s); }
const sel = [], caps = {};
for (const [fam, list] of byFam) {
  list.sort((a, b) => b.v - a.v);
  const cap = Math.max(capTop(list[0].v), capRich(list.filter((s) => s.v > 10000).length));
  caps[fam] = cap;
  const byGen = new Map();
  for (const s of list) { if (!byGen.has(s.genus)) byGen.set(s.genus, []); byGen.get(s.genus).push(s); }
  let sp = []; for (const g of byGen.values()) { g.sort((a, b) => b.v - a.v); sp.push(...g.slice(0, 3)); }
  sp.sort((a, b) => b.v - a.v); sel.push(...sp.slice(0, cap));
}
writeFileSync(resolve(C, "sel-inset.json"), JSON.stringify(sel));

const king = {}; for (const s of sel) king[s.kingdom] = (king[s.kingdom] ?? 0) + 1;
const byPhy = {}; for (const s of sel) byPhy[s.phylum] = (byPhy[s.phylum] ?? 0) + 1;
console.log(`✓ in-set (floor ${FLOOR}): ${sel.length} species | ${(100*king.Animalia/sel.length).toFixed(0)}% animal / ${king.Plantae} plant | ${new Set(sel.map((s)=>s.family)).size} families`);
console.log("  phyla:", JSON.stringify(Object.fromEntries(Object.entries(byPhy).sort((a, b) => b[1] - a[1]).slice(0, 10))));
const inset = new Set(sel.map((s) => s.sci));
const famous = ["Panthera leo","Homo sapiens","Felis catus","Equus caballus","Bos taurus","Apis mellifera","Balaenoptera musculus","Carcharodon carcharias","Varanus komodoensis","Danaus plexippus","Aurelia aurita","Enteroctopus dofleini","Helianthus annuus","Cannabis sativa","Cocos nucifera","Vitis vinifera","Podiceps cristatus","Lumbricus terrestris","Homarus americanus","Osphranter rufus"];
console.log("\nfamous-species check:");
for (const s of famous) console.log(`  ${inset.has(s) ? "✓" : "✗"} ${s}`);
