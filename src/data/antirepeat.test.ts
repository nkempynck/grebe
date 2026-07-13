import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import { buildTree, generateGridBoard, DAILY_EPOCH } from "../core";
import { dailyAnswerFor, resolveDailyRules } from "./dailySchedule";

const tree = buildTree((taxonomy as { nodes: Parameters<typeof buildTree>[0] }).nodes);

const shift = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

// No repeat within the window, from the epoch. The anti-repeat replays from
// DAILY_EPOCH, so checking a run starting there matches what players see.
describe("Lineage anti-repeat", () => {
  it("never repeats a species within 60 days", () => {
    const answers: string[] = [];
    let d = DAILY_EPOCH;
    for (let i = 0; i < 150; i++) { answers.push(dailyAnswerFor(tree, d)); d = shift(d, 1); }
    for (let i = 0; i < answers.length; i++) {
      for (let j = i + 1; j < Math.min(i + 61, answers.length); j++) {
        expect(answers[i]).not.toBe(answers[j]);
      }
    }
  });

  it("is deterministic for a date", () => {
    expect(dailyAnswerFor(tree, "2026-09-01")).toBe(dailyAnswerFor(tree, "2026-09-01"));
  });
});

describe("Kinship anti-repeat", () => {
  it("never repeats a group-set within 30 days", () => {
    const sigs: string[] = [];
    let d = DAILY_EPOCH;
    for (let i = 0; i < 120; i++) {
      const tier = resolveDailyRules(d).tier;
      const board = generateGridBoard(tree, d, tier)!;
      sigs.push(board.groups.map((g) => g.cladeId).sort().join(","));
      d = shift(d, 1);
    }
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < Math.min(i + 31, sigs.length); j++) {
        expect(sigs[i]).not.toBe(sigs[j]);
      }
    }
  });
});
