import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import { buildTree } from "../core";
import { dailyAnswerFor, resolveDailyRules } from "./dailySchedule";
import { gridBoardFor } from "./gridDaily";
import { computePuzzle, encodePuzzle, kinshipBoard } from "./pinnedPuzzles";

const tree = buildTree((taxonomy as { nodes: Parameters<typeof buildTree>[0] }).nodes);

// The registry's compute() MUST equal the live generators — it's both the read
// fallback and what the pinner freezes, so any drift would freeze a puzzle that
// doesn't match what an offline/un-pinned player computes.
describe("puzzle resolver parity", () => {
  const dates = ["2026-07-09", "2026-08-15", "2026-12-25", "2027-03-01"];

  it("lineage compute matches dailyAnswerFor + resolveDailyRules", () => {
    for (const d of dates) {
      const p = computePuzzle("lineage", tree, d)!;
      const rules = resolveDailyRules(d);
      expect(p.answerId).toBe(dailyAnswerFor(tree, d));
      expect(p.scopeRootId).toBe(rules.config.scopeRootId);
      expect(p.winWithin).toBe(rules.config.winWithin);
      expect(p.assist).toBe(rules.assist);
      expect(p.tier).toBe(rules.tier);
    }
  });

  it("kinship compute matches gridBoardFor", () => {
    for (const d of dates) {
      const p = computePuzzle("kinship", tree, d)!;
      const board = gridBoardFor(tree, d)!;
      expect(p.tier).toBe(board.tier);
      expect(p.tiles).toEqual(board.tiles);
      expect(p.groups).toEqual(
        board.groups.map((g) => ({ cladeId: g.cladeId, memberIds: g.memberIds, level: g.level }))
      );
    }
  });
});

describe("puzzle encode/decode round-trip", () => {
  it("survives base64 storage for both games", () => {
    for (const d of ["2026-07-09", "2026-10-31"]) {
      const lin = computePuzzle("lineage", tree, d)!;
      const linStored = encodePuzzle("lineage", lin);
      expect(typeof linStored.enc).toBe("string");
      // decode is internal to fetch; reconstruct via the same JSON path.
      expect(JSON.parse(atob(linStored.enc))).toEqual(lin);

      const kin = computePuzzle("kinship", tree, d)!;
      const kinStored = encodePuzzle("kinship", kin);
      expect(JSON.parse(atob(kinStored.enc))).toEqual(kin);
    }
  });
});

describe("kinshipBoard reconstruction", () => {
  it("rebuilds a board identical to the generated one", () => {
    const d = "2026-09-07";
    const board = gridBoardFor(tree, d)!;
    const rebuilt = kinshipBoard(tree, d, computePuzzle("kinship", tree, d)!);
    expect(rebuilt).toEqual(board);
  });
});
