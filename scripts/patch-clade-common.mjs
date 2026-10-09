// Give Latin-only clades an English name (scripts/clade-names.json, from pull-clade-names.mjs):
// the title of their English Wikipedia article where that is a vernacular (Spheniscidae ->
// "Penguin", Bombus -> "Bumblebee"), else Wikidata's P1843 (Columbidae -> "Pigeons and doves").
// Offline.
//
// Only clades with no English name get one, never a made-up Kinship label (synthetic). The name
// comes from the Wikidata item that IS this clade: its taxon name (P225) must equal ours, or the
// item has none; an item that names a different taxon on a shared Open Tree id is ignored (see
// build-names.mjs). Names go through cleanCladeName, and the first usable one in sorted order is
// taken, so a rerun gives the same answer. Each name records `commonSource` ("Wikipedia title" or
// "Wikidata"); a rerun clears those first, so it is idempotent. CLADE_COMMON (src/data/cladeNames.ts) still wins at
// load time over whatever is written here.
//   node scripts/patch-clade-common.mjs [--dry] [--list N]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { cleanCladeName } from "./clean-common.mjs";
import { ottOf } from "./pull-clade-names.mjs";
import pluralize from "pluralize";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = resolve(ROOT, "src/data/taxonomy.json");
const AUG = resolve(ROOT, "src/data/taxonomyAugment.json");
const dry = process.argv.includes("--dry");
const listN = Number(process.argv[process.argv.indexOf("--list") + 1]) || 0;

const base = JSON.parse(readFileSync(BASE, "utf8"));
const aug = JSON.parse(readFileSync(AUG, "utf8"));
const snap = JSON.parse(readFileSync(resolve(ROOT, "scripts/clade-names.json"), "utf8"));
const all = [...base.nodes, ...aug.nodes];

let cleared = 0;
for (const n of all) if (n.commonSource) { delete n.common; delete n.commonSource; cleared++; }

// A Wikipedia title is only a vernacular if it is not itself a scientific name: Wikipedia files
// some groups under a synonym or a parent taxon, and those must not pass as English.
// Every taxon name we know of, ours and those of the three classifications we read, so a title
// that is just another Latin name ("Esocoidei", "Doridina") is not taken for English.
const sciNames = new Set(all.map((n) => n.sciName?.toLowerCase()).filter(Boolean));
const scriptsDir = resolve(ROOT, "scripts");
for (const [name] of Object.values(JSON.parse(readFileSync(resolve(scriptsDir, "ott-lineages.json"), "utf8")).taxa)) sciNames.add(String(name).toLowerCase());
for (const f of ["mdd-ranks.json", "col-ranks.json"]) for (const [, name] of JSON.parse(readFileSync(resolve(scriptsDir, f), "utf8")).taxa) sciNames.add(name.toLowerCase());
// Wikipedia also files some groups under a Latin SYNONYM none of those lists holds (Esociformes
// as "Esocoidei", Raphidae as "Raphina"), so one Latin-shaped word is refused too, except the
// English names that merely look Latin.
const LATIN_SHAPE = /^[A-Z][a-z]+(idae|inae|ini|oidea|oidei|oida|iformes|aceae|ales|ina|ida|ia|ala|ae|morpha|phyta|ata|acea|i)$/;
const ENGLISH_DESPITE_SHAPE = new Set(["Agouti", "Ani", "Aracari", "Gourami", "Hutia", "Sengi", "Uakari"]);
const isLatin = (t) => sciNames.has(t.toLowerCase()) || /^[A-Z][a-z]+ [a-z]+$/.test(t) || (LATIN_SHAPE.test(t) && !ENGLISH_DESPITE_SHAPE.has(t));
const fromTitle = (n) => {
  const raw = snap.titles?.[n.sciName];
  if (!raw) return null;
  const t = raw.replace(/\s*\([^)]*\)\s*$/, "").trim(); // "Rhinoceros (genus)" -> "Rhinoceros"
  if (t.toLowerCase() === n.sciName.toLowerCase() || isLatin(t)) return null;
  return cleanCladeName(t);
};
const fromWikidata = (n) => {
  const entries = snap.byOtt[ottOf(n) ?? ""] ?? [];
  const usable = entries.find((e) => e.sci && e.sci.toLowerCase() === n.sciName.toLowerCase()) ?? entries.find((e) => !e.sci);
  return (usable?.names ?? []).map(cleanCladeName).find((c) => c && c.toLowerCase() !== n.sciName.toLowerCase() && !isLatin(c)) ?? null;
};

