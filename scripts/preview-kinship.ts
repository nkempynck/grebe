// Throwaway: print the real Kinship boards for the next N days across weekday
// tiers, using the SAME tree + generator the app runs. Bundle like `npm run pin`.
import { loadTree } from "../src/data/loadTaxonomy";
import { gridBoardFor } from "../src/data/gridDaily";

function shift(dateKey: string, d: number): string {
  const t = new Date(`${dateKey}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

const start = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const days = Number(process.argv[3] ?? 7);

const tree = await loadTree();
const label = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;

for (let i = 0; i < days; i++) {
  const dk = shift(start, i);
  const wd = new Date(`${dk}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const b = gridBoardFor(tree, dk);
  if (!b) { console.log(`${dk} ${wd}: (no board)`); continue; }
  console.log(`\n${dk} ${wd}  ·  tier ${b.tier}`);
  for (const g of b.groups) {
    const name = g.label || g.sciLabel;
    console.log(`   ▸ ${name.padEnd(24)} ${g.memberIds.map(label).join(", ")}`);
  }
}
