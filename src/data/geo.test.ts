import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import { buildTree } from "../core";
import { mosaicPool, mosaicScopeId } from "../core/mosaic";
import { geoCell, geoCoverage, regionLabels, regionsOf, GEO_SCOPE } from "./geo";

type Nodes = Parameters<typeof buildTree>[0];
const tree = buildTree((taxonomy as { nodes: Nodes }).nodes);
const pool = mosaicPool(tree, mosaicScopeId(tree));
const poolSci = pool.map((id) => tree.byId.get(id)!.sciName);
const sciOf = (id: string) => tree.byId.get(id)!.sciName;
const find = (sci: string) => {
  for (const n of tree.byId.values()) if (n.sciName === sci) return n.id;
  throw new Error(`no node ${sci}`);
};

describe("geo table", () => {
  // THE GUARD THAT MATTERS. geo.json is keyed by scientific name, and a taxonomy rebuild that
  // renames or replaces species breaks every one of those keys SILENTLY: regionsOf returns
  // null, the column empties, and nothing throws. Exactly the shape of the crocodilian bug.
  it("still covers the answer pool", () => {
    // The floor is well under today's 91% on purpose. This guard exists to catch the taxonomy
    // rebuild that invalidates every key at once, which sends coverage to near zero; it must
    // not fire when someone tunes the record floor by five.
    const cov = geoCoverage(poolSci);
    expect(cov, `pool coverage ${(100 * cov).toFixed(0)}% — has taxonomy.json been rebuilt?`)
      .toBeGreaterThan(0.85);
  });

  it("uses only region codes it has labels for", () => {
    for (const scheme of ["continent", "realm"] as const) {
      const labels = regionLabels(scheme);
      expect(Object.keys(labels).length).toBeGreaterThan(0);
      for (const sci of poolSci) {
        for (const r of regionsOf(sci, scheme) ?? []) {
          expect(labels[r], `${sci}: ${scheme} code ${r} has no label`).toBeTruthy();
        }
      }
    }
  });

  it("carries both schemes, so the game can switch without a re-fetch", () => {
    const both = poolSci.filter((s) => regionsOf(s, "continent") && regionsOf(s, "realm"));
    expect(both.length / poolSci.length).toBeGreaterThan(0.9);
  });

  // The threshold is the whole reason this column says anything. Counting any observation at
  // all put 52% of the pool on five or more continents, which reads as "famous animals are
  // everywhere" and carries no information.
  it("thresholds hard enough that the pool is not uniformly cosmopolitan", () => {
    const spread = poolSci.map((s) => regionsOf(s, "continent")).filter(Boolean) as string[][];
    const mean = spread.reduce((a, r) => a + r.length, 0) / spread.length;
    expect(mean).toBeLessThan(2.6);
    expect(spread.filter((r) => r.length >= 5).length / spread.length).toBeLessThan(0.1);
  });
});

describe("geo cell", () => {
  it("shows the guess's regions and marks only the shared ones", () => {
    const lion = sciOf(find("Panthera leo"));
    const cell = geoCell(lion, lion, "continent")!;
    expect(cell.mine.length).toBeGreaterThan(0);
    // Against itself every region is shared.
    expect(cell.shared).toEqual(cell.mine);
  });

  it("keeps shared a subset of the guess's own regions", () => {
    const a = sciOf(find("Panthera leo"));
    const b = sciOf(find("Ursus maritimus"));
    const cell = geoCell(b, a, "continent");
    if (cell) for (const r of cell.shared) expect(cell.mine).toContain(r);
  });

  // A species we have no records for has told us nothing. Scoring that as "not here" would
  // invent a fact, and it is the same three-state honesty the character table uses for n/a.
  it("is null rather than a miss when either side is unknown", () => {
    expect(geoCell("Nonexistent species", sciOf(find("Panthera leo")), "continent")).toBeNull();
    expect(geoCell(sciOf(find("Panthera leo")), "Nonexistent species", "continent")).toBeNull();
  });

  it("separates a guess on the wrong continent from one on the right", () => {
    const answer = sciOf(find("Panthera leo"));          // Africa
    const same = geoCell(sciOf(find("Loxodonta africana")), answer, "continent"); // Africa
    const other = geoCell(sciOf(find("Ursus maritimus")), answer, "continent");   // Arctic
    if (same && other) expect(same.shared.length).toBeGreaterThan(other.shared.length);
  });
});

describe("geo provenance", () => {
  it("records what it was built from", () => {
    expect(["mosaic-pool", "all-animals"]).toContain(GEO_SCOPE);
  });
});
