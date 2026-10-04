// Name unnamed clades from a species checklist snapshot (mdd-ranks.json, col-ranks.json), only
// where the name is provably right for the species we show. Shared by patch-mdd-names.mjs and
// patch-col-names.mjs, so every checklist is held to the same rule.
//
// THE RULE is exact membership on the RICH tree (base + augment), as in patch-ott-names.mjs: a
// junction J takes taxon T only if the species under J are exactly our in-scope species
// classified in T. Every species under J must match the checklist by binomial; one the checklist
// lists under another name counts toward its genus's taxa, so it can block a name but never earn
// one. The name must be a single Latin word not already on another node. When several taxa fit,
// the most specific rank wins; when several junctions share one species set, the deepest wins.
//
// WHAT IT WRITES: `sciName`, the checklist's rank in `sepRank` where it does not contradict the
// tree (never `rank`, see patch-ott-names.mjs), and provenance in `field`. A made-up Kinship
// label it replaces stops being `synthetic`. It first clears names it gave earlier (by `field`),
// so a rerun recomputes; names from steps that ran before it are left alone.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = resolve(ROOT, "src/data/taxonomy.json");
const AUG = resolve(ROOT, "src/data/taxonomyAugment.json");

// Same order as check-taxonomy-ranks.mjs, which verifies the result.
const ORDER = [
  "domain", "kingdom", "subkingdom", "superphylum", "phylum", "subphylum", "infraphylum",
  "superclass", "class", "subclass", "infraclass", "subterclass", "cohort", "subcohort",
  "magnorder", "superorder", "order", "suborder", "infraorder", "parvorder",
  "superfamily", "family", "subfamily", "tribe", "subtribe",
  "genus", "subgenus", "species group", "species subgroup", "species", "subspecies",
];

/**
 * @param {object} o
 * @param {string} o.snapshot   path under scripts/ of the checklist snapshot
 * @param {string} o.field      provenance field written on named nodes ("mddTaxon", "colTaxon")
 * @param {(n: object, byId: Map) => boolean} o.inScope  which species the checklist covers
 * @param {(sci: string) => string} [o.provenance]  extra provenance for a name, from one member
 * @param {boolean} [o.dry]
 */
