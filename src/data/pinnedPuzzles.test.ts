import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import { buildTree } from "../core";
import { dailyAnswerFor, resolveDailyRules } from "./dailySchedule";
import { gridBoardFor } from "./gridDaily";
import { avoidMapFrom, computePuzzle, encodePuzzle, kinshipBoard } from "./pinnedPuzzles";
import { mosaicAnswerFor, mosaicMinViews, mosaicScopeId, mosaicTierForDate } from "../core/mosaic";

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
    // Two Kinship generations per date, each replaying the anti-repeat history from the
    // anchor, so this sits well over vitest's 5s default once GRID_GROUP_ANTI_REPEAT_WINDOW
    // is widened (a wider window rarely finds a zero-score board to break the scan early).
    //
    // 60s, not 20s: it takes ~7s alone, but the 2026-08-14 generator work (mixed-granularity
    // containers, so more candidates per day) pushed the loaded-machine case past 20 and made
    // this the one flaky test in the suite. The headroom is the point — a parity check that
    // fails at random teaches people to ignore a red suite.
  }, 60_000);
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

// Mosaic's resolver. The only one that takes something beyond (tree, date): the day's answer
// has to dodge whatever Kinship and Branches already have on the board, and that is supplied at
// pin time rather than derived, because deriving it means generating two boards per day walked.
describe("mosaic resolver", () => {
  const dates = ["2026-09-07", "2026-09-12", "2026-11-03"];

  it("matches mosaicAnswerFor and carries the weekday band", () => {
    for (const d of dates) {
      const p = computePuzzle("mosaic", tree, d)!;
      expect(p.answerId).toBe(mosaicAnswerFor(tree, d));
      expect(p.tier).toBe(mosaicTierForDate(d));
      expect(p.scopeRootId).toBe(mosaicScopeId(tree));
    }
  });

  it("draws the opening days from the famous pool", () => {
    // The band's floor has to reach the pinned answer, not just the settings row it came from.
    for (const d of dates) {
      const p = computePuzzle("mosaic", tree, d)!;
      const views = tree.byId.get(p.answerId)!.views ?? 0;
      expect(views, `${d} tier ${p.tier}`).toBeGreaterThanOrEqual(mosaicMinViews(p.tier));
    }
  });

  it("survives base64 storage", () => {
    const p = computePuzzle("mosaic", tree, "2026-09-07")!;
    expect(JSON.parse(atob(encodePuzzle("mosaic", p).enc))).toEqual(p);
  });

  it("moves off an animal another game is using that day", () => {
    const d = "2026-09-07";
    const plain = computePuzzle("mosaic", tree, d)!;
    const dodged = computePuzzle("mosaic", tree, d, {
      avoidOn: (day) => (day === d ? new Set([plain.answerId]) : new Set()),
    })!;
    expect(dodged.answerId).not.toBe(plain.answerId);
  });
});

// The avoider's input side: pinned rows in, "species in play that day" out. Kept as a pure
// function of rows because the two callers hold different clients — the in-app re-pin uses the
// player's session, `npm run pin` uses the service key — and only the decoding is shared.
describe("avoidMapFrom", () => {
  const d = "2026-09-07";
  const rows = () => {
    const kin = computePuzzle("kinship", tree, d)!;
    const bra = computePuzzle("branches", tree, d)!;
    return [
      { game: "kinship", puzzle_date: d, payload: encodePuzzle("kinship", kin) },
      { game: "branches", puzzle_date: d, payload: encodePuzzle("branches", bra) },
      // Another game's row, which must not contribute: Lineage's answer is a legitimate Mosaic
      // answer, and blocking it would shrink the pool for no reason.
      { game: "lineage", puzzle_date: d, payload: encodePuzzle("lineage", computePuzzle("lineage", tree, d)!) },
    ];
  };

  it("collects the species both boards have in play", () => {
    const map = avoidMapFrom(rows());
    const got = map.get(d)!;
    const kin = computePuzzle("kinship", tree, d)!;
    const bra = computePuzzle("branches", tree, d)!;
    for (const t of kin.tiles) expect(got.has(t)).toBe(true);
    for (const l of bra.leafIds) expect(got.has(l)).toBe(true);
    for (const t of bra.tray) expect(got.has(t)).toBe(true);
    // Clades are hidden from the LOOKUP, not from the draw: an answer is a species, so a group
    // id in this set could only ever block something that was never a candidate.
    expect(got.has(kin.groups[0].cladeId)).toBe(false);
    expect(got.has(computePuzzle("lineage", tree, d)!.answerId)).toBe(false);
  });

  it("reports nothing for a day it has no rows for", () => {
    expect(avoidMapFrom(rows()).get("2026-09-08")).toBeUndefined();
  });
});
