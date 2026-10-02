// Find which base-tree species are EXTINCT, and write the committed list that
// patch-extinct.mjs stamps onto src/data/taxonomy.json.
//
// WHY. Mosaic is a photo game, and an extinct animal has no photograph of a living one: the
// pictures are skulls, mounted skins and paintings, which test whether you recognise a museum
// specimen rather than the animal. Mosaic's answer pool skips anything flagged here. The other
// games do not read the flag: their clues are the tree, and the tree is the same alive or dead.
//
// TWO SIGNALS, because neither is enough alone:
//   - IUCN status Extinct (Wikidata P141 = Q237350). The IUCN only assesses extinctions since
//     1500, so it misses anything older: Haast's eagle (gone around 1400) is not on it.
//   - Instance of "extinct taxon" (P31 = Q98961713), which is how Wikidata marks those.
// Extinct in the Wild (Q239509) is deliberately NOT included: Spix's macaw survives in
// captivity and is photographed alive.
//
//   node scripts/pull-extinct.mjs        (needs the sel-*.json caches from pull-species)
//   writes: scripts/extinct-taxa.json    then run patch-extinct.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const C = resolve(ROOT, "node_modules/.cache");
const OUT = resolve(ROOT, "scripts/extinct-taxa.json");
const WDQS = "https://query.wikidata.org/sparql";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const inset = JSON.parse(readFileSync(resolve(C, "sel-inset.json"), "utf8"));
const pool = JSON.parse(readFileSync(resolve(C, "sel-pool.json"), "utf8"));
const tax = JSON.parse(readFileSync(resolve(ROOT, "src/data/taxonomy.json"), "utf8"));
const qidBySci = new Map();
for (const s of [...inset, ...pool]) if (s.qid) qidBySci.set(s.sci, s.qid);
const sciByQid = new Map();
for (const n of tax.nodes) {
  const q = n.rank === "species" ? qidBySci.get(n.sciName) : undefined;
  if (q) sciByQid.set(q, n.sciName);
}
const qids = [...sciByQid.keys()];
console.log(`checking ${qids.length} base-tree QIDs for extinction`);

async function sparql(q, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(WDQS, {
        method: "POST",
        headers: {
          "user-agent": "GrebeGames/1.0 (extinct)",
          accept: "application/sparql-results+json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: `query=${encodeURIComponent(q)}`,
      });
      if (r.ok) return (await r.json()).results.bindings;
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
      return null;
    } catch { await sleep(2000 * (i + 1)); }
  }
  return null;
}

// Wikidata errors, overruled here so a rerun cannot bring them back.
const NOT_EXTINCT = new Set([
  "Bettongia penicillata", // woylie: Wikidata says IUCN EX; it is Critically Endangered and alive
]);

const found = new Map(); // sci -> reasons
for (let i = 0; i < qids.length; i += 250) {
  const vals = qids.slice(i, i + 250).map((q) => `wd:${q}`).join(" ");
  const rows = await sparql(`SELECT ?item ?why WHERE { VALUES ?item { ${vals} }
    { ?item wdt:P141 wd:Q237350. BIND("IUCN EX" AS ?why) }
    UNION { ?item wdt:P31 wd:Q98961713. BIND("extinct taxon" AS ?why) } }`);
  if (!rows) {
    console.error(`Wikidata query failed at batch ${i}; refusing to write a partial list.`);
    process.exit(1);
  }
  for (const b of rows) {
    const sci = sciByQid.get(b.item.value.split("/").pop());
    if (NOT_EXTINCT.has(sci)) continue;
    found.set(sci, [...new Set([...(found.get(sci) ?? []), b.why.value])]);
  }
  process.stderr.write(`  ${Math.min(i + 250, qids.length)}/${qids.length}\r`);
  await sleep(300);
}
process.stderr.write("\n");

const species = Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)).map(([s, w]) => [s, w.join(", ")]));
writeFileSync(OUT, JSON.stringify({
  built: new Date().toISOString().slice(0, 10),
  note: "Written by scripts/pull-extinct.mjs, applied by scripts/patch-extinct.mjs. Hand additions are fine.",
  species,
}, null, 2) + "\n");
console.log(`✓ ${found.size} of ${qids.length} species extinct; wrote ${OUT}`);
