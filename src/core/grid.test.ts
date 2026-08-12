import { describe, it, expect } from "vitest";
import taxonomy from "../data/taxonomy.json";
import augment from "../data/taxonomyAugment.json";
import { buildTree } from "./index";
import { mrca, separationTierOf } from "./tree";
import { generateGridBoard, checkGridSelection, GRID_GROUPS, GRID_GROUP_SIZE, GRID_TILES } from "./grid";

type Nodes = Parameters<typeof buildTree>[0];
const tree = buildTree((taxonomy as { nodes: Nodes }).nodes);
// The tree the GAME actually plays on: base + the Kinship/Branches augment (see
// loadRichTree). The weekday difficulty ramp only exists here — on the bare base tree
// the gradient is flat to slightly inverted — so any test of difficulty must use it.
const richTree = buildTree([
  ...(taxonomy as { nodes: Nodes }).nodes,
  ...(augment as { nodes: Nodes }).nodes,
]);

const board = (date: string, tier: number) => {
  const b = generateGridBoard(tree, date, tier);
  if (!b) throw new Error(`no board for ${date} tier ${tier}`);
  return b;
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

  it("ramps difficulty by group separation across the week", () => {
    // What makes a board hard is how CLOSE its four groups sit, and nothing else. This test
    // has been wrong twice, both times by asserting a ramp the generator did not produce:
    // first "Sunday's groups cluster more tightly" (separation was flat, 3.05 Mon to 3.70
    // Sun, so it passed on luck), then a RECOGNISABILITY ramp — real only while difficulty
    // was max(separation, obscurity). Obscurity is no longer difficulty: it made boards
    // unplayable rather than interesting (the two worst of 22 played boards were obscure and
    // well separated, at 0.02 and 0.11 of available points, while the tightest famous board
    // scored 0.64), and it cannot bite at all Mon-Wed where the tile names are printed. With
    // it gone the recognisability ramp INVERTS — tight boards are the famous ones, cats and
    // monkeys — so asserting it would now pin the bug we just removed.
    //
    // Measured, not guessed: the mean over pooled tiers, across eight different 16-date
    // windows, ran 1.16-1.22. Mean, not median: a board's separation is the median of six
    // pair-tiers and lands on a handful of discrete values, so a median-of-medians snaps to
    // 3.5 or 4.0 and reads a real ramp as exactly 1.0.
    const dates = Array.from({ length: 16 }, (_, i) => {
      const d = new Date("2026-06-29T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i * 7);
      return d.toISOString().slice(0, 10);
    });
    const median = (v: number[]) => {
      const s = [...v].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const separation = (ids: string[]) => {
      const pairs: number[] = [];
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) pairs.push(separationTierOf(richTree, mrca(richTree, ids[i], ids[j])));
      return median(pairs);
    };
    const meanAt = (tiers: number[]) => {
      const v = tiers.flatMap((tier) =>
        dates.map((d) => generateGridBoard(richTree, d, tier)).filter(Boolean).map((b) => separation(b!.groups.map((g) => g.cladeId)))
      );
      return v.reduce((a, b) => a + b, 0) / v.length;
    };
    expect(meanAt([5, 6, 7])).toBeGreaterThan(meanAt([1, 2, 3]) * 1.1);
  }, 30_000);
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
