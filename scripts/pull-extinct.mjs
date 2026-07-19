// Flag which rich-tree species are EXTINCT (IUCN status Extinct / Extinct in the Wild),
// so we can measure and, if needed, filter them from Kinship/Branches. Recently-extinct
// species (dodo, thylacine) are NOT fossil taxa, so pull-species' fossil filter misses
// them — this catches them via Wikidata P141.
//   node scripts/pull-extinct.mjs
//   writes: node_modules/.cache/sel-extinct.json  { qids: [...] }
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const WDQS = "https://query.wikidata.org/sparql";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inset = JSON.parse(readFileSync(resolve(C, "sel-inset.json"), "utf8"));
const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));
const tax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const aug = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomyAugment.json"), "utf8"));
const qidBySci = new Map();
for (const s of [...inset, ...pool]) if (s.qid) qidBySci.set(s.sci, s.qid);
const sciInTree = new Set([...tax.nodes, ...aug.nodes].filter((n) => n.rank === "species").map((n) => n.sciName));
const qids = [...new Set([...sciInTree].map((sci) => qidBySci.get(sci)).filter(Boolean))];
console.log(`checking ${qids.length} QIDs for IUCN Extinct / Extinct-in-Wild status`);

async function sparql(q, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${WDQS}?format=json&query=${encodeURIComponent(q)}`, {
        headers: { "user-agent": "GrebeGames/1.0 (extinct)", accept: "application/sparql-results+json" },
      });
      if (r.ok) return (await r.json()).results.bindings;
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

// P141 = IUCN conservation status; Q237350 = Extinct (EX), Q239509 = Extinct in the Wild.
const extinct = new Set();
for (let i = 0; i < qids.length; i += 250) {
  const batch = qids.slice(i, i + 250);
  const vals = batch.map((q) => `wd:${q}`).join(" ");
  const rows = await sparql(`SELECT ?item WHERE { VALUES ?item { ${vals} } ?item wdt:P141 ?s. VALUES ?s { wd:Q237350 wd:Q239509 } }`);
  if (rows) for (const b of rows) extinct.add(b.item.value.split("/").pop());
  process.stderr.write(`  ${Math.min(i + 250, qids.length)}/${qids.length}\r`);
  await sleep(300);
}
process.stderr.write("\n");
writeFileSync(resolve(C, "sel-extinct.json"), JSON.stringify({ qids: [...extinct] }));
console.log(`✓ extinct: ${extinct.size} of ${qids.length} tree species flagged Extinct/EW`);
console.log(`  wrote ${resolve(C, "sel-extinct.json")}`);
