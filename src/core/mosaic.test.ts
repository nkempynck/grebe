import { describe, it, expect } from "vitest";
import taxonomy from "../data/taxonomy.json";
import augment from "../data/taxonomyAugment.json";
import { buildTree } from "./index";
import { generateGridBoard } from "./grid";
import { guardFrom } from "../data/mosaicGuard";
import { CHARACTERS, characterRow, characterValue, missingCladeNames, NA } from "./mosaicChars";
import {
  mosaicAnswerFor, mosaicPool, scoreMosaicGuess, mosaicRung, mosaicAids, mosaicAidsFor,
  mosaicTierForDate, mosaicDegrees, mosaicScopeId, mosaicLineagePath, mosaicDrillOptions,
  MOSAIC_BLUR_LADDER, MOSAIC_MAX_GUESSES, MOSAIC_DEFAULT_MECHANIC,
} from "./mosaic";

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

  it("shuffles by default", () => {
    expect(MOSAIC_DEFAULT_MECHANIC).toBe("shuffle");
  });
});

describe("mosaic week", () => {
  // 2026-08-17 is a Monday.
  const MON = "2026-08-17";
  const day = (n: number) => new Date(Date.UTC(2026, 7, 17) + n * 86400000).toISOString().slice(0, 10);

  it("numbers the weekdays the way the other games do", () => {
    expect(mosaicTierForDate(MON)).toBe(1);
    expect(mosaicTierForDate(day(5))).toBe(6); // Saturday
    expect(mosaicTierForDate(day(6))).toBe(7); // Sunday
  });

  it("takes an aid away, never gives one back, across the week", () => {
    const week = [0, 1, 2, 3, 4, 5, 6].map((n) => mosaicAidsFor(day(n)));
    // Monotonic: once a lever is off it stays off for the rest of the week.
    for (let i = 1; i < week.length; i++) {
      expect(Number(week[i].lookup)).toBeLessThanOrEqual(Number(week[i - 1].lookup));
      expect(Number(week[i].subset)).toBeLessThanOrEqual(Number(week[i - 1].subset));
      if (week[i - 1].proximity === "degrees") expect(week[i].proximity).toBe("degrees");
    }
    expect(week[0]).toMatchObject({ lookup: true, subset: true, proximity: "named" });
    expect(week[2]).toMatchObject({ lookup: true, subset: true, proximity: "degrees" });
    expect(week[3]).toMatchObject({ lookup: false, subset: true, proximity: "degrees" });
    expect(week[6]).toMatchObject({ lookup: false, subset: false, proximity: "degrees" });
  });

  it("clamps a forced tier rather than handing back an undefined set of aids", () => {
    for (const t of [-3, 0, 1, 7, 12, 4.4]) {
      const a = mosaicAids(t);
      expect(a.tier).toBeGreaterThanOrEqual(1);
      expect(a.tier).toBeLessThanOrEqual(7);
      expect(typeof a.lookup).toBe("boolean");
    }
  });
});

