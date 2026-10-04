import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import augment from "./taxonomyAugment.json";
import { CLADE_COMMON } from "./cladeNames";
import type { TaxonNode } from "../core";

// A key that matches no clade does nothing, so if a rebuild renames a clade, the group it was
// written for silently shows its Latin name again. Fail instead.
const nodes = [...(taxonomy as { nodes: TaxonNode[] }).nodes, ...(augment as { nodes: TaxonNode[] }).nodes];

describe("CLADE_COMMON", () => {
  it("names only clades that exist", () => {
    const clades = new Set(nodes.filter((n) => n.rank !== "species" && n.sciName).map((n) => n.sciName));
    expect(Object.keys(CLADE_COMMON).filter((k) => !clades.has(k))).toEqual([]);
  });
});
