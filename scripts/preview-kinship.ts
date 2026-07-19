// Throwaway: print the real Kinship boards for the next N days across weekday
// tiers, using the SAME rich tree (base + augment) + generator the app runs.
// Bundle like `npm run pin`. Reports the featured broad group, each group's rank,
// its members' pageviews, and flags any board that crosses a class boundary.
import { loadRichTree } from "../src/data/loadTaxonomy";
import { gridBoardFor } from "../src/data/gridDaily";

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

const start = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const days = Number(process.argv[3] ?? 21);

const tree = await loadRichTree();
const label = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
const views = (id: string) => tree.byId.get(id)?.views ?? 0;
const groupOf = (id: string): string => {
  let grp = "other";
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    const s = tree.byId.get(c)?.sciName;
    if (s && CLASS_MARKERS.has(s)) grp = CLASS_MARKERS.get(s)!;
  }
  return grp;
};

// The order-rank ancestor's id for a node (for "how many distinct orders do the four
// groups span" — 4 = very distinct/easy, 1 = all-siblings-in-one-order/hard).
const orderAncestor = (id: string): string => {
  let ord = "";
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    if (tree.byId.get(c)?.rank === "order") { ord = c; break; }
  }
  return ord || id;
};
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const trailNoun = (id: string) => (tree.byId.get(id)?.common ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean).pop() ?? "";
// A group is a name-giveaway when a trailing noun is shared by >2 members and appears
// in no other group on the board (you can sort it by the word alone).
const giveawayCount = (b: NonNullable<ReturnType<typeof gridBoardFor>>) => {
  const per = b.groups.map((g) => {
    const c = new Map<string, number>();
    for (const id of g.memberIds) { const w = trailNoun(id); if (w.length >= 3) c.set(w, (c.get(w) ?? 0) + 1); }
    return c;
  });
  let n = 0;
  per.forEach((c, gi) => {
    for (const [w, v] of c) if (v > 2 && !per.some((o, oi) => oi !== gi && (o.get(w) ?? 0) > 0)) { n++; break; }
  });
  return n;
};

let crossClass = 0, latinTiles = 0, repeats = 0;
const byTier = new Map<number, { spreads: number[]; medViews: number[]; giveaways: number[] }>();
const seenSig = new Map<string, string>(); // groupSig -> last date seen
for (let i = 0; i < days; i++) {
  const dk = shift(start, i);
  const wd = new Date(`${dk}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const b = gridBoardFor(tree, dk);
  if (!b) { console.log(`${dk} ${wd}: (no board)`); continue; }
  const sig = b.groups.map((g) => g.cladeId).sort().join(",");
  const prev = seenSig.get(sig);
  const dup = prev ? `  ⚠ REPEAT of ${prev}` : "";
  if (prev) repeats++;
  seenSig.set(sig, dk);
  const groups = new Set(b.groups.map((g) => groupOf(g.cladeId)));
  const cross = groups.size > 1 || groups.has("other");
  if (cross) crossClass++;
  const medViews = median(b.groups.flatMap((g) => g.memberIds.map(views)));
  const spread = new Set(b.groups.map((g) => orderAncestor(g.cladeId))).size; // distinct orders (4=easy,1=hard)
  const t = byTier.get(b.tier) ?? byTier.set(b.tier, { spreads: [], medViews: [], giveaways: [] }).get(b.tier)!;
  t.spreads.push(spread); t.medViews.push(medViews); t.giveaways.push(giveawayCount(b));
  console.log(`\n${dk} ${wd}  ·  tier ${b.tier}  ·  ${[...groups].join("+")}${cross ? "  ⚠ CROSS-CLASS" : ""}  ·  ${spread} orders · med ${medViews} views${dup}`);
  for (const g of b.groups) {
    const rank = tree.byId.get(g.cladeId)?.rank ?? "?";
    const mem = g.memberIds.map((id) => {
      const latin = !tree.byId.get(id)?.common;
      if (latin) latinTiles++;
      return `${label(id)}(${views(id)})${latin ? "⚠LATIN" : ""}`;
    });
    console.log(`   ▸ [${rank}] ${(g.label || g.sciLabel).padEnd(22)} :: ${mem.join(", ")}`);
  }
}
console.log(`\n=== ${days} days: ${crossClass} cross-class boards, ${latinTiles} Latin-only tiles, ${repeats} repeated group-sets ===`);
console.log(`\nTIER   avg distinct-orders (4=distinct/easy, 1=all-siblings/hard)   ·  avg median-views (fame)`);
for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
  const { spreads, medViews, giveaways } = byTier.get(tier)!;
  const avg = (xs: number[]) => (xs.reduce((a, x) => a + x, 0) / xs.length);
  console.log(`  ${tier}    views avg ${Math.round(avg(medViews))} / min ${Math.min(...medViews)}   ·   giveaway-groups avg ${avg(giveaways).toFixed(2)} / max ${Math.max(...giveaways)}   (n=${spreads.length})`);
}
