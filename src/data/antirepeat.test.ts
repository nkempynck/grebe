import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import { buildTree, generateGridBoard, winTargetId, WIN_RANK_LADDER, DAILY_EPOCH } from "../core";
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
  }, 20000); // O(n²): 150 full epoch replays — heavy but deterministic

  it("is deterministic for a date", () => {
    expect(dailyAnswerFor(tree, "2026-09-01")).toBe(dailyAnswerFor(tree, "2026-09-01"));
  });
});

// The week is a resolution ramp (Mon/Tue family, Wed genus, Thu–Sun species; assist
// off only on the weekend), scope is a spaced variety knob, and family/genus days
// must land on a species that actually carries that rank. These lock those in.
describe("Lineage difficulty ramp", () => {
  // [winWithin, assist] expected for Monday…Sunday.
  const EXPECT: [number, boolean][] = [[2, true], [2, true], [1, true], [0, true], [0, true], [0, false], [0, false]];
  const weekdayIdx = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;

  it("resolution + assist follow the weekday, and scope never repeats within 3 days", () => {
    const scopes: string[] = [];
    let d = DAILY_EPOCH;
    for (let i = 0; i < 365; i++) {
      const r = resolveDailyRules(d);
      const [ew, ea] = EXPECT[weekdayIdx(d)];
      expect(r.config.winWithin).toBe(ew);
      expect(r.assist).toBe(ea);
      const s = r.config.scopeRootId;
      for (let k = 1; k <= 3 && i - k >= 0; k++) expect(scopes[i - k]).not.toBe(s);
      scopes.push(s);
      d = shift(d, 1);
    }
    // Variety: a full year touches many scopes, none dominating.
    expect(new Set(scopes).size).toBeGreaterThanOrEqual(8);
  });

  it("family/genus days always land on a species that carries that rank", () => {
    let d = DAILY_EPOCH;
    for (let i = 0; i < 150; i++) {
      const win = resolveDailyRules(d).config.winWithin;
      if (win === 1 || win === 2) {
        const target = winTargetId(tree, dailyAnswerFor(tree, d), win);
        expect(tree.byId.get(target)?.rank).toBe(WIN_RANK_LADDER[win]);
      }
      d = shift(d, 1);
    }
  }, 20000); // O(n²): 150 full epoch replays — heavy but deterministic
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
  }, 20000); // O(n²): 120 full epoch replays — heavy but deterministic
});