export function applyChecklistNames({ snapshot, field, inScope, provenance, dry }) {
  const base = JSON.parse(readFileSync(BASE, "utf8"));
  const aug = JSON.parse(readFileSync(AUG, "utf8"));
  const list = JSON.parse(readFileSync(resolve(ROOT, "scripts", snapshot), "utf8"));
  const all = [...base.nodes, ...aug.nodes];
  const byId = new Map(all.map((n) => [n.id, n]));
  const kids = new Map();
  for (const n of all) if (n.parentId != null) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)).push(n.id);

  let cleared = 0;
  for (const n of all) if (n[field]) { n.sciName = ""; delete n.sepRank; delete n[field]; cleared++; }

  const speciesUnder = new Map();
  const under = (id) => {
    const hit = speciesUnder.get(id);
    if (hit) return hit;
    const n = byId.get(id);
    const out = n?.rank === "species" ? [id] : (kids.get(id) ?? []).flatMap(under);
    speciesUnder.set(id, out);
    return out;
  };
  const scoped = new Set(all.filter((n) => n.rank === "species" && inScope(n, byId)).map((n) => n.id));

  const genusRank = list.ranks.indexOf("genus");
  const genusTaxa = new Map();
  for (const idx of Object.values(list.species)) {
    const g = idx[genusRank];
    if (g >= 0 && !genusTaxa.has(list.taxa[g][1])) genusTaxa.set(list.taxa[g][1], idx);
  }
  const exact = new Map(), memberCount = new Map();
  let unmatched = 0;
  for (const id of scoped) {
    const sci = byId.get(id).sciName;
    const idx = list.species[sci];
    if (idx) exact.set(id, idx.filter((t) => t >= 0));
    else unmatched++;
    for (const t of (idx ?? genusTaxa.get(sci.split(" ")[0]) ?? []).filter((t) => t >= 0)) memberCount.set(t, (memberCount.get(t) ?? 0) + 1);
  }

  const LATIN_WORD = /^[A-Z][a-z]+$/;
  const usedNames = new Set(all.filter((n) => n.sciName && !n.synthetic).map((n) => n.sciName));
  const depth = (id) => { let d = 0; for (let x = id; x; x = byId.get(x)?.parentId) d++; return d; };
  const isUnnamed = (n) => n.rank !== "species" && (!n.sciName || n.synthetic) && !(n.common && !n.synthetic);

  const byTaxon = new Map();
  for (const n of all) {
    if (!isUnnamed(n)) continue;
    const L = under(n.id);
    if (L.length < 2 || !L.every((id) => scoped.has(id))) continue;
    const lists = L.map((id) => exact.get(id));
    if (lists.some((l) => !l)) continue;
    // Taxa every species shares, most specific first.
    const shared = [...lists[0]].reverse().filter((t) => lists.every((l) => l.includes(t)));
    const t = shared.find((x) => memberCount.get(x) === L.length);
    if (t === undefined) continue;
    const [, name] = list.taxa[t];
    if (!LATIN_WORD.test(name) || usedNames.has(name)) continue;
    const cur = byTaxon.get(t);
    const d = depth(n.id);
    if (!cur || d > cur.d || (d === cur.d && n.id < cur.id)) byTaxon.set(t, { id: n.id, d });
  }

  let replacedSynthetic = 0;
  const ranks = {};
  for (const [t, { id }] of byTaxon) {
    const n = byId.get(id);
    const [rank, name] = list.taxa[t];
    if (n.synthetic) { replacedSynthetic++; delete n.synthetic; delete n.common; delete n.wikiTitle; }
    n.sciName = name;
    const extra = provenance?.(byId.get(under(id)[0]).sciName);
    n[field] = `${rank} ${name}${extra ? ` (${extra})` : ""}`;
    n.sepRank = rank;
    ranks[rank] = (ranks[rank] ?? 0) + 1;
  }

  // A rank is only kept where it agrees with the tree: strictly narrower than every ranked
  // ancestor, strictly broader than every ranked descendant.
  const pos = (n) => { const i = ORDER.indexOf(n?.sepRank ?? n?.rank); return i < 0 ? null : i; };
  const contradicts = (id) => {
    const mine = pos(byId.get(id));
    if (mine == null) return false;
    for (let p = byId.get(id).parentId; p; p = byId.get(p)?.parentId) {
      const r = pos(byId.get(p));
      if (r != null && r >= mine) return true;
    }
    const stack = [...(kids.get(id) ?? [])];
    while (stack.length) {
      const c = stack.pop();
      const r = pos(byId.get(c));
      if (r != null && r <= mine) return true;
      stack.push(...(kids.get(c) ?? []));
    }
    return false;
  };
  let unranked = 0;
  for (let changed = true; changed; ) {
    changed = false;
    for (const { id } of byTaxon.values()) {
      const n = byId.get(id);
      if (n.sepRank && contradicts(id)) { delete n.sepRank; unranked++; changed = true; }
    }
  }

  console.log(`${list.source}: ${byTaxon.size} clades named (${replacedSynthetic} replaced a made-up Kinship label), ` +
    `${unmatched} of ${scoped.size} species matched only by genus${cleared ? `, ${cleared} earlier names recomputed` : ""}`);
  console.log(`  by rank: ${Object.entries(ranks).sort((a, b) => b[1] - a[1]).map(([r, k]) => `${r} ${k}`).join(", ")}` +
    (unranked ? `; ${unranked} named without a rank (the checklist's contradicts the tree's)` : ""));
  if (!dry) {
    base[`${field}Source`] = list.source;
    writeFileSync(BASE, JSON.stringify(base));
    writeFileSync(AUG, JSON.stringify(aug));
  }
  return { named: [...byTaxon.values()].map(({ id }) => byId.get(id)) };
}
