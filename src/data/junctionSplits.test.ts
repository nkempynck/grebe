// The invariant behind every junction-split label, asserted against the SHIPPED trees.
//
// A split node is labelled with the genera it contains ("Capra & Hemitragus"). That is only
// honest while every species we display of those genera is actually inside it. The day one
// sits outside, the label claims an animal that lives somewhere else — which is exactly the
// bug that started this: a group called "Sheep & goats" beside a separate group of sheep.
//
// scripts/patch-junction-splits.mjs enforces this at build time, but the build is a step
// someone can forget to re-run. This is the guard that cannot be skipped: it reads the
// committed manifest and the committed trees, so it fails the moment a species is added to
// a genus a split has named, whoever added it and however they built.
import { describe, it, expect } from "vitest";
import taxonomy from "./taxonomy.json";
import augment from "./taxonomyAugment.json";
import manifest from "./junctionSplits.json";

interface Node { id: string; sciName?: string; common?: string; rank?: string; parentId?: string | null }
const nodes = [...(taxonomy as { nodes: Node[] }).nodes, ...(augment as { nodes: Node[] }).nodes];
const byId = new Map(nodes.map((n) => [n.id, n]));
const genusOf = (sci: string) => sci.split(/\s+/)[0];

/** Every species id at or below a node. */
function speciesUnder(root: string): Node[] {
  const children = new Map<string, Node[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = children.get(n.parentId) ?? children.set(n.parentId, []).get(n.parentId)!;
    list.push(n);
  }
  const out: Node[] = [];
  const stack = [root];
  while (stack.length) {
    for (const c of children.get(stack.pop()!) ?? []) (c.rank === "species" ? out : stack).push(c.rank === "species" ? (c as never) : c.id as never);
  }
  return out;
}

describe("junction splits", () => {
  it("has a manifest that matches the tree", () => {
    expect(manifest.splits.length).toBeGreaterThan(0);
    for (const s of manifest.splits) {
      const node = byId.get(s.nodeId);
      expect(node, `${s.label} (${s.nodeId}) missing from the tree`).toBeDefined();
      expect(node!.parentId, `${s.label} hangs on the wrong junction`).toBe(s.junction);
      expect(node!.common).toBe(s.label);
    }
  });

  it("never names a genus that also lives outside it", () => {
    const displayed = new Map<string, string[]>();
    for (const n of nodes) {
      if (n.rank !== "species" || !n.sciName) continue;
      const g = genusOf(n.sciName);
      (displayed.get(g) ?? displayed.set(g, []).get(g)!).push(n.sciName);
    }
    const offenders: string[] = [];
    for (const s of manifest.splits) {
      const inside = new Set(speciesUnder(s.nodeId).map((n) => n.sciName));
      for (const g of s.genera) {
        for (const sci of displayed.get(g) ?? []) {
          if (!inside.has(sci)) offenders.push(`"${s.label}" names ${g} but ${sci} sits outside it`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("labels every genus it actually contains", () => {
    for (const s of manifest.splits) {
      const held = new Set(speciesUnder(s.nodeId).map((n) => genusOf(n.sciName!)));
      for (const g of held) {
        expect(s.genera, `"${s.label}" holds ${g} without saying so`).toContain(g);
      }
    }
  });
});
