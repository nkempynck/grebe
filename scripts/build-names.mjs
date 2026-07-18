// STEP 4: names. Attach common names to the assembled nodes (sel-nodes.json).
//   SPECIES: Wikipedia article title where it differs from the Latin name (free, from
//     the pull); for the Latin-only rest, look up Wikidata P1843 by QID. COMMON_NAME_
//     OVERRIDES win. Latin stays where nothing clean exists.
//   CLADES: Wikidata P1843 by OTT id (P9157), cleaned. (CLADE_COMMON is a load-time
//     overlay in the app, not baked here.)
// Writes node_modules/.cache/sel-nodes-named.json. Run: node scripts/build-names.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { COMMON_NAME_OVERRIDES } from "./common-name-overrides.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const WDQS = "https://query.wikidata.org/sparql";
const UA = "GrebeGames/1.0 (names)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sparql(q, tries = 4) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`${WDQS}?format=json&query=${encodeURIComponent(q)}`, { headers: { "user-agent": UA, accept: "application/sparql-results+json" } }); if (r.ok) return (await r.json()).results.bindings; if (r.status === 429 || r.status >= 500) { await sleep(1500 * (i + 1)); continue; } return null; } catch { await sleep(1500 * (i + 1)); } } return null; }

const GENERIC_CLADE_NAMES = new Set(["life","organism","organisms","animal","animals","plant","plants","fungus","fungi","mould","moulds","mold","molds","microbe","microbes","bacteria","creature","creatures","insect","insects","species","wildlife","vertebrate","vertebrates","invertebrate","invertebrates"]);
const FOREIGN_MARKERS = new Set(["de","la","el","del","los","las","da","do","dos","das","roja","rojo","negra","negro","verde","comun","gato","perro","cavalo","ular","kura","ikan","burung","pokok","ardilla","berleher"]);
function cleanCommon(name) {
  if (!name) return null; const n = name.trim();
  if (n.length < 2 || n.length > 30) return null;
  if (/[0-9(){}\[\]\/]/.test(n)) return null;
  if (/[^\x00-\x7F]/.test(n)) return null;
  if (n === n.toUpperCase() && n.length <= 5) return null;
  if (n.split(/\s+/).length > 4) return null;
  const norm = n === n.toUpperCase() ? n.toLowerCase() : n;
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}
function cleanCladeName(name) {
  let cc = cleanCommon((name ?? "").replace(/,?\s+and allies$/i, "").trim());
  if (!cc) return null;
  if (/\bindet\b/i.test(cc) || /\bspecies$/i.test(cc) || /\bsect\.?\b/i.test(cc)) return null;
  const words = cc.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.every((w) => GENERIC_CLADE_NAMES.has(w))) return null;
  if (words.some((w) => FOREIGN_MARKERS.has(w))) return null;
  if (/\b([a-z]{3,})-\1\b/i.test(cc)) return null;
  return cc.replace(/\b(And|Or|Of|The|In)\b/g, (m) => m.toLowerCase());
}

const nodes = JSON.parse(readFileSync(resolve(C, "sel-nodes.json"), "utf8"));
const inset = JSON.parse(readFileSync(resolve(C, "sel-inset.json"), "utf8"));
const bySci = new Map(inset.map((s) => [s.sci, s]));

// ---- species: Wikipedia title, else queue for P1843 ----
const speciesNodes = nodes.filter((n) => n.rank === "species");
const needP1843 = []; // {node, qid}
for (const n of speciesNodes) {
  const rec = bySci.get(n.sciName);
  const title = rec?.article;
  if (title && title.toLowerCase() !== n.sciName.toLowerCase()) n.common = title;         // Wikipedia common name
  else if (rec?.qid) needP1843.push({ node: n, qid: rec.qid });                            // Latin-only -> try P1843
}
console.log(`species: ${speciesNodes.filter((n) => n.common).length} named from Wikipedia titles; ${needP1843.length} to try via P1843`);

async function p1843ByQid(items) {
  const found = new Map();
  for (let i = 0; i < items.length; i += 150) {
    const batch = items.slice(i, i + 150);
    const vals = batch.map((x) => `wd:${x.qid}`).join(" ");
    const rows = await sparql(`SELECT ?item (GROUP_CONCAT(DISTINCT ?cn;separator="|") AS ?cns) WHERE { VALUES ?item { ${vals} } ?item wdt:P1843 ?cn. FILTER(lang(?cn)="en") } GROUP BY ?item`);
    if (rows) for (const b of rows) found.set(b.item.value.split("/").pop(), (b.cns?.value ?? "").split("|"));
    process.stderr.write(`  p1843 species ${Math.min(i + 150, items.length)}/${items.length}\r`);
    await sleep(200);
  }
  return found;
}
const spFound = await p1843ByQid(needP1843);
let spFilled = 0;
for (const { node, qid } of needP1843) { const cn = (spFound.get(qid) ?? []).map(cleanCommon).find((c) => c && c.toLowerCase() !== node.sciName.toLowerCase()); if (cn) { node.common = cn; spFilled++; } }
process.stderr.write("\n");
console.log(`species: +${spFilled} filled from P1843`);

// ---- clades: P1843 by OTT id (P9157) ----
const cladeNodes = nodes.filter((n) => n.rank !== "species" && n.sciName && /^ott\d+$/.test(n.id));
async function p1843ByOtt(list) {
  const found = new Map();
  for (let i = 0; i < list.length; i += 150) {
    const batch = list.slice(i, i + 150);
    const vals = batch.map((n) => `"${n.id.replace(/^ott/, "")}"`).join(" ");
    const rows = await sparql(`SELECT ?ott (GROUP_CONCAT(DISTINCT ?cn;separator="|") AS ?cns) WHERE { VALUES ?ott { ${vals} } ?item wdt:P9157 ?ott; wdt:P1843 ?cn. FILTER(lang(?cn)="en") } GROUP BY ?ott`);
    if (rows) for (const b of rows) found.set(b.ott.value, (b.cns?.value ?? "").split("|"));
    process.stderr.write(`  p1843 clades ${Math.min(i + 150, list.length)}/${list.length}\r`);
    await sleep(200);
  }
  return found;
}
const clFound = await p1843ByOtt(cladeNodes);
let clFilled = 0;
for (const n of cladeNodes) { const cn = (clFound.get(n.id.replace(/^ott/, "")) ?? []).map(cleanCladeName).find((c) => c && c.toLowerCase() !== n.sciName.toLowerCase()); if (cn) { n.common = cn; clFilled++; } }
process.stderr.write("\n");
console.log(`clades: ${clFilled}/${cladeNodes.length} named from P1843`);

// ---- overrides win (species) ----
let overridden = 0;
for (const n of speciesNodes) if (COMMON_NAME_OVERRIDES[n.sciName]) { n.common = COMMON_NAME_OVERRIDES[n.sciName]; overridden++; }
console.log(`applied ${overridden} COMMON_NAME_OVERRIDES`);

writeFileSync(resolve(C, "sel-nodes-named.json"), JSON.stringify(nodes));
const spNamed = speciesNodes.filter((n) => n.common).length;
console.log(`\n✓ names done. species ${spNamed}/${speciesNodes.length} (${(100*spNamed/speciesNodes.length).toFixed(0)}%) have a common name; clades ${clFilled}/${cladeNodes.length}`);
