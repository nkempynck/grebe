import { describe, it, expect } from "vitest";
import taxonomy from "../data/taxonomy.json";
import { buildTree } from "./index";
import { branchesBoardForSeed, headWord, sharedWordFloor, type BranchesBoard } from "./branches";
import { medianSeparationTier } from "./tree";

const tree = buildTree((taxonomy as { nodes: Parameters<typeof buildTree>[0] }).nodes);

const board = (seed: string, tier: number): BranchesBoard => {
  const b = branchesBoardForSeed(tree, seed, tier);
  if (!b) throw new Error(`no board for ${seed} tier ${tier}`);
  return b;
};

/** How many of a board's tray (slot) species share a HEAD NOUN with at least one OTHER
 *  tray species — the quantity the shared-word floor targets. */
function collisionCount(b: BranchesBoard): number {
  const heads = b.slotIds.map((id) => headWord(tree, id));
  const freq = new Map<string, number>();
  for (const h of heads) if (h) freq.set(h, (freq.get(h) ?? 0) + 1);
  let n = 0;
  for (const h of heads) if (h && (freq.get(h) ?? 0) >= 2) n++;
  return n;
}
/** Median MRCA-rank separation of a board's answer groups (groupIds before the context
 *  clades) — the difficulty the SEP_BAND gate constrains. */
const answerSep = (b: BranchesBoard) => medianSeparationTier(tree, b.groupIds.slice(0, b.slotIds.length));

// The broad class a node sits in (or "other" above every class marker) — mirrors
// branches.ts's broadGroupOf, for the no-cross-class assertion.
const CLASS_MARKERS = new Set([
  "Mammalia", "Aves", "Actinopterygii", "Elasmobranchii", "Chondrichthyes",
  "Squamata", "Testudines", "Crocodylia", "Amphibia", "Insecta", "Arachnida",
  "Gastropoda", "Bivalvia", "Cephalopoda", "Magnoliopsida", "Liliopsida", "Pinopsida", "Polypodiopsida",
]);
function broadClass(id: string): string {
  let g = "other";
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) {
    const s = tree.byId.get(c)?.sciName;
    if (s && CLASS_MARKERS.has(s)) g = s;
  }
  return g;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe("branchesBoardForSeed", () => {
  it("produces a solvable board at every weekday tier", () => {
    for (let tier = 1; tier <= 7; tier++) {
      const b = board("2026-08-01", tier);
      expect(b.slotIds.length).toBeGreaterThanOrEqual(4);
      // Tray is exactly the slot species, and every slot's answer is its own leaf.
      expect(new Set(b.tray)).toEqual(new Set(b.slotIds));
      expect(b.anchorIds.every((id) => !b.slotIds.includes(id))).toBe(true);
    }
  });

  it("never puts a Latin-only species in the tray (species to place must be common-named)", () => {
    for (let tier = 1; tier <= 7; tier++) {
      for (const s of ["2026-08-01", "2026-08-02", "2026-08-09", "seed-x", "seed-y"]) {
        for (const id of board(s, tier).slotIds) {
          expect(tree.byId.get(id)?.common, `${id} @ tier ${tier}`).toBeTruthy();
        }
      }
    }
  });

  it("is deterministic for a given seed + tier", () => {
    expect(JSON.stringify(board("2026-08-02", 4))).toBe(JSON.stringify(board("2026-08-02", 4)));
  });
});

// The shared-word FLOOR: the tray should pack look-alike names (two "sparrows"),
// more of them on harder days. Best-effort per board, so we assert on the AGGREGATE
// across many seeds rather than a hard per-board guarantee.
describe("shared-word floor", () => {
  const SEEDS = Array.from({ length: 80 }, (_, i) => `seed-${i}`);

  it("floor rises with the tier (2 → 4)", () => {
    expect(sharedWordFloor(1)).toBe(2);
    expect(sharedWordFloor(4)).toBe(3);
    expect(sharedWordFloor(7)).toBe(4);
  });

  it("packs more look-alike names on hard days than easy ones", () => {
    const easy = mean(SEEDS.map((s) => collisionCount(board(s, 1))));
    const hard = mean(SEEDS.map((s) => collisionCount(board(s, 7))));
    expect(hard).toBeGreaterThan(easy);
  });

  it("meets its floor at every tier (boardForDay surveys containers for a colliding one)", () => {
    for (let tier = 1; tier <= 7; tier++) {
      const met = SEEDS.filter((s) => {
        const b = board(s, tier);
        return collisionCount(b) >= Math.min(b.slotIds.length, sharedWordFloor(tier));
      }).length;
      // boardForDay retries across containers until one hits the floor, so nearly every
      // board should — allow a hair of slack for a seed where no window container can.
      expect(met / SEEDS.length).toBeGreaterThan(0.9);
    }
  });

  it("head noun is the last significant word, not a modifier", () => {
    // "…-tailed chinchilla" → "chinchilla"; a shared "tailed" is not a collision because
    // the heads differ.
    const chinchilla = findByCommon("chinchilla");
    const jackrabbit = findByCommon("jackrabbit");
    if (chinchilla) expect(headWord(tree, chinchilla)).toBe("chinchilla");
    if (jackrabbit) expect(headWord(tree, jackrabbit)).toBe("jackrabbit");
  });
});

// No board ever mixes two classes (a mouse-and-cockatoo board), at ANY tier — even easy
// days stay inside one class, so they are within-class challenging rather than trivially
// cross-kingdom. Mirrors Kinship's broad-group constraint.
describe("no cross-class boards", () => {
  const SEEDS = Array.from({ length: 120 }, (_, i) => `cc-${i}`);
  it("every board's answer groups sit in a single class, at every tier", () => {
    for (let tier = 1; tier <= 7; tier++) {
      for (const s of SEEDS) {
        const b = board(s, tier);
        const classes = new Set(b.groupIds.slice(0, b.slotIds.length).map(broadClass));
        expect(classes.size, `tier ${tier} seed ${s}: ${[...classes].join(",")}`).toBe(1);
      }
    }
  });

  it("answer-group separation rises from easy to hard days", () => {
    const easy = mean(SEEDS.map((s) => answerSep(board(s, 1))));
    const hard = mean(SEEDS.map((s) => answerSep(board(s, 7))));
    expect(hard).toBeGreaterThan(easy + 1);
  });

  // The broad class is locked once per day and chosen uniformly, so no single lineage
  // (the mammal-dense augment, container-rich angiosperms/insects) may flood a tier — the
  // "huge Mesangiospermae bias" that this pass fixed.
  it("no single class dominates any tier", () => {
    const many = Array.from({ length: 300 }, (_, i) => `bal-${i}`);
    for (let tier = 1; tier <= 7; tier++) {
      const counts = new Map<string, number>();
      for (const s of many) {
        const c = broadClass(board(s, tier).groupIds[0]);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const top = Math.max(...counts.values()) / many.length;
      expect(top, `tier ${tier}: ${[...counts].map(([k, v]) => `${k}:${v}`).join(" ")}`).toBeLessThan(0.35);
    }
  });
});

function findByCommon(sub: string): string | null {
  for (const [id, n] of tree.byId) if (n.common?.toLowerCase().includes(sub)) return id;
  return null;
}