// Mosaic is played on the SAME tree as Kinship and Branches, and its two aids answer their
// questions exactly: the lookup is species -> its clades (Kinship's whole question) and the
// drill is clade -> its species (Branches'). Unguarded, 49% of Kinship's groups had their answer
// clade printed in the chain of every member: type the sixteen tiles, read off the four groups.
// Nothing but this test would notice that coming back.
describe("mosaic does not answer Kinship", () => {
  // Mosaic's aids run on the BASE tree; Kinship deals from the rich one. That mismatch is the
  // real configuration, so the test keeps it rather than tidying both onto one tree.
  const pool = new Set(mosaicPool(tree, mosaicScopeId(tree)));
  const richTree = buildTree([
    ...(taxonomy as { nodes: Nodes }).nodes,
    ...(augment as { nodes: Nodes }).nodes,
  ]);
  const boards = (() => {
    const out: { cladeId: string; memberIds: string[] }[][] = [];
    // The generator directly, not gridBoardFor: the scheduled version replays the anti-repeat
    // history from its anchor, which costs seconds per call and grows with the calendar.
    for (let i = 0; i < 12; i++) {
      const d = new Date(Date.UTC(2026, 7, 20) + i * 86400000).toISOString().slice(0, 10);
      for (let tier = 1; tier <= 7; tier += 3) {
        const b = generateGridBoard(richTree, d, tier);
        if (b) out.push(b.groups);
      }
    }
    return out;
  })();

  /** Groups whose clade the lookup names for every one of their members. */
  const viaLookup = (hidden: ReadonlySet<string>) =>
    boards.flat().filter((g) =>
      g.memberIds.every((m) =>
        mosaicLineagePath(tree, m, pool, undefined, hidden).some((l) => l.id === g.cladeId))).length;

  /** Groups the drill will name, anywhere below the game's root. */
  const viaDrill = (hidden: ReadonlySet<string>) => {
    const named = new Set<string>();
    const stack = [mosaicScopeId(tree)];
    for (let guard = 0; stack.length && guard < 20000; guard++) {
      const c = stack.pop()!;
      for (const o of mosaicDrillOptions(tree, c, pool, hidden)) {
        if (named.has(o.id)) continue;
        named.add(o.id);
        stack.push(o.id);
      }
    }
    return boards.flat().filter((g) => named.has(g.cladeId)).length;
  };

  it("guards both panels once today's boards are known", () => {
    expect(boards.flat().length).toBeGreaterThan(100); // the sweep actually ran
    for (const groups of boards) {
      const hidden = guardFrom({ groups: groups.map((g) => ({ cladeId: g.cladeId })), tiles: [] }, null).hidden;
      // Nothing from THIS board survives in either panel.
      const exposed = groups.filter((g) =>
        g.memberIds.every((m) =>
          mosaicLineagePath(tree, m, pool, undefined, hidden).some((l) => l.id === g.cladeId)));
      expect(exposed.map((g) => g.cladeId)).toEqual([]);
    }
  }, 30000);

  // The guard has to be doing work, not passing because the lookup is empty. Unguarded, real
  // groups leak through both panels; that is the state this test exists to keep us out of.
  it("would leak without the guard, which is why it exists", () => {
    const none = new Set<string>();
    expect(viaLookup(none) + viaDrill(none)).toBeGreaterThan(0);
  }, 30000);

  // Part two of the same guard, at the other end: the day's answer is never itself a tile on
  // another game's board. Measured over 60 days the natural draw never collides, so this is
  // insurance — but insurance that has to demonstrably work, hence a forced collision here.
  it("re-rolls an answer that lands on another game's board", () => {
    const d = "2026-09-10";
    const natural = mosaicAnswerFor(tree, d)!;
    expect(natural).toBeTruthy();
    const avoided = mosaicAnswerFor(tree, d, undefined, (day) =>
      day === d ? new Set([natural]) : new Set());
    expect(avoided).toBeTruthy();
    expect(avoided).not.toBe(natural);
    // Still a real, drawable answer rather than a fallback.
    expect(pool.has(avoided!)).toBe(true);
  });

  it("leaves the natural schedule alone on every other day", () => {
    // An avoider that never fires must reproduce the unguarded walk exactly, or pinning with it
    // enabled would silently reshuffle the calendar.
    const empty = () => new Set<string>();
    for (const d of ["2026-09-01", "2026-09-15", "2026-10-02"]) {
      expect(mosaicAnswerFor(tree, d, undefined, empty)).toBe(mosaicAnswerFor(tree, d));
    }
  });

  it("leaves the lookup something to scope by", () => {
    const sample = [...pool].filter((_, i) => i % 7 === 0);
    const chains = sample.map((s) => mosaicLineagePath(tree, s, pool).length);
    const mean = chains.reduce((a, b) => a + b, 0) / chains.length;
    expect(mean).toBeGreaterThan(2);
    // A species the lookup can say nothing about is a dead panel, so it stays rare.
    expect(chains.filter((c) => c === 0).length / chains.length).toBeLessThan(0.02);
  });
});

describe("mosaic degrees", () => {
  const scope = mosaicScopeId(tree);
  const deg = (a: string, g: string) => mosaicDegrees(tree, idOf(a), idOf(g), scope);

  it("reads 100 on the answer and falls away with distance", () => {
    expect(deg("Panthera leo", "Panthera leo")).toBe(100);
    const sister = deg("Panthera leo", "Panthera tigris");
    const order = deg("Panthera leo", "Canis lupus");
    const far = deg("Panthera leo", "Aptenodytes forsteri");
    expect(sister).toBeGreaterThan(order);
    expect(order).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(0);
  });

  // The subset filter must not move the reading. Rescaling to the player's current narrowing
  // would answer "is the answer even in here", which they never asked and did not earn, and it
  // would rewrite every earlier row each time they moved the filter.
  it("defaults to the game's scope, which a narrower root would visibly change", () => {
    const answer = idOf("Panthera leo");
    const guess = idOf("Canis lupus");
    const mammals = [...tree.byId.values()].find((n) => n.sciName === "Mammalia")!;
    const atScope = mosaicDegrees(tree, answer, guess, scope);
    // Same two animals, read against a tighter root: a different number, which is exactly why
    // the root has to be fixed.
    expect(mosaicDegrees(tree, answer, guess, mammals.id)).not.toBe(atScope);
    // …and the default, with no root passed, is the game's own.
    expect(mosaicDegrees(tree, answer, guess)).toBe(atScope);
    expect(scoreMosaicGuess(tree, answer, guess)!.degrees).toBe(atScope);
  });

  it("scores every guess with both readings, so the day decides which is shown", () => {
    const g = scoreMosaicGuess(tree, idOf("Panthera leo"), idOf("Panthera tigris"), scope)!;
    expect(g.proximity).toBe("same genus");
    expect(g.degrees).toBeGreaterThan(0);
  });
});