// Group labels read in the plural ("Snakes", "Old World sparrows"), and Wikipedia titles its
// articles in the singular ("Penguin"). The last word is pluralised with the `pluralize` package,
// which knows the irregular and unchanging forms (cacti, deer, sheep); PLURAL_EXCEPTIONS fixes
// what it gets wrong. A "... family" name is already collective and stays as it is.
const PLURAL_EXCEPTIONS = {
  Grouse: "Grouse",
  Sandgrouse: "Sandgrouse",
  Krill: "Krill",
  Fowl: "Fowl",
  Pollock: "Pollock",
  Bonefish: "Bonefish",
  Woodlouse: "Woodlice",
  "Bird-of-paradise": "Birds-of-paradise",
};
const plural = (name) => {
  if (PLURAL_EXCEPTIONS[name]) return PLURAL_EXCEPTIONS[name];
  if (/ family$/i.test(name)) return name;
  const words = name.split(" ");
  words[words.length - 1] = pluralize(words[words.length - 1]);
  return words.join(" ");
};

// A name already on another node is only acceptable on a species INSIDE this clade (the genus
// Sphenodon and its one species are both "Tuatara", as Giraffa and the giraffe). Anywhere else it
// makes a typed guess ambiguous or reads twice down one branch: the plant Strelitzia is already
// "Bird-of-paradise", a goatfish already "Mullet", the family Trichechidae already "Manatee".
const byId = new Map(all.map((n) => [n.id, n]));
const holders = new Map(); // lower-cased name -> nodes already carrying it
for (const n of all) if (n.common) (holders.get(n.common.toLowerCase()) ?? holders.set(n.common.toLowerCase(), []).get(n.common.toLowerCase())).push(n);
const inside = (id, clade) => { for (let c = byId.get(id)?.parentId; c; c = byId.get(c)?.parentId) if (c === clade) return true; return false; };
const clashes = (n, name) => (holders.get(name.toLowerCase()) ?? []).some((o) => o.id !== n.id && !(o.rank === "species" && inside(o.id, n.id)));
let skipped = 0;

// The article title first: it is the name the English-speaking world files the group under
// ("Penguin", "Bumblebee"). Wikidata's P1843 fills gaps, and is thinner and less consistent.
const named = [];
const via = { "Wikipedia title": 0, Wikidata: 0 };
for (const n of all) {
  if (n.rank === "species" || n.common || n.synthetic || !n.sciName) continue;
  const t = fromTitle(n);
  const found = t ?? fromWikidata(n);
  if (!found || found.includes(",")) continue; // "Lacewings, Mantidflies" is a list, not a name
  const name = plural(found);
  if (clashes(n, name)) { skipped++; continue; }
  (holders.get(name.toLowerCase()) ?? holders.set(name.toLowerCase(), []).get(name.toLowerCase())).push(n);
  n.common = name;
  n.commonSource = t ? "Wikipedia title" : "Wikidata";
  via[n.commonSource]++;
  named.push(n);
}

// Then the hand-checked list (scripts/clade-names-checked.json): standard English names for
// groups no source names cleanly (Apoidea has no English name on Wikidata, Vespoidea's is a
// list). Only for clades still unnamed, and under the same clash rule.
const checked = JSON.parse(readFileSync(resolve(scriptsDir, "clade-names-checked.json"), "utf8")).names;
const hasAncestor = (n, sci) => { for (let c = n.parentId; c; c = byId.get(c)?.parentId) if (byId.get(c)?.sciName === sci) return true; return false; };
const checkedReport = { named: 0, alreadyNamed: [], clash: [], missing: [], ambiguous: [] };
for (const { sci, name, under } of checked) {
  const hits = all.filter((n) => n.sciName === sci && n.rank !== "species" && !n.synthetic && (!under || hasAncestor(n, under)));
  if (!hits.length) { checkedReport.missing.push(sci); continue; }
  if (hits.length > 1) { checkedReport.ambiguous.push(sci); continue; }
  const n = hits[0];
  if (n.common) { checkedReport.alreadyNamed.push(`${sci} (${n.common})`); continue; }
  if (clashes(n, name)) { checkedReport.clash.push(`${sci} -> ${name}`); continue; }
  (holders.get(name.toLowerCase()) ?? holders.set(name.toLowerCase(), []).get(name.toLowerCase())).push(n);
  n.common = name;
  n.commonSource = "Checked list";
  checkedReport.named++;
  named.push(n);
}
console.log(`checked list: ${checkedReport.named} of ${checked.length} applied`);
for (const k of ["alreadyNamed", "clash", "missing", "ambiguous"]) if (checkedReport[k].length) console.log(`  ${k}: ${checkedReport[k].join(", ")}`);

console.log(`snapshot ${snap.fetched}: ${named.length} Latin-only clades get an English name (${via["Wikipedia title"]} from Wikipedia titles, ${via.Wikidata} from Wikidata)${cleared ? `, ${cleared} earlier recomputed` : ""}; ${skipped} skipped, name already used elsewhere`);
if (listN) for (const n of [...named].sort((a, b) => (b.cladeViews ?? 0) - (a.cladeViews ?? 0)).slice(0, listN)) console.log(`  ${n.sciName} -> ${n.common}  [${n.commonSource}]`);
if (process.argv.includes("--plurals")) console.log(named.map((n) => n.common).sort().join(" | "));
if (!dry) {
  writeFileSync(BASE, JSON.stringify(base));
  writeFileSync(AUG, JSON.stringify(aug));
}
