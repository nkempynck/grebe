import { describe, it, expect } from "vitest";
import taxonomy from "../data/taxonomy.json";
import { buildTree, mrca } from "./index";
import { generateGridBoard, gridBoardForSeed, checkGridSelection, GRID_GROUPS, GRID_GROUP_SIZE, GRID_TILES } from "./grid";

const tree = buildTree((taxonomy as { nodes: Parameters<typeof buildTree>[0] }).nodes);

const board = (date: string, tier: number) => {
  const b = generateGridBoard(tree, date, tier);
  if (!b) throw new Error(`no board for ${date} tier ${tier}`);
  return b;
};

// Board tightness = MEDIAN over the six group-pairs of their MRCA depth (deeper = more
// clustered = harder). Median (not the single all-four MRCA) matches the generator's own
// difficulty measure: it's robust to one distant outlier group among three tight ones.
const spreadDepth = (b: { groups: { cladeId: string }[] }) => {
  const ids = b.groups.map((g) => g.cladeId);
  const pd: number[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) pd.push(tree.depthOf.get(mrca(tree, ids[i], ids[j])) ?? 0);
  pd.sort((a, z) => a - z);
  return (pd[Math.floor((pd.length - 1) / 2)] + pd[Math.ceil((pd.length - 1) / 2)]) / 2;
};

describe("generateGridBoard", () => {
  it("produces a full board at every weekday tier", () => {
    for (let tier = 1; tier <= 7; tier++) {
      const b = board("2026-07-15", tier);
      expect(b.groups).toHaveLength(GRID_GROUPS);
      for (const g of b.groups) expect(g.memberIds).toHaveLength(GRID_GROUP_SIZE);
      expect(b.tiles).toHaveLength(GRID_TILES);
    }
  });

  it("tiles are exactly the group members, all distinct", () => {
    const b = board("2026-07-16", 4);
    expect(new Set(b.tiles).size).toBe(GRID_TILES);
    const members = new Set(b.groups.flatMap((g) => g.memberIds));
    expect(new Set(b.tiles)).toEqual(members);
  });

  it("every group carries a non-empty label", () => {
    for (let tier = 1; tier <= 7; tier++) {
      for (const g of board("2026-07-15", tier).groups) {
        expect(g.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("is deterministic for a given date + tier", () => {
    expect(JSON.stringify(board("2026-07-16", 4))).toBe(JSON.stringify(board("2026-07-16", 4)));
  });

  it("varies across dates", () => {
    const sigs = Array.from({ length: 8 }, (_, i) =>
      board(`2026-08-0${i + 1}`, 4).groups.map((g) => g.cladeId).sort().join(",")
    );
    expect(new Set(sigs).size).toBeGreaterThan(1);
  });

  it("clusters groups more tightly on harder tiers (median over many boards)", () => {
    // Sample many boards per tier via the seed path (no epoch replay → fast) and compare
    // average tightness. The gradient is gentle by design (difficulty is carried mainly by
    // the reveal mode), so average over a big sample rather than asserting per-board.
    const seeds = Array.from({ length: 60 }, (_, i) => `grid-test-${i}`);
    const avg = (tier: number) => {
      const ds = seeds.map((s) => gridBoardForSeed(tree, s, tier)).filter(Boolean).map((b) => spreadDepth(b!));
      return ds.reduce((a, x) => a + x, 0) / ds.length;
    };
    expect(avg(7)).toBeGreaterThan(avg(1)); // Sunday boards tighter than Monday's
  });
});

describe("checkGridSelection", () => {
  const b = board("2026-07-16", 4);

  it("resolves each solution group to its own index", () => {
    b.groups.forEach((g, i) => {
      expect(checkGridSelection(b, g.memberIds).solvedIndex).toBe(i);
    });
  });

  it("flags a three-of-four selection as one away", () => {
    const near = [...b.groups[0].memberIds.slice(0, 3), b.groups[1].memberIds[0]];
    const res = checkGridSelection(b, near);
    expect(res.solvedIndex).toBeNull();
    expect(res.oneAway).toBe(true);
  });

  it("rejects a wrong-sized selection", () => {
    expect(checkGridSelection(b, b.groups[0].memberIds.slice(0, 3)).solvedIndex).toBeNull();
  });
});
