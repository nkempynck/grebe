import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import augment from "./taxonomyAugment.json";
import junctionSplits from "./junctionSplits.json";
import type { TaxonNode } from "../core";

const nodes = [...(taxonomy as { nodes: TaxonNode[] }).nodes, ...(augment as { nodes: TaxonNode[] }).nodes];

// Every label the build makes up must carry the flag, or it leaks into Branches, Lineage and
// Mosaic as if it were a real clade. Both patch scripts set it; this catches a rebuild that
// skipped one of them.
describe("synthetic labels are flagged", () => {
  it("flags every merged label", () => {
    const merged = nodes.filter((n) => n.sciName?.includes(" & "));
    expect(merged.length).toBeGreaterThan(0);
    for (const n of merged) expect(n.synthetic, n.sciName).toBe(true);
  });
  it("flags every junction split that has no real name", () => {
    // The naming steps (Open Tree, MDD, Catalogue of Life) give some of them their exact sourced
    // name, which replaces the label.
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const s of junctionSplits.splits) {
      const n = byId.get(s.nodeId);
      expect(n?.synthetic || Boolean(n?.ottTaxon || n?.mddTaxon || n?.colTaxon), s.label).toBe(true);
    }
  });
  it("flags nothing else", () => {
    const splits = new Set(junctionSplits.splits.map((s) => s.nodeId));
    for (const n of nodes) if (n.synthetic) expect(n.sciName?.includes(" & ") || splits.has(n.id), n.id).toBe(true);
  });
});
