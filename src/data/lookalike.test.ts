import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import augment from "./taxonomyAugment.json";
import { LOOKALIKE } from "../core/lookalike";
import type { TaxonNode } from "../core";

// The table is keyed by scientific name. A rebuild that renames or drops a clade would make its
// entry silently do nothing, and a homonym would make it apply in the wrong place.
const nodes = [...(taxonomy as { nodes: TaxonNode[] }).nodes, ...(augment as { nodes: TaxonNode[] }).nodes];

describe("Kinship look-alike table", () => {
  it("names exactly one clade in the tree per entry", () => {
    const bad = Object.keys(LOOKALIKE).filter(
      (name) => nodes.filter((n) => n.sciName === name && n.rank !== "species" && !n.synthetic).length !== 1
    );
    expect(bad).toEqual([]);
  });
});
