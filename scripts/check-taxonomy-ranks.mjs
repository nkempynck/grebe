// Verify the ranks the BUILD injects. Reports; never edits.
//
// WHY THIS EXISTS. assemble-taxonomy stamps `sepRank` on unranked clades, and Kinship and
// Branches read their whole notion of "how closely related" off it (separationTierOf turns
// the MRCA's rank into a tier). A wrong rank there is invisible: nothing crashes, no test
// fails, the game just quietly scores two families as though they were one genus.
//
// It happened. Step 5 names a clade after the Wikidata parent taxon of the families below it,
// then asks Open Tree for that NAME's rank — a bare string, in a different database. Open
// Tree's only "Delphinoidea" is a sea snail genus, so the clade holding Delphinidae,
// Monodontidae and Phocoenidae was stamped `genus` and every pair of toothed whales under it
// read as genus-close. Nobody would have found that except by looking at a dolphin.
//
// TWO CHECKS, because neither catches the other's case:
//
//   STRUCTURE  A node's rank must be strictly broader than every ranked node beneath it. This
//              needs no network and no second opinion: it is the tree contradicting itself.
//              Catches Delphinoidea (genus over three families) and Ascaridida (infraorder
//              over an infraorder).
//
//   SOURCE     Compare each injected rank against Wikidata P105, read off the very QID the
//              NAME came from — no string lookup, so a homonym cannot get in. Catches a wrong
//              rank that happens not to contradict the tree, which structure alone cannot see.
//
//   AUGMENT    The Kinship/Branches augment injects no ranks of its own, but it does bring
//              genera and families and hangs them off base-tree clades, so it can invert the
//              tree from below the way a bad sepRank does from above. Its nodes are checked
//              against the nearest ranked ancestor they land under. Clean today; it is here
//              so that stays true when build-augment is next run.
//
// IT REPORTS, IT DOES NOT FIX, and that is deliberate. Ornithorhynchoidea is why: Wikidata
// says superfamily, the shipped value is `order`, and the shipped value is right — the node
// holds Tachyglossidae AND Ornithorhynchidae, so it is Monotremata under the wrong name, and
// applying P105 would score a platypus against an echidna as superfamily-close. A rank
// disagreement can mean the rank is wrong OR the name is; only a person can tell which.
//
// KNOWN is how that distinction survives. Everything already looked at and accepted is listed
// there with its reason, so a clean run prints nothing and anything new is genuinely new —
// which is the point of running it after a rebuild.
//
//   node scripts/check-taxonomy-ranks.mjs [--offline]
//
// Exit 1 when something not in KNOWN turns up. --offline skips the Wikidata half rather than
// failing, so the check is still useful without a network.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TAX = resolve(ROOT, "src/data/taxonomy.json");
const AUG = resolve(ROOT, "src/data/taxonomyAugment.json");
const FAMS = resolve(ROOT, "node_modules/.cache/sel-families.json");
const offline = process.argv.includes("--offline");

/** Accepted, with the reason. An entry here is a decision someone made; delete it and the
 *  check starts complaining again, which is what you want if the underlying data moves. */
const KNOWN = {
  structure: {
    // OTL treats these as SYNONYMS of the node above them, so our tree keeps a node at the
    // same rank inside its senior name. Equal ranks nested, which is odd but not wrong.
    "Dioscoreaceae": "Taccaceae is an OTL synonym of it, kept as a child node",
    "Alcedinidae": "Cerylidae is an OTL synonym of it, kept as a child node",
    "Coenagrionidae": "Pseudostigmatidae is an OTL synonym of it, kept as a child node",
    "Paguroidea": "Lithodoidea is an OTL synonym of it, kept as a child node",
    // Step 6 stamped `order` twice down one branch: on the true MRCA of the eels, and on the
    // node it NAMED Anguilliformes inside that, because Anguillidae sits outside the named
    // one. The name is a node too deep; the tier is the same either way, so nothing scores
    // differently. Keyed by id — the outer node is an unnamed junction.
    "mrcaott13841ott13845": "duplicate `order` on nested eel nodes; the inner one carries the name, both read tier 3",
  },
  augment: {},
  source: {
    // The node is misnamed, not misranked: it holds Tachyglossidae and Ornithorhynchidae, so
    // it is Monotremata, and `order` is right for its contents. Wikidata's superfamily is
    // right for the NAME. Fixing the name is a separate job.
    "Ornithorhynchoidea": "node is really Monotremata; shipped `order` describes its contents",
  },
};

