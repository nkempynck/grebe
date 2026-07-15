// Throwaway: print the real opening schedule (all three games) for N days from a
// start date, using the SAME tree + generators the app runs and the pinner freezes.
// Bundle like `npm run pin`. Usage: preview-schedule.ts [start=DAILY_EPOCH] [days=14]
import { loadTree } from "../src/data/loadTaxonomy";
import { dailyAnswerFor, resolveDailyRules } from "../src/data/dailySchedule";
import { gridBoardFor } from "../src/data/gridDaily";
import { branchesBoardFor } from "../src/data/branchesDaily";
import { SCOPE_PRESETS } from "../src/data/presets";
import { DAILY_EPOCH, dailyNumber } from "../src/core";

function shift(dateKey: string, d: number): string {
  const t = new Date(`${dateKey}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
}

const start = process.argv[2] ?? DAILY_EPOCH;
const days = Number(process.argv[3] ?? 14);

const tree = await loadTree();
const name = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
const scopeLabel = (id: string) => SCOPE_PRESETS.find((s) => s.id === id)?.label ?? id;

for (let i = 0; i < days; i++) {
  const dk = shift(start, i);
  const wd = new Date(`${dk}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const r = resolveDailyRules(dk);
  const num = dailyNumber(dk);

  // Lineage: the day's answer + scope + how close counts as a win.
  const ans = dailyAnswerFor(tree, dk);
  const win = r.config.winWithin;

  // Kinship: the four group labels.
  const kb = gridBoardFor(tree, dk);
  const kGroups = kb ? kb.groups.map((g) => g.label || g.sciLabel).join(", ") : "(none)";

  // Branches: root clade + how many species to place.
  const bb = branchesBoardFor(tree, dk);
  const bRoot = bb ? name(bb.rootId) : "(none)";
  const bSlots = bb ? bb.slotIds.length : 0;

  console.log(`\n#${num}  ${dk} ${wd}  ·  tier ${r.tier} (${r.difficulty})`);
  console.log(`   LINEAGE   ${name(ans).padEnd(26)} scope: ${scopeLabel(r.config.scopeRootId)}  win@${win}  ${r.assist ? "assist" : "no-assist"}`);
  console.log(`   KINSHIP   ${kGroups}`);
  console.log(`   BRANCHES  ${bSlots} to place under ${bRoot}`);
}
