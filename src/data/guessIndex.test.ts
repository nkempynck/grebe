import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import index from "./guessIndex.generated.json";

// The guess index is loaded into the database separately from the app, so nothing else notices
// when a taxonomy rebuild strands it: the entries simply stop placing, and players see "Couldn't
// place X on the tree". Each entry attaches at the first lineage id the tree still has.
describe("guess index", () => {
  it("places every entry on the current tree", () => {
    const ids = new Set((taxonomy as { nodes: { id: string }[] }).nodes.map((n) => n.id));
    const stranded = (index as { entries: { graft: { sciName: string; lineage: { id: string }[] } }[] }).entries
      .filter((e) => !e.graft.lineage.some((n) => ids.has(n.id)))
      .map((e) => e.graft.sciName);
    expect(stranded.slice(0, 10), `${stranded.length} stranded; rebuild with npm run build:guessindex`).toEqual([]);
  });
});