/** Broad to narrow. Only ranks that appear in this tree; an unknown one is skipped rather
 *  than guessed at, since guessing its place is how a check invents a violation. */
const ORDER = [
  "domain", "kingdom", "subkingdom", "superphylum", "phylum", "subphylum", "infraphylum",
  "superclass", "class", "subclass", "infraclass", "subterclass", "cohort", "subcohort",
  "magnorder", "superorder", "order", "suborder", "infraorder", "parvorder",
  "superfamily", "family", "subfamily", "tribe", "subtribe",
  "genus", "subgenus", "species group", "species subgroup", "species", "subspecies",
];
const depth = new Map(ORDER.map((r, i) => [r, i]));

const doc = JSON.parse(readFileSync(TAX, "utf8"));
const nodes = doc.nodes;
const byId = new Map(nodes.map((n) => [n.id, n]));
const childrenOf = new Map();
for (const n of nodes) if (n.parentId) (childrenOf.get(n.parentId) ?? childrenOf.set(n.parentId, []).get(n.parentId)).push(n.id);

const injected = nodes.filter((n) => n.sepRank);
console.log(`checking ${injected.length} injected ranks in ${nodes.length} nodes`);

// ---- STRUCTURE ------------------------------------------------------------------------
const structural = [];
for (const n of injected) {
  // Some injected nodes are unnamed junctions, so the scientific name cannot be the key.
  const key = n.sciName || n.id;
  const mine = depth.get(n.sepRank);
  if (mine === undefined) { structural.push({ sci: key, why: `unknown rank "${n.sepRank}"` }); continue; }
  // Descend to the nearest RANKED node on each branch and stop: anything below that is
  // constrained by it, not by us, so reporting it too would just be noise.
  const stack = [...(childrenOf.get(n.id) ?? [])];
  while (stack.length) {
    const k = byId.get(stack.pop());
    const theirs = depth.get(k.sepRank ?? k.rank);
    if (theirs !== undefined) {
      if (theirs <= mine) {
        structural.push({
          sci: key,
          why: `stamped ${n.sepRank}, but contains ${k.sciName || k.id} (${k.sepRank ?? k.rank})`,
        });
      }
      continue;
    }
    for (const c of childrenOf.get(k.id) ?? []) stack.push(c);
  }
}

// ---- AUGMENT ---------------------------------------------------------------------------
// Read straight from the file rather than through a built tree: this script has no bundler,
// and the parent ids are enough. Every augment node hangs off a base node.
const augmented = [];
if (existsSync(AUG)) {
  const augDoc = JSON.parse(readFileSync(AUG, "utf8"));
  const augNodes = augDoc.nodes ?? augDoc;
  const all = new Map(byId);
  for (const n of augNodes) all.set(n.id, n);
  let checked = 0;
  for (const n of augNodes) {
    const mine = depth.get(n.sepRank ?? n.rank);
    if (mine === undefined) continue;
    checked++;
    for (let c = n.parentId; c; c = all.get(c)?.parentId) {
      const p = all.get(c);
      if (!p) break;
      const theirs = depth.get(p.sepRank ?? p.rank);
      if (theirs === undefined) continue;
      if (theirs >= mine) {
        augmented.push({ sci: n.sciName || n.id, why: `${n.sepRank ?? n.rank} sitting under ${p.sciName || p.id} (${p.sepRank ?? p.rank})` });
      }
      break;
    }
  }
  console.log(`checked ${checked} ranked augment nodes against their attachment points`);
} else {
  console.log(`no ${AUG} — skipping the augment check`);
}

