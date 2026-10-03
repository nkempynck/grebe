import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import augment from "./taxonomyAugment.json";
import lineages from "../../scripts/ott-lineages.json";
import type { TaxonNode } from "../core";

// Every name patch-ott-names gave must still be EXACT on the shipped trees: the species under the
// node are exactly our species classified in that Open Tree taxon. A rebuild that moves a species
// in or out would make the name a claim the data no longer supports; this catches it.
const nodes = [...(taxonomy as { nodes: TaxonNode[] }).nodes, ...(augment as { nodes: TaxonNode[] }).nodes];
const L = lineages as unknown as { species: Record<string, number>; taxa: Record<string, [string, string, number | null]> };

describe("Open Tree clade names", () => {
  it("are exact for the species we show", () => {
    const kids = new Map<string, string[]>();
    for (const n of nodes) if (n.parentId) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)!).push(n.id);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const under = (id: string): string[] =>
      byId.get(id)?.rank === "species" ? [id] : (kids.get(id) ?? []).flatMap(under);
    const inTaxon = (sci: string, taxon: string) => {
      for (let t: number | null | undefined = L.species[sci]; t != null; t = L.taxa[t]?.[2]) if (`ott${t}` === taxon) return true;
      return false;
    };
    const named = nodes.filter((n) => n.ottTaxon);
    expect(named.length).toBeGreaterThan(0);
    const species = nodes.filter((n) => n.rank === "species");
    const wrong: string[] = [];
    for (const n of named) {
      const inside = new Set(under(n.id));
      const members = species.filter((s) => inTaxon(s.sciName, n.ottTaxon!)).map((s) => s.id);
      if (members.length !== inside.size || !members.every((m) => inside.has(m))) wrong.push(n.sciName);
      if (L.taxa[n.ottTaxon!.slice(3)]?.[0] !== n.sciName) wrong.push(`${n.sciName} (name differs from source)`);
    }
    expect(wrong).toEqual([]);
  });
});
