import { describe, it, expect } from "vitest";
import { loadTree, loadRichTree } from "./loadTaxonomy";
import { gridBoardFor } from "./gridDaily";
import { branchesBoardFor } from "./branchesDaily";
import { boardGroupOf, OTHER_GROUP } from "./clades";

// Kinship/Branches boards are generated from the RICH tree. A play is tagged with its clade
// group when it is played, from the rich tree (App.tsx, the game hooks), so the rich tree must
// place every board. The stats page also backfills days played before tagging existed, from
// their frozen pins and the BASE tree only (boardGroupOf takes the first id the tree knows).
// That legacy path is asserted where it can apply: when the base tree places a board, it must
// agree with the rich tree. It cannot place a board built wholly from augment-only clades
// (a teiid family, say), and those occur only on generated days, which are tagged at play.
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
      expect(boardGroupOf(rich, kIds), `Kinship ${date} unplaceable`).not.toBeNull();
      if (boardGroupOf(base, kIds)) expect(boardGroupOf(base, kIds), `Kinship ${date} base/rich disagree`).toBe(boardGroupOf(rich, kIds));

      const bb = branchesBoardFor(rich, date);
      expect(bb, `no Branches board for ${date}`).toBeTruthy();
      const bIds = [bb!.rootId, ...bb!.groupIds, ...bb!.leafIds];
      expect(boardGroupOf(rich, bIds), `Branches ${date} unplaceable`).not.toBeNull();
      if (boardGroupOf(base, bIds)) expect(boardGroupOf(base, bIds), `Branches ${date} base/rich disagree`).toBe(boardGroupOf(rich, bIds));

      for (const gid of [boardGroupOf(rich, kIds), boardGroupOf(rich, bIds)]) {
        if (gid && gid !== OTHER_GROUP.id) named++;
      }
    }
    // 14 boards (a week of each game); nearly all should land in a named bucket.
    expect(named).toBeGreaterThanOrEqual(10);
  }, 120_000);
});
