import { describe, it, expect } from "vitest";
import { loadTree, loadRichTree } from "./loadTaxonomy";
import { gridBoardFor } from "./gridDaily";
import { branchesBoardFor } from "./branchesDaily";
import { boardGroupOf, OTHER_GROUP } from "./clades";

// Kinship/Branches boards are generated from the RICH tree, but the per-clade history
// backfill runs on the stats page, which only has the BASE tree: it resolves a past
// day's clade from the day's pinned board (clade ids + species ids) without loading the
// augment chunk. That only works because a board's GROUP CLADES (families, genera) are
// base-tree nodes even when its species aren't — boardGroupOf takes the first id the
// tree knows. If a taxonomy rebuild ever breaks that, the bars would quietly lose
// history, so assert it here: the base tree must place every board, and agree with the
// rich tree about where.
describe("resolving a rich board's clade from the base tree", () => {
  // A full week, so every difficulty tier (Mon–Sun) is covered.
  const dates = ["2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"];

  it("places every Kinship and Branches board", async () => {
    const base = await loadTree();
    const rich = await loadRichTree();
    // Boards in a NAMED bucket (mammals, birds, …) rather than the catch-all. Some
    // boards genuinely belong in "Other animals" (molluscs and the like have no bucket
    // of their own), so this is a floor, not a demand that every board be named: it's
    // what catches a resolution that silently degrades to the catch-all for everything.
    let named = 0;

    for (const date of dates) {
      const kb = gridBoardFor(rich, date);
      expect(kb, `no Kinship board for ${date}`).toBeTruthy();
      const kIds = [...kb!.groups.map((g) => g.cladeId), ...kb!.tiles];
      expect(boardGroupOf(base, kIds), `Kinship ${date} unplaceable from the base tree`).not.toBeNull();
      expect(boardGroupOf(base, kIds), `Kinship ${date} base/rich disagree`).toBe(boardGroupOf(rich, kIds));

      const bb = branchesBoardFor(rich, date);
      expect(bb, `no Branches board for ${date}`).toBeTruthy();
      const bIds = [bb!.rootId, ...bb!.groupIds, ...bb!.leafIds];
      expect(boardGroupOf(base, bIds), `Branches ${date} unplaceable from the base tree`).not.toBeNull();
      expect(boardGroupOf(base, bIds), `Branches ${date} base/rich disagree`).toBe(boardGroupOf(rich, bIds));

      for (const gid of [boardGroupOf(base, kIds), boardGroupOf(base, bIds)]) {
        if (gid && gid !== OTHER_GROUP.id) named++;
      }
    }
    // 14 boards (a week of each game); nearly all should land in a named bucket.
    expect(named).toBeGreaterThanOrEqual(10);
  }, 120_000);
});
