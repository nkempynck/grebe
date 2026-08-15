import { describe, it, expect } from "vitest";
import { hydrationToken as kinshipToken } from "./useGridGame";
import { hydrationToken as branchesToken } from "./useBranchesGame";
import type { GridBoard, BranchesBoard } from "../core";

// REGRESSION, reported 2026-08-15. A player left Kinship open overnight, lost the
// board on its own day, and after the 09:00 rollover the NEXT day showed as already
// lost — a board they had never seen. The stored progress read
// {"date":"2026-08-15", ... "status":"lost"} while the attempt itself belonged to
// 2026-08-14.
//
// Cause: both the persist effect and the cloud-restore effect gated on a token built
// from the BOARD alone. Two effects in the hook depend on `date`, and effects within
// one commit see the new date while the state is still the old day's, so the guard
// passed and the finished result was written under the new day's key. The board had
// not changed yet either — the pinned board is state, cleared inside an async .then()
// — which is why a board-only signature cannot catch this.
//
// Same shape as the free-play/daily leak in useGame.test.ts, and the same fix: put
// the discriminator in the token. There is no hook harness in this project (no
// @testing-library), so the token is exported and tested directly. These cases
// describe the leak, not the string format.

const board = (tier: number): GridBoard => ({
  date: "ignored",
  tier,
  tiles: ["a", "b", "c", "d"],
  groups: [{ cladeId: "ott1", label: "L", sciLabel: "S", memberIds: ["a", "b", "c", "d"], level: 0 }],
});

const bBoard = (tier: number): BranchesBoard =>
  ({ tier, rootId: "ott1", slotIds: ["s1"], anchorIds: ["a1"], tray: ["t1"] }) as unknown as BranchesBoard;

describe("kinship hydration token", () => {
  it("matches itself for the same board on the same day", () => {
    expect(kinshipToken("2026-08-14", board(5))).toBe(kinshipToken("2026-08-14", board(5)));
  });

  // THE BUG: same board object, new day. Must not match, or the previous day's
  // finished state is persisted under the new date.
  it("does NOT match once the day has rolled over", () => {
    expect(kinshipToken("2026-08-15", board(5))).not.toBe(kinshipToken("2026-08-14", board(5)));
  });

  it("still distinguishes different boards on the same day", () => {
    expect(kinshipToken("2026-08-14", board(5))).not.toBe(kinshipToken("2026-08-14", board(6)));
  });

  it("treats a missing board as its own thing, never equal to a real one", () => {
    expect(kinshipToken("2026-08-14", null)).not.toBe(kinshipToken("2026-08-14", board(5)));
  });
});

describe("branches hydration token", () => {
  it("matches itself for the same board on the same day", () => {
    expect(branchesToken("2026-08-14", bBoard(5))).toBe(branchesToken("2026-08-14", bBoard(5)));
  });

  it("does NOT match once the day has rolled over", () => {
    expect(branchesToken("2026-08-15", bBoard(5))).not.toBe(branchesToken("2026-08-14", bBoard(5)));
  });

  it("still distinguishes different boards on the same day", () => {
    expect(branchesToken("2026-08-14", bBoard(5))).not.toBe(branchesToken("2026-08-14", bBoard(6)));
  });
});
