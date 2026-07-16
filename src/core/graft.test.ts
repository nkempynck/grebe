import { describe, it, expect } from "vitest";
import { buildTree } from "./tree";
import { graftTaxon } from "./graft";
import { mrca, edgeDistance } from "./tree";
import { evaluateGuess } from "./game";
import type { TaxonNode, Tree } from "./types";

// A small mammal slice: Life → Mammalia → { Carnivora → Lion , Laurasiatheria-side
// left sparse }. We'll graft a pangolin (missing order Pholidota) under Laurasiatheria.
const N = (id: string, sciName: string, parentId: string | null, rank = "clade"): TaxonNode => ({
  id, sciName, rank, parentId,
});
const base: TaxonNode[] = [
  N("life", "Life", null, "root"),
  N("mammalia", "Mammalia", "life", "class"),
  N("laur", "Laurasiatheria", "mammalia", "superorder"),
  N("carnivora", "Carnivora", "laur", "order"),
  N("felidae", "Felidae", "carnivora", "family"),
  N("lion", "Panthera leo", "felidae", "species"),
];
const fresh = (): Tree => buildTree(base.map((n) => ({ ...n })));

const pangolin = {
  id: "oos:pangolin", sciName: "Manis pentadactyla", common: "Chinese pangolin", rank: "species",
  lineage: [
    { id: "oos:manidae", sciName: "Manidae", rank: "family" },
    { id: "oos:pholidota", sciName: "Pholidota", rank: "order" },
    { id: "laur", sciName: "Laurasiatheria", rank: "superorder" }, // connection point (present)
  ],
};

describe("graftTaxon", () => {
  it("inserts the species and every missing ancestor, marked virtual", () => {
    const tree = fresh();
    const id = graftTaxon(tree, pangolin);
    expect(id).toBe("oos:pangolin");
    for (const gid of ["oos:pangolin", "oos:manidae", "oos:pholidota"]) {
      expect(tree.byId.get(gid)?.virtual).toBe(true);
    }
    // Connection point is untouched (not virtual).
    expect(tree.byId.get("laur")?.virtual).toBeUndefined();
  });

  it("wires parent links and depths correctly", () => {
    const tree = fresh();
    graftTaxon(tree, pangolin);
    expect(tree.byId.get("oos:manidae")?.parentId).toBe("oos:pholidota");
    expect(tree.byId.get("oos:pholidota")?.parentId).toBe("laur");
    expect(tree.byId.get("oos:pangolin")?.parentId).toBe("oos:manidae");
    // depth(Laurasiatheria)=2 → pholidota 3, manidae 4, pangolin 5
    expect(tree.depthOf.get("laur")).toBe(2);
    expect(tree.depthOf.get("oos:pangolin")).toBe(5);
    // childrenOf updated so the pangolin is reachable from the connection point.
    expect(tree.childrenOf.get("laur")).toContain("oos:pholidota");
  });

  it("lands the MRCA at the connection point (same as snapping)", () => {
    const tree = fresh();
    graftTaxon(tree, pangolin);
    // MRCA(pangolin, lion) is Laurasiatheria — the deepest shipped shared ancestor.
    expect(mrca(tree, "oos:pangolin", "lion")).toBe("laur");
    // Grafted nodes hang below it, so they can't be ancestors of the in-set answer.
    expect(edgeDistance(tree, "lion", "laur")).toBe(3); // lion→felidae→carnivora→laur
  });

  it("is idempotent — regrafting is a no-op returning the id", () => {
    const tree = fresh();
    graftTaxon(tree, pangolin);
    const before = tree.byId.size;
    expect(graftTaxon(tree, pangolin)).toBe("oos:pangolin");
    expect(tree.byId.size).toBe(before);
  });

  it("returns null when the lineage never connects to the tree", () => {
    const tree = fresh();
    const orphan = { id: "x", sciName: "X", rank: "species", lineage: [{ id: "nowhere", sciName: "Nowhere", rank: "order" }] };
    expect(graftTaxon(tree, orphan)).toBeNull();
  });

  it("a grafted guess scores as a probe and never wins (evaluateGuess + forced isWin)", () => {
    const tree = fresh();
    graftTaxon(tree, pangolin);
    const cfg = { scopeRootId: "life", winWithin: 3 }; // loose resolution
    const r = evaluateGuess(tree, "lion", "oos:pangolin", cfg);
    expect(r.mrca.id).toBe("laur");
    // The caller forces isWin=false for out-of-set probes; evaluateGuess itself
    // won't win here since Laurasiatheria isn't within winWithin=3 of lion.
    expect(r.isWin).toBe(false);
  });
});
