// The anti-repeat memory must describe what players were REALLY shown.
//
// Both daily generators rebuild that memory by regenerating every past day with the current
// generator, which is correct only while the generator never changes. It always does: on the
// v8→v9 move every one of the six most recent already-served days regenerated as a different
// board, so the windows were guarding boards nobody saw while the ones just played counted as
// unseen. setServedGridHistory / setServedBranchesHistory let the prefill script hand the
// generators the pinned rows instead. These tests pin down the two properties that matter:
// injecting real history CHANGES what comes next (it is not decorative), and clearing it
// restores the previous behaviour exactly (so nothing else in the suite is affected).
import { describe, it, expect, afterEach } from "vitest";
import taxonomy from "../data/taxonomy.json";
import augment from "../data/taxonomyAugment.json";
import { buildTree } from "./index";
import { generateGridBoard, setServedGridHistory, type ServedGridDay } from "./grid";
import { generateBranchesBoard, setServedBranchesHistory } from "./branches";

type Nodes = Parameters<typeof buildTree>[0];
const richTree = buildTree([
  ...(taxonomy as { nodes: Nodes }).nodes,
  ...(augment as { nodes: Nodes }).nodes,
]);

const DAY = "2026-09-10";
const groupsOf = (d: string) => generateGridBoard(richTree, d, 4)?.groups.map((g) => g.cladeId).sort() ?? [];

afterEach(() => {
  setServedGridHistory(null);
  setServedBranchesHistory(null);
});

describe("served history (kinship)", () => {
  it("is inert until something is injected", () => {
    const before = groupsOf(DAY);
    setServedGridHistory(null);
    expect(groupsOf(DAY)).toEqual(before);
    setServedGridHistory(new Map());
    expect(groupsOf(DAY)).toEqual(before);
  });

  it("avoids the groups it is told were really served the day before", () => {
    const natural = groupsOf(DAY);
    expect(natural.length).toBeGreaterThan(0);

    // Claim yesterday served exactly the groups today would otherwise pick. The group
    // anti-repeat window is the dominant term, so today must move off them.
    const yesterday = new Date(`${DAY}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const served = new Map<string, ServedGridDay>([
      [yesterday.toISOString().slice(0, 10), { groups: natural.map((cladeId) => ({ cladeId, memberIds: [] })) }],
    ]);
    setServedGridHistory(served);

    const after = groupsOf(DAY);
    expect(after.length).toBeGreaterThan(0);
    // Not merely different — it must not REUSE what was just shown.
    const reused = after.filter((id) => natural.includes(id));
    expect(reused).toEqual([]);
  });

  it("restores the original board once the history is cleared", () => {
    const natural = groupsOf(DAY);
    const yesterday = new Date(`${DAY}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    setServedGridHistory(new Map([
      [yesterday.toISOString().slice(0, 10), { groups: natural.map((cladeId) => ({ cladeId, memberIds: [] })) }],
    ]));
    expect(groupsOf(DAY)).not.toEqual(natural);
    setServedGridHistory(null);
    expect(groupsOf(DAY)).toEqual(natural);
  });
}, 60_000);

describe("served history (branches)", () => {
  it("is inert until something is injected, and reversible", () => {
    const before = generateBranchesBoard(richTree, DAY, 4);
    setServedBranchesHistory(new Map());
    expect(generateBranchesBoard(richTree, DAY, 4)?.slotIds).toEqual(before?.slotIds);
    setServedBranchesHistory(null);
    expect(generateBranchesBoard(richTree, DAY, 4)?.slotIds).toEqual(before?.slotIds);
  });

  it("avoids a board it is told was really served inside the window", () => {
    const natural = generateBranchesBoard(richTree, DAY, 4);
    expect(natural).toBeTruthy();

    const yesterday = new Date(`${DAY}T00:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    setServedBranchesHistory(new Map([
      [yesterday.toISOString().slice(0, 10), { slotIds: natural!.slotIds, anchorIds: natural!.anchorIds }],
    ]));

    const after = generateBranchesBoard(richTree, DAY, 4);
    expect(after).toBeTruthy();
    const sig = (b: { slotIds: string[]; anchorIds: string[] }) =>
      b.slotIds.concat(b.anchorIds).slice().sort().join(",");
    expect(sig(after!)).not.toBe(sig(natural!));
  });
}, 60_000);
