import { describe, it, expect } from "vitest";
import taxonomy from "../data/taxonomy.json";
import type { GameConfig } from "./types";
import {
  buildTree,
  isAncestor,
  leavesUnder,
  winTargetId,
  dailyAnswerId,
  dailyNumber,
  DAILY_EPOCH,
  informedPar,
} from "./index";

const tree = buildTree((taxonomy as { nodes: Parameters<typeof buildTree>[0] }).nodes);
const scopes = (taxonomy as { scopes: { id: string; label: string }[] }).scopes;
const scopeByLabel = (kw: RegExp) => (scopes.find((s) => kw.test(s.label)) ?? scopes[0]).id;
const ANIMALS = scopeByLabel(/animals/i);

describe("dailyNumber", () => {
  it("counts days from the epoch, 1-based", () => {
    // Epoch-relative so this survives changing DAILY_EPOCH at launch.
    const dayAfterEpoch = new Date(`${DAILY_EPOCH}T00:00:00Z`);
    dayAfterEpoch.setUTCDate(dayAfterEpoch.getUTCDate() + 1);
    expect(dailyNumber(DAILY_EPOCH)).toBe(1);
    expect(dailyNumber(dayAfterEpoch.toISOString().slice(0, 10))).toBe(2);
  });
});

describe("dailyAnswerId", () => {
  it("is deterministic for a given date + scope", () => {
    expect(dailyAnswerId(tree, ANIMALS, "2026-07-15")).toBe(dailyAnswerId(tree, ANIMALS, "2026-07-15"));
  });
  it("returns a real leaf inside the scope", () => {
    const id = dailyAnswerId(tree, ANIMALS, "2026-07-15");
    expect(leavesUnder(tree, ANIMALS)).toContain(id);
  });
  it("varies across dates (not a constant)", () => {
    const picks = Array.from({ length: 20 }, (_, i) =>
      dailyAnswerId(tree, ANIMALS, `2026-08-${String(i + 1).padStart(2, "0")}`)
    );
    expect(new Set(picks).size).toBeGreaterThan(1);
  });
});

describe("winTargetId (rank ladder)", () => {
  const answer = dailyAnswerId(tree, ANIMALS, "2026-07-15");
  it("winWithin=0 targets the exact species", () => {
    expect(winTargetId(tree, answer, 0)).toBe(answer);
  });
  it("looser tolerances target ancestors of the answer", () => {
    for (const k of [1, 2, 3]) {
      expect(isAncestor(tree, winTargetId(tree, answer, k), answer)).toBe(true);
    }
  });
});

describe("informedPar", () => {
  const cfg: GameConfig = { scopeRootId: ANIMALS, winWithin: 0 };
  const answer = dailyAnswerId(tree, ANIMALS, "2026-07-15");

  it("is a positive, bounded guess count (never hits the safety cap)", () => {
    const p = informedPar(tree, cfg, answer, true);
    expect(p).toBeGreaterThanOrEqual(1);
    expect(p).toBeLessThan(leavesUnder(tree, ANIMALS).length);
  });

  it("unassisted play needs at least as many guesses in aggregate", () => {
    let assisted = 0;
    let unassisted = 0;
    for (let i = 1; i <= 12; i++) {
      const a = dailyAnswerId(tree, ANIMALS, `2026-09-${String(i).padStart(2, "0")}`);
      assisted += informedPar(tree, cfg, a, true);
      unassisted += informedPar(tree, cfg, a, false);
    }
    expect(unassisted).toBeGreaterThanOrEqual(assisted);
  });
});
