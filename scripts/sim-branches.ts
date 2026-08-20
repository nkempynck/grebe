// Branches variety/difficulty dump, mirroring sim-kinship: one compact JSON line per
// board so the same offline scans (repeats, group reuse, nested labels) work on both.
import { loadRichTree } from "../src/data/loadTaxonomy";
import { branchesBoardFor } from "../src/data/branchesDaily";

function shift(dateKey: string, d: number): string {
  const t = new Date(`${dateKey}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}
const start = process.argv[2] ?? "2026-08-20";
const days = Number(process.argv[3] ?? 365);
const tree = await loadRichTree();
const out: any[] = [];
for (let i = 0; i < days; i++) {
  const dk = shift(start, i);
  const b = branchesBoardFor(tree, dk);
  if (!b) { out.push({ d: dk, empty: true }); continue; }
  out.push({
    d: dk, tier: b.tier, rootId: b.rootId,
    groups: b.groupIds.map((g) => ({ id: g, sci: tree.byId.get(g)?.sciName ?? g })),
    slots: b.slotIds, anchors: b.anchorIds, leaves: b.leafIds,
  });
  if ((i + 1) % 100 === 0) process.stderr.write(`  ${i + 1}/${days}\r`);
}
process.stderr.write("\n");
console.log(JSON.stringify(out));
