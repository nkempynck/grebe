// Wiki titles for clades. Sets `wikiTitle` on every non-species node whose English
// Wikipedia article isn't reachable from its bare Latin name.
//
// Why it's needed: uninomial names (genus and above) are NOT unique on Wikipedia.
// The app asks for the sciName, so "Linaria" (the finch genus) lands on Linaria the
// toadflax, "Acer" on Acer Inc., "Glycine" on the amino acid, "Cydia" on the iOS
// package manager. Baking the right title fixes it everywhere at once — wikipedia.ts
// already prefers node.wikiTitle over sciName.
//
// The lookup keys on the OTT id (Wikidata P9157), never on the name — that's what
// makes it immune to homonyms, since the finch and the toadflax are different items.
// Same reused-ott guard as build-names.mjs: OTL hands some ids to both a clade and a
// tip, so an item whose P225 disagrees with our sciName is the species, not our clade.
//
// Reads + writes src/data/taxonomy.json in place (a patch, not a rebuild: the species
// set and the topology are untouched, so frozen daily puzzles stay valid).
// Run: node scripts/patch-wiki-titles.mjs [--dry]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = resolve(ROOT, "src/data/taxonomy.json");
const DRY = process.argv.includes("--dry");
const WDQS = "https://query.wikidata.org/sparql";
const UA = "GrebeGames/1.0 (wiki titles)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sparql(q, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${WDQS}?format=json&query=${encodeURIComponent(q)}`, {
        headers: { "user-agent": UA, accept: "application/sparql-results+json" },
      });
      if (r.ok) return (await r.json()).results.bindings;
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

const data = JSON.parse(readFileSync(FILE, "utf8"));
const nodes = data.nodes.filter((n) => n.rank !== "species" && n.sciName && /^ott\d+$/.test(n.id));
console.log(`${nodes.length} clade nodes with an ott id`);

// ott -> { title, sci }. P225 rides along for the reused-ott guard.
const found = new Map();
for (let i = 0; i < nodes.length; i += 150) {
  const batch = nodes.slice(i, i + 150);
  const vals = batch.map((n) => `"${n.id.replace(/^ott/, "")}"`).join(" ");
  const rows = await sparql(
    `SELECT ?ott ?article ?sci WHERE { VALUES ?ott { ${vals} } ?item wdt:P9157 ?ott.
     ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>.
     OPTIONAL { ?item wdt:P225 ?sci } }`
  );
  if (rows) {
    for (const b of rows) {
      const title = decodeURIComponent(b.article.value.split("/wiki/")[1]).replace(/_/g, " ");
      found.set(b.ott.value, { title, sci: b.sci?.value ?? null });
    }
  }
  process.stderr.write(`  ${Math.min(i + 150, nodes.length)}/${nodes.length}\r`);
  await sleep(300);
}
process.stderr.write("\n");

let set = 0, same = 0, reuse = 0, miss = 0, cleared = 0;
for (const n of nodes) {
  const hit = found.get(n.id.replace(/^ott/, ""));
  if (!hit) { miss++; continue; }
  if (hit.sci && hit.sci !== n.sciName) { reuse++; continue; } // the tip sharing this ott, not our clade
  if (hit.title === n.sciName) {
    if (n.wikiTitle) { delete n.wikiTitle; cleared++; } // a previous run's title Wikidata has since moved
    same++;
    continue;
  }
  if (n.wikiTitle !== hit.title) set++;
  n.wikiTitle = hit.title;
}
console.log(`wikiTitle set/updated on ${set}; already reachable by sciName ${same} (cleared ${cleared}); ott reused by a tip ${reuse}; no wikidata article ${miss}`);

if (DRY) { console.log("--dry: taxonomy.json not written"); process.exit(0); }
data.wikiTitlesPatchedAt = new Date().toISOString();
writeFileSync(FILE, JSON.stringify(data, null, 2));
console.log(`wrote ${FILE}`);
