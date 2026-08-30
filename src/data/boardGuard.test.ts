import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import { buildTree, randomAnswerId, leavesUnder } from "../core";
import { guardFrom, isGuarded, lineageIsGuarded, GUARD_UNKNOWN } from "./boardGuard";

type Nodes = Parameters<typeof buildTree>[0];
const tree = buildTree((taxonomy as { nodes: Nodes }).nodes);
const idOf = (sci: string) => {
  for (const n of tree.byId.values()) if (n.sciName === sci) return n.id;
  throw new Error(`no node ${sci}`);
};

const BEARS = idOf("Ursidae");
const POLAR = idOf("Ursus maritimus");
const LION = idOf("Panthera leo");

// One Kinship group (bears) and one Branches tile (a lion) standing in for a day's boards.
const guard = guardFrom(
  { groups: [{ cladeId: BEARS }], tiles: [POLAR] },
  { groupIds: [], leafIds: [LION], tray: [] }
);

describe("what today's boards put out of reach", () => {
  it("blocks a group in play", () => {
    expect(isGuarded(tree, guard, BEARS)).toBe(true);
  });

  it("blocks every species inside it, not only the tiles", () => {
    // The point of the rule. Blocking the sixteen tiles alone leaves the tree under them open,
    // and "which clade do these two share" can then be asked of any two bears instead.
    expect(isGuarded(tree, guard, idOf("Ursus arctos"))).toBe(true);
    expect(isGuarded(tree, guard, idOf("Ailuropoda melanoleuca"))).toBe(true);
  });

  it("blocks a species on a board whose own clade is not in play", () => {
    expect(isGuarded(tree, guard, LION)).toBe(true);
  });

  it("leaves the rest of the tree alone", () => {
    // Bears are blocked; their neighbours are not. A guard that swallowed Carnivora, or worse
    // the root, would end free play rather than protect the boards.
    expect(isGuarded(tree, guard, idOf("Canis lupus"))).toBe(false);
    expect(isGuarded(tree, guard, idOf("Carnivora"))).toBe(false);
    expect(isGuarded(tree, guard, tree.rootId)).toBe(false);
  });

  it("blocks nothing at all when the boards could not be read", () => {
    // FAILS OPEN. Refusing on an unreadable pin would block the whole tree, and a small leak is
    // a far better outcome than an unplayable game.
    expect(isGuarded(tree, GUARD_UNKNOWN, BEARS)).toBe(false);
    expect(isGuarded(tree, GUARD_UNKNOWN, POLAR)).toBe(false);
  });

  it("catches an out-of-set organism by its lineage", () => {
    // It is not in the tree, so there is nothing to walk; grafting it would materialise the very
    // clade being protected, which is why this is checked before the graft rather than after.
    expect(lineageIsGuarded(guard, ["some-obscure-bear", BEARS, "carnivora"])).toBe(true);
    expect(lineageIsGuarded(guard, ["some-obscure-moth", "lepidoptera"])).toBe(false);
    expect(lineageIsGuarded(GUARD_UNKNOWN, ["x", BEARS])).toBe(false);
  });
});

// Free play draws a random target. If it can draw one the guard then refuses to name, the round
// is unwinnable: the player is turned away from the single word that ends it.
describe("a free-play target the guard would bar", () => {
  const scope = idOf("Carnivora");

  it("is never drawn while anything else is available", () => {
    const barred = (id: string) => isGuarded(tree, guard, id);
    for (let i = 0; i < 300; i++) {
      expect(barred(randomAnswerId(tree, scope, barred))).toBe(false);
    }
  });

  it("is drawn anyway rather than failing, if the whole scope is barred", () => {
    // Needs a scope entirely inside a board clade, which the presets cannot produce: they are
    // classes and kingdoms, the boards are families. An unwinnable round still beats no round.
    const id = randomAnswerId(tree, BEARS, () => true);
    expect(leavesUnder(tree, BEARS)).toContain(id);
  });
});
