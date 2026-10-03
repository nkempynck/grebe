import { describe, it, expect } from "vitest";
import taxonomy from "../data/taxonomy.json";
import { buildTree, speciesEcho } from "./index";

const tree = buildTree((taxonomy as { nodes: Parameters<typeof buildTree>[0] }).nodes);
const idOf = (sci: string) => {
  for (const n of tree.byId.values()) if (n.sciName === sci) return n.id;
  throw new Error(`no node ${sci}`);
};

describe("speciesEcho", () => {
  it("flags a clade named after its only species", () => {
    expect(speciesEcho(tree, idOf("Ophiophagus"))).toBe("only");
  });
  it("flags a genus that shares its name with one of several species", () => {
    expect(speciesEcho(tree, idOf("Salvia"))).toBe("shares");
  });
  it("leaves ordinary clades and species alone", () => {
    expect(speciesEcho(tree, idOf("Felidae"))).toBe("none");
    expect(speciesEcho(tree, idOf("Ophiophagus hannah"))).toBe("none");
  });
});
