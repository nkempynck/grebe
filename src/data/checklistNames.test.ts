import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import augment from "./taxonomyAugment.json";
import mdd from "../../scripts/mdd-ranks.json";
import col from "../../scripts/col-ranks.json";
import type { TaxonNode } from "../core";

// Every name patch-mdd-names and patch-col-names gave must still be EXACT on the shipped trees:
// the species under the node are exactly our species classified in that taxon. A rebuild that
// moves a species in or out would make the name a claim the data no longer supports.
const nodes = [...(taxonomy as { nodes: TaxonNode[] }).nodes, ...(augment as { nodes: TaxonNode[] }).nodes];
type Snapshot = { ranks: string[]; taxa: [string, string][]; species: Record<string, number[]> };

const kids = new Map<string, string[]>();
for (const n of nodes) if (n.parentId) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)!).push(n.id);
const byId = new Map(nodes.map((n) => [n.id, n]));
const under = (id: string): string[] => (byId.get(id)?.rank === "species" ? [id] : (kids.get(id) ?? []).flatMap(under));
const isMammal = (n: TaxonNode) => {
  for (let c: TaxonNode | undefined = n; c; c = c.parentId ? byId.get(c.parentId) : undefined)
    if (c.sciName === "Mammalia" && c.rank !== "species") return true;
  return false;
};

function wrongNames(list: Snapshot, field: "mddTaxon" | "colTaxon", inScope: (n: TaxonNode) => boolean) {
  const genusOf = new Map<string, number[]>();
  for (const idx of Object.values(list.species)) {
    const g = idx[list.ranks.indexOf("genus")];
    if (g >= 0 && !genusOf.has(list.taxa[g][1])) genusOf.set(list.taxa[g][1], idx);
  }
  const taxonOf = (label: string) => label.replace(/ \(.*\)$/, "");
  const inTaxon = (sci: string, label: string) =>
    (list.species[sci] ?? genusOf.get(sci.split(" ")[0]) ?? []).some((t) => t >= 0 && list.taxa[t].join(" ") === taxonOf(label));
  const named = nodes.filter((n) => n[field]);
  const species = nodes.filter((n) => n.rank === "species" && inScope(n));
  const wrong: string[] = [];
  for (const n of named) {
    const inside = new Set(under(n.id));
    const members = species.filter((s) => inTaxon(s.sciName, n[field]!)).map((s) => s.id);
    if (members.length !== inside.size || !members.every((m) => inside.has(m))) wrong.push(n.sciName);
    if (!taxonOf(n[field]!).endsWith(` ${n.sciName}`)) wrong.push(`${n.sciName} (name differs from source)`);
  }
  return { count: named.length, wrong };
}

describe("checklist clade names", () => {
  it("MDD names are exact for the mammals we show", () => {
    const r = wrongNames(mdd as unknown as Snapshot, "mddTaxon", isMammal);
    expect(r.count).toBeGreaterThan(0);
    expect(r.wrong).toEqual([]);
  });
  it("Catalogue of Life names are exact for the other species we show", () => {
    const r = wrongNames(col as unknown as Snapshot, "colTaxon", (n) => !isMammal(n));
    expect(r.count).toBeGreaterThan(0);
    expect(r.wrong).toEqual([]);
  });
});
