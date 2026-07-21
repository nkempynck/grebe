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
  // Replay a run of real boards once, then assert both the set- and the per-group
  // windows over it. Starts before the epoch so the pre-launch preview days (which
  // used to run with empty history → repeats) are covered too.
  const start = shift(DAILY_EPOCH, -10);
  const boards: { sig: string; groups: string[] }[] = [];
  let d = start;
  for (let i = 0; i < 120; i++) {
    const tier = resolveDailyRules(d).tier;
    const b = generateGridBoard(tree, d, tier)!;
    const groups = b.groups.map((g) => g.cladeId);
    boards.push({ sig: [...groups].sort().join(","), groups });
    d = shift(d, 1);
  }

  it("never repeats a group-SET within 30 days", () => {
    for (let i = 0; i < boards.length; i++)
      for (let j = i + 1; j < Math.min(i + 31, boards.length); j++)
        expect(boards[i].sig).not.toBe(boards[j].sig);
  });

  // The bug this guards: swapping one of four groups made the SET "fresh" while 3/4
  // groups (and their species) recurred from the day before. No individual group may
  // reappear within a week — including on consecutive pre-launch days.
  it("never repeats an INDIVIDUAL group within 7 days", () => {
    for (let i = 0; i < boards.length; i++)
      for (let j = i + 1; j < Math.min(i + 8, boards.length); j++) {
        const shared = boards[i].groups.filter((g) => boards[j].groups.includes(g));
        expect(shared, `days ${i}→${j} share ${shared.join(", ")}`).toEqual([]);
      }
  });
}, 30000); // O(n²) over 120 full anchored replays — heavy but deterministic
