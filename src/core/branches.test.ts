import { describe, it, expect } from "vitest";
import taxonomy from "../data/taxonomy.json";
import { buildTree } from "./index";
import { branchesBoardForSeed, headWord, sharedWordFloor, type BranchesBoard } from "./branches";
import { medianSeparationTier } from "./tree";
import { safeName, tellingWords } from "./redact";

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
    // 2100 boards across the two halves. Comfortable alone (~1.5s) but it shares the machine
    // with the rest of the suite, where it has been measured at 5.5s — over the 5s default,
    // so it failed only ever in a full parallel run. Same treatment as the other heavy
    // deterministic ones (antirepeat, pinnedPuzzles).
  }, 30_000);
});

// A pre-filled species must never hand a placement over by NAME.
//
// The generator keeps a narrow exception to that (clashesAnswer): a word is forgiven when
// the prefill sits in the very clade whose answer carries it AND that clade's label
// displays it, on the grounds that the prefill then repeats what the player can already
// read. Both halves earn their keep at generation time — without the LABEL half a primate
// board pre-fills gibbons in Nomascus and Hylobates and leaves Hoolock as the only gibbon
// genus empty, placing the tray's gibbon by elimination; without the SAME-CLADE half an
// "… iguana" can be pre-filled under Anoles, pointing at the wrong branch entirely.
//
// What the exception cannot do is decide what the player SEES, and that is where it went
// wrong: the label it leans on is the same label safeName replaces with Latin, so the word
// left the label and landed on the prefill instead. This asserts against the rendered
// board, which is the only place the question can be settled.
describe("prefills never give a placement away by name", () => {
  const SEEDS = Array.from({ length: 30 }, (_, i) => `gw-${i}`);
  const sig = (name: string) =>
    new Set(name.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3));
  const nameOf = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;

  // Asserted over the name the board SHOWS, not the one the node carries. The earlier
  // version of this test asked whether the prefill's clade was LABELLED with the word
  // and forgave it when so, which is the generator's own excuse (clashesAnswer) copied
  // into the assertion — and it is void, because a label carrying a word unique to one
  // tray tile is exactly the label safeName replaces with Latin. Every board that hit
  // the bug passed this test: "Wobbegong" → Orectolobidae with a Japanese wobbegong
  // drawn underneath, "True seals" → Phocidae with a Ringed seal. Reading the rendered
  // name instead leaves nothing to forgive.
  it("no word unique to one tray species is ever shown on a prefill", () => {
    for (let tier = 1; tier <= 7; tier++) {
      for (const seed of SEEDS) {
        const b = board(seed, tier);
        const telling = tellingWords(b.slotIds.map((id) => tree.byId.get(id)));
        const freq = new Map<string, number>();
        for (const slot of b.slotIds) for (const w of sig(nameOf(slot))) freq.set(w, (freq.get(w) ?? 0) + 1);
        for (const anchor of b.anchorIds) {
          const shown = safeName(tree.byId.get(anchor), telling);
          for (const w of sig(shown)) {
            if (freq.get(w) !== 1) continue; // shared across the tray → points nowhere
            const tile = b.slotIds.find((s) => sig(nameOf(s)).has(w));
            expect(
              false,
              `tier ${tier} seed ${seed}: prefill shown as "${shown}" carries "${w}", which only ` +
                `"${nameOf(tile!)}" carries in the tray`
            ).toBe(true);
          }
        }
      }
    }
  }, 30_000);

  // The complement of the same fix: the prefill budget used to taper to nothing on Sunday,
  // which served four clams over four unlabelled Latin clades with no species drawn at all.
  // Worked examples still thin out with the tier, but never to zero.
  it("every board draws at least one species, at every tier", () => {
    for (let tier = 1; tier <= 7; tier++) {
      for (const seed of SEEDS) {
        const b = board(seed, tier);
        expect(b.anchorIds.length, `tier ${tier} seed ${seed}`).toBeGreaterThan(0);
      }
    }
  }, 30_000);
});

function findByCommon(sub: string): string | null {
  for (const [id, n] of tree.byId) if (n.common?.toLowerCase().includes(sub)) return id;
  return null;
}
