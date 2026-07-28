import { describe, it, expect } from "vitest";
import { buildTree } from "./tree";
import { resolveGuess, suggestGuesses, normalizeName } from "./resolve";
import type { TaxonNode, Tree } from "./types";

const N = (id: string, sciName: string, common: string | undefined, parentId: string | null): TaxonNode => ({
  id, sciName, common, rank: parentId === null ? "root" : "species", parentId,
});

// A tiny tree with a couple of deliberate near-collisions ("cats"/"bats") to test
// the fuzzy tie-guard.
// Plus a shared-name pair: a genus and its only species both called "Saguaro",
// as GBIF-derived common names routinely produce.
const nodes: TaxonNode[] = [
  N("root", "Life", undefined, null),
  N("kw", "Orcinus orca", "Killer whale", "root"),
  N("eleph", "Elephas maximus", "Elephant", "root"),
  N("lion", "Panthera leo", "Lion", "root"),
  N("chick", "Poecile atricapillus", "Black-capped Chickadee", "root"),
  N("catsx", "Aaa aaa", "cats", "root"),
  N("batsx", "Bbb bbb", "bats", "root"),
  { id: "carnegiea", sciName: "Carnegiea", common: "Saguaro", rank: "genus", parentId: "root" },
  N("saguaro", "Carnegiea gigantea", "Saguaro", "carnegiea"),
];
const tree: Tree = { ...buildTree(nodes), synonyms: new Map([[normalizeName("orca"), "kw"]]) };
const id = (input: string) => resolveGuess(tree, input)?.id ?? null;

describe("normalizeName", () => {
  it("folds case, diacritics, hyphens, and punctuation", () => {
    expect(normalizeName("Réunion")).toBe("reunion");
    expect(normalizeName("Black-capped  Chickadee")).toBe("black capped chickadee");
    expect(normalizeName("Bewick's Wren")).toBe("bewick s wren");
  });
});

describe("resolveGuess — exact & forms", () => {
  it("matches common and scientific names, case-insensitively", () => {
    expect(id("Lion")).toBe("lion");
    expect(id("lion")).toBe("lion");
    expect(id("Panthera leo")).toBe("lion");
  });
  it("accepts the 'Common (Scientific)' form", () => {
    expect(id("Lion (Panthera leo)")).toBe("lion");
  });
  it("matches through hyphen/diacritic normalization", () => {
    expect(id("black capped chickadee")).toBe("chick");
    expect(id("Black-Capped Chickadee")).toBe("chick");
  });
});

describe("resolveGuess — a group and a species sharing a name", () => {
  const withGuessed = (input: string, ...guessed: string[]) =>
    resolveGuess(tree, input, { guessed: new Set(guessed) })?.id ?? null;

  it("means the species when nothing has been guessed yet", () => {
    expect(id("Saguaro")).toBe("saguaro");
  });
  it("still reaches the species after the group was guessed", () => {
    expect(withGuessed("Saguaro", "carnegiea")).toBe("saguaro");
  });
  it("falls through to the group after the species was guessed", () => {
    expect(withGuessed("Saguaro", "saguaro")).toBe("carnegiea");
  });
  it("keeps each reachable by its scientific name", () => {
    expect(id("Carnegiea")).toBe("carnegiea");
    expect(id("Carnegiea gigantea")).toBe("saguaro");
  });
  it("disambiguates the 'Common (Scientific)' form by both halves", () => {
    expect(id("Saguaro (Carnegiea gigantea)")).toBe("saguaro");
    expect(id("Saguaro (Carnegiea)")).toBe("carnegiea");
  });
});

describe("resolveGuess — synonyms", () => {
  it("resolves a curated synonym to its species", () => {
    expect(id("orca")).toBe("kw");
    expect(id("ORCA")).toBe("kw");
  });
});

describe("resolveGuess — typo tolerance", () => {
  it("accepts a close misspelling of a common name", () => {
    expect(id("elephnt")).toBe("eleph"); // dropped 'a'
  });
  it("accepts a close misspelling of a scientific name", () => {
    expect(id("Panthera leoo")).toBe("lion");
  });
  it("does NOT fuzz very short words", () => {
    expect(id("bat")).toBeNull(); // 3 chars → no fuzzy; not exactly "bats"
  });
  it("rejects an ambiguous tie between two species", () => {
    expect(id("hats")).toBeNull(); // equidistant from "cats" and "bats"
  });
  it("returns null for a genuinely unknown guess", () => {
    expect(id("xyzzy plugh")).toBeNull();
  });
});

describe("suggestGuesses", () => {
  it("surfaces a species by its synonym", () => {
    const ids = suggestGuesses(tree, "orc").map((n) => n.id);
    expect(ids).toContain("kw");
  });
});
