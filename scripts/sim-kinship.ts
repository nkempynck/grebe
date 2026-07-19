// Dump every Kinship board over a long horizon as compact JSON, for offline analysis
// (repeats, variety, group mix, tile reuse, extinct fraction). Uses the SAME rich tree +
// generator the app runs. Bundle with esbuild like preview-kinship, then:
//   node <bundle> <startDate> <days>  > boards.json
import { loadRichTree } from "../src/data/loadTaxonomy";
import { gridBoardFor } from "../src/data/gridDaily";
import { mrca } from "../src/core/tree";

function shift(dateKey: string, d: number): string {
  const t = new Date(`${dateKey}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

const CLASS_MARKERS = new Map<string, string>();
for (const [g, ms] of Object.entries({
  Mammals: ["Mammalia"], Birds: ["Aves"], Fish: ["Actinopterygii", "Elasmobranchii", "Chondrichthyes"],
  Reptiles: ["Squamata", "Testudines", "Crocodylia"], Amphibians: ["Amphibia"], Insects: ["Insecta"],
  Plants: ["Magnoliopsida", "Liliopsida", "Pinopsida", "Polypodiopsida"],
  Molluscs: ["Gastropoda", "Bivalvia", "Cephalopoda"], Spiders: ["Arachnida"],
})) for (const m of ms) CLASS_MARKERS.set(m, g);

const start = process.argv[2] ?? "2025-07-21";
const days = Number(process.argv[3] ?? 1095);
const tree = await loadRichTree();
const groupOf = (id: string): string => {
  let grp = "other";
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    const s = tree.byId.get(c)?.sciName;
    if (s && CLASS_MARKERS.has(s)) grp = CLASS_MARKERS.get(s)!;
  }
  return grp;
};

const out: any[] = [];
for (let i = 0; i < days; i++) {
  const dk = shift(start, i);
  const b = gridBoardFor(tree, dk);
  if (!b) { out.push({ d: dk, tier: 0, empty: true }); continue; }
  const ids = b.groups.map((g) => g.cladeId);
  const mrcaId = ids.reduce((a, c) => mrca(tree, a, c));
  // median over the six group-pairs of their MRCA tree-depth (deeper = tighter = harder)
  const pd: number[] = [];
  for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++) pd.push(tree.depthOf.get(mrca(tree, ids[x], ids[y])) ?? 0);
  pd.sort((a, c) => a - c);
  out.push({
    d: dk,
    tier: b.tier,
    medPairDepth: (pd[2] + pd[3]) / 2,
    mrcaRank: tree.byId.get(mrcaId)?.rank ?? "?",
    groups: b.groups.map((g) => ({
      id: g.cladeId,
      rank: tree.byId.get(g.cladeId)?.rank ?? "?",
      grp: groupOf(g.cladeId),
      tiles: g.memberIds.map((m) => ({ id: m, sci: tree.byId.get(m)?.sciName ?? m })),
    })),
  });
  if ((i + 1) % 200 === 0) process.stderr.write(`  ${i + 1}/${days}\r`);
}
process.stderr.write("\n");
process.stdout.write(JSON.stringify(out));
