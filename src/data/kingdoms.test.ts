import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import augment from "./taxonomyAugment.json";
import lineages from "../../scripts/ott-lineages.json";
import type { TaxonNode } from "../core";

// A genus name can belong to an animal and a plant (Linaria: linnets and toadflaxes), and the
// augment grafts by genus name. Every species must sit in the kingdom Open Tree puts it in.
const nodes = [...(taxonomy as { nodes: TaxonNode[] }).nodes, ...(augment as { nodes: TaxonNode[] }).nodes];
const L = lineages as unknown as { species: Record<string, number>; taxa: Record<string, [string, string, number | null]> };
const KINGDOMS = new Set(["Metazoa", "Chloroplastida"]);

describe("kingdoms", () => {
  it("every species sits in the kingdom Open Tree gives it", () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const inTree = (id: string) => {
      for (let c: string | null | undefined = id; c; c = byId.get(c)?.parentId) {
        const s = byId.get(c)?.sciName;
        if (s && KINGDOMS.has(s)) return s;
      }
      return null;
    };
    const inOtt = (sci: string) => {
      for (let t: number | null | undefined = L.species[sci]; t != null; t = L.taxa[t]?.[2]) {
        const s = L.taxa[t]?.[0];
        if (s && KINGDOMS.has(s)) return s;
      }
      return null;
    };
    const wrong: string[] = [];
    let checked = 0;
    for (const n of nodes) {
      if (n.rank !== "species") continue;
      const a = inTree(n.id), b = inOtt(n.sciName);
      if (!a || !b) continue;
      checked++;
      if (a !== b) wrong.push(`${n.sciName} (${n.common}): tree ${a}, Open Tree ${b}`);
    }
    expect(checked).toBeGreaterThan(nodes.length / 2);
    expect(wrong).toEqual([]);
  });
});
