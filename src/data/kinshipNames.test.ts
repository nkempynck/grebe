import { describe, it, expect } from "vitest";
import { loadRichTree } from "./loadTaxonomy";
import { gridBoardFor } from "./gridDaily";

// A few species share an English name across genera ("Crab spider", the alpaca twice), so two
// tiles on one board could read identically. The generator refuses that; check a span of days.
describe("Kinship tile names", () => {
  it("are unique on every board", async () => {
    const tree = await loadRichTree();
    const dups: string[] = [];
    for (let i = 0; i < 28; i++) {
      const date = new Date(Date.UTC(2026, 9, 5 + i)).toISOString().slice(0, 10);
      const board = gridBoardFor(tree, date);
      if (!board) continue;
      const names = board.tiles.map((id) => (tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id).toLowerCase());
      if (new Set(names).size !== names.length) dups.push(date);
    }
    expect(dups).toEqual([]);
  }, 300_000);
});
