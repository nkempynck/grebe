import { describe, it, expect } from "vitest";
import taxonomy from "../data/taxonomy.json";
import { buildTree, mrca } from "./index";
import { generateGridBoard, checkGridSelection, GRID_GROUPS, GRID_GROUP_SIZE, GRID_TILES } from "./grid";

const tree = buildTree((taxonomy as { nodes: Parameters<typeof buildTree>[0] }).nodes);

const board = (date: string, tier: number) => {
  const b = generateGridBoard(tree, date, tier);
  if (!b) throw new Error(`no board for ${date} tier ${tier}`);
  return b;
};

// MRCA depth of a board's four group clades — the deeper, the more clustered
// (harder) the board.
const spreadDepth = (b: ReturnType<typeof board>) => {
  const ids = b.groups.map((g) => g.cladeId);
  const anc = ids.reduce((acc, id) => mrca(tree, acc, id));
  return tree.depthOf.get(anc) ?? 0;
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

  it("clusters groups more tightly as the tier rises (averaged over dates)", () => {
    const dates = Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`);
    const avg = (tier: number) =>
      dates.reduce((s, d) => s + spreadDepth(board(d, tier)), 0) / dates.length;
    expect(avg(7)).toBeGreaterThan(avg(1));
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