// ---- SOURCE ---------------------------------------------------------------------------
const source = [];
let checkedAgainstWikidata = 0;
if (offline) {
  console.log("--offline: skipping the Wikidata cross-check");
} else if (!existsSync(FAMS)) {
  console.log(`no ${FAMS} — skipping the Wikidata cross-check (run the taxonomy build first)`);
} else {
  const fams = JSON.parse(readFileSync(FAMS, "utf8")).fams ?? {};
  // Name -> the QID the NAME came from. Both directions: a family is named by its own entity,
  // an injected parent clade by the P171 that produced it.
  const qidOf = new Map();
  for (const [qid, f] of Object.entries(fams)) {
    if (f.name) qidOf.set(f.name, qid);
    if (f.parentName && f.parent) qidOf.set(f.parentName, f.parent);
  }
  const targets = injected.filter((n) => qidOf.has(n.sciName));
  const qids = [...new Set(targets.map((n) => qidOf.get(n.sciName)))];

  const get = async (url) => {
    for (let i = 0; i < 5; i++) {
      try {
        const r = await fetch(url, { headers: { "user-agent": "GrebeGames/1.0 (rank check)" } });
        if (r.ok) return await r.json();
      } catch { /* retry */ }
      await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
    }
    return null;
  };
  const entities = async (ids, props) => {
    const out = {};
    for (let i = 0; i < ids.length; i += 50) {
      const d = await get(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=${props}&languages=en&ids=${ids.slice(i, i + 50).join("|")}`);
      if (!d) return null;
      Object.assign(out, d.entities ?? {});
    }
    return out;
  };

  const ents = await entities(qids, "claims");
  if (!ents) {
    console.log("could not reach Wikidata — skipping the cross-check rather than failing on it");
  } else {
    const rankItems = new Map();
    for (const [q, e] of Object.entries(ents)) {
      rankItems.set(q, (e.claims?.P105 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean));
    }
    const labelIds = [...new Set([...rankItems.values()].flat())];
    const labelEnts = (await entities(labelIds, "labels")) ?? {};
    const labelOf = (q) => labelEnts[q]?.labels?.en?.value ?? q;

    for (const n of targets) {
      const says = (rankItems.get(qidOf.get(n.sciName)) ?? []).map(labelOf);
      if (!says.length) continue;
      checkedAgainstWikidata++;
      if (!says.includes(n.sepRank)) {
        source.push({ sci: n.sciName, why: `stamped ${n.sepRank}, wikidata ${qidOf.get(n.sciName)} says ${says.join("/")}` });
      }
    }
    console.log(`cross-checked ${checkedAgainstWikidata} of them against Wikidata P105`);
  }
}

// ---- REPORT ---------------------------------------------------------------------------
const report = (title, found, known) => {
  const fresh = found.filter((f) => !(f.sci in known));
  const seen = found.filter((f) => f.sci in known);
  if (seen.length) console.log(`\n${title}: ${seen.length} known`);
  for (const f of seen) console.log(`    (known) ${f.sci}: ${known[f.sci]}`);
  if (fresh.length) {
    console.log(`\n${title}: ${fresh.length} NOT ACCOUNTED FOR`);
    for (const f of fresh) console.log(`    ${f.sci}: ${f.why}`);
  }
  return fresh.length;
};

const bad = report("structure", structural, KNOWN.structure)
  + report("augment", augmented, KNOWN.augment)
  + report("source", source, KNOWN.source);

if (bad) {
  console.log(`\n${bad} rank problem(s) to look at. Each is either a wrong RANK or a wrong NAME;`);
  console.log("decide which, fix it (see patch-seprank-homonyms.mjs for the shape), or add it");
  console.log("to KNOWN in this file with the reason it is acceptable.");
  process.exit(1);
}
console.log("\nno unaccounted rank problems");
