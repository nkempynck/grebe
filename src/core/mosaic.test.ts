import { describe, it, expect } from "vitest";
import taxonomy from "../data/taxonomy.json";
import { buildTree } from "./index";
import { CHARACTERS, characterRow, characterValue, missingCladeNames, NA } from "./mosaicChars";
import { mosaicAnswerFor, mosaicPool, scoreMosaicGuess, mosaicRung, MOSAIC_BLUR_LADDER, MOSAIC_MAX_GUESSES } from "./mosaic";

type Nodes = Parameters<typeof buildTree>[0];
const tree = buildTree((taxonomy as { nodes: Nodes }).nodes);
const idOf = (sci: string) => {
  for (const n of tree.byId.values()) if (n.sciName === sci) return n.id;
  throw new Error(`no node ${sci}`);
};

describe("mosaic characters", () => {
  // The guard that matters most. A rule naming a clade the tree lacks matches NOTHING and
  // fails silently, and the obvious names are exactly the ones missing: there is no
  // Pinnipedia, no Arachnida, no Crocodylia, no Charadriiformes in this tree.
  it("references only clades that exist", () => {
    expect(missingCladeNames(tree)).toEqual([]);
  });

  it("reads the convergent cases the way a player would", () => {
    const v = (sci: string, char: string) =>
      characterValue(tree, CHARACTERS.find((c) => c.id === char)!, idOf(sci));
    // A whale is a legless, aquatic, warm-blooded vertebrate with skin, not a fish.
    expect(v("Orcinus orca", "legs")).toBe("0");
    expect(v("Orcinus orca", "water")).toBe("yes");
    expect(v("Orcinus orca", "warm")).toBe("yes");
    expect(v("Orcinus orca", "covering")).toBe("skin");
    // A penguin is a bird that does not fly and does swim.
    expect(v("Aptenodytes forsteri", "flies")).toBe("no");
    expect(v("Aptenodytes forsteri", "water")).toBe("yes");
    expect(v("Aptenodytes forsteri", "covering")).toBe("feathers");
    // A bat is the mammal that does fly.
    expect(v("Pteropus vampyrus", "flies")).toBe("yes");
    // Snakes have no legs; crocodilians have four and are aquatic (they have no order node,
    // so they are covered family by family and were silently wrong before).
    expect(v("Python regius", "legs")).toBe("0");
    expect(v("Crocodylus niloticus", "legs")).toBe("4");
    expect(v("Crocodylus niloticus", "water")).toBe("yes");
  });

  it("marks a plant n/a rather than pretending it has zero legs", () => {
    const row = characterRow(tree, idOf("Helianthus annuus"));
    expect(row.legs).toBe(NA);
    expect(row.warm).toBe(NA);
    expect(row.kingdom).toBe("plant");
  });

  it("never leaves a species without a value for every character", () => {
    const species = [...tree.byId.values()].filter((n) => n.rank === "species");
    for (const c of CHARACTERS) {
      const blank = species.filter((s) => !characterValue(tree, c, s.id));
      expect(blank, `${c.id} blank for ${blank.length}`).toHaveLength(0);
    }
  });
});

describe("mosaic board", () => {
  it("draws a famous, common-named species", () => {
    const pool = mosaicPool(tree, tree.rootId);
    expect(pool.length).toBeGreaterThan(200);
    for (const id of pool.slice(0, 50)) {
      const n = tree.byId.get(id)!;
      expect(n.rank).toBe("species");
      expect(n.common).toBeTruthy();
    }
  });

  it("is a pure function of the date", () => {
    for (const d of ["2026-09-01", "2026-12-25", "2027-03-14"]) {
      expect(mosaicAnswerFor(tree, d)).toBe(mosaicAnswerFor(tree, d));
    }
  });

  it("does not repeat an answer inside the anti-repeat window", () => {
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 8, 1) + i * 86400000).toISOString().slice(0, 10);
      seen.push(mosaicAnswerFor(tree, d)!);
    }
    // no repeat anywhere in a 60-day run (the window is 45)
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("scores an exact guess as correct and all-matching", () => {
    const answer = idOf("Panthera leo");
    const g = scoreMosaicGuess(tree, answer, answer)!;
    expect(g.correct).toBe(true);
    expect(g.cells.every((c) => c.match !== false)).toBe(true);
  });

  it("scores a near miss as mostly matching and a far miss as mostly not", () => {
    const answer = idOf("Panthera leo");
    const near = scoreMosaicGuess(tree, answer, idOf("Panthera tigris"))!;
    const far = scoreMosaicGuess(tree, answer, idOf("Helianthus annuus"))!;
    const hits = (g: typeof near) => g.cells.filter((c) => c.match === true).length;
    expect(near.correct).toBe(false);
    expect(hits(near)).toBe(near.cells.length);
    expect(hits(far)).toBeLessThan(hits(near));
  });

  it("never scores n/a as a match either way", () => {
    const answer = idOf("Panthera leo");
    const plant = scoreMosaicGuess(tree, answer, idOf("Helianthus annuus"))!;
    const legs = plant.cells.find((c) => c.characterId === "legs")!;
    expect(legs.value).toBe(NA);
    expect(legs.match).toBeNull();
  });

  it("advances one rung per wrong guess and stops at the clearest", () => {
    expect(mosaicRung(0)).toBe(0);
    expect(mosaicRung(3)).toBe(3);
    expect(mosaicRung(99)).toBe(MOSAIC_BLUR_LADDER.length - 1);
    // the last guess is made at the clearest rung, not after the reveal
    expect(MOSAIC_MAX_GUESSES).toBe(MOSAIC_BLUR_LADDER.length + 1);
  });
});
