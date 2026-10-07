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

  // The augment once added families a second time: a flat bag of new genera beside the
  // unnamed clade that already held the family's other members (parrots in a "Psittacidae"
  // bag beside Psittacoidea). No augment family that holds species may share its Open Tree
  // taxon with species outside it.
  it("no family appears twice in the tree", () => {
    const kids = new Map<string, TaxonNode[]>();
    for (const n of nodes) if (n.parentId) (kids.get(n.parentId) ?? kids.set(n.parentId, []).get(n.parentId)!).push(n);
    const under = (id: string): TaxonNode[] => (kids.get(id) ?? []).flatMap((k) => (k.rank === "species" ? [k] : under(k.id)));
    const lineage = (sci: string) => {
      const out = new Set<string>();
      for (let t: number | null | undefined = L.species[sci]; t != null; t = L.taxa[t]?.[2]) out.add(String(t));
      return out;
    };
    const species = nodes.filter((n) => n.rank === "species");
    const lin = new Map(species.map((s) => [s.id, lineage(s.sciName)]));
    const twice: string[] = [];
    for (const f of (augment as { nodes: TaxonNode[] }).nodes) {
      if (f.rank !== "family") continue;
      const mine = new Set(under(f.id).map((s) => s.id));
      if (!mine.size) continue; // an emptied bag, kept only so served boards keep their label
      const ott = f.id.replace(/^ott/, "");
      const outside = species.filter((s) => !mine.has(s.id) && lin.get(s.id)!.has(ott)).length;
      if (outside) twice.push(`${f.sciName}: ${mine.size} species inside, ${outside} more elsewhere`);
    }
    expect(twice).toEqual([]);
  });

  // The pool once filed Nolinoideae under Solanaceae, and lilies sat among the nightshades.
  // Families are lumped and split differently between classifications, so compare ORDERS: the
  // family a species sits in must belong to the order Open Tree puts the species in.
  it("every species sits in a family of the order Open Tree gives it", () => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const orderUp = (t: number | null | undefined) => {
      for (; t != null; t = L.taxa[t]?.[2]) if (L.taxa[t]?.[1] === "order") return L.taxa[t][0];
      return null;
    };
    const familyOrders = new Map<string, Set<string | null>>();
    for (const [t, [name, rank]] of Object.entries(L.taxa))
      if (rank === "family") (familyOrders.get(name) ?? familyOrders.set(name, new Set()).get(name)!).add(orderUp(Number(t)));
    const wrong: string[] = [];
    for (const n of nodes) {
      if (n.rank !== "species") continue;
      let family: string | null = null;
      for (let c: string | null | undefined = n.parentId; c; c = byId.get(c)?.parentId) if (byId.get(c)?.rank === "family") { family = byId.get(c)!.sciName ?? null; break; }
      const mine = orderUp(L.species[n.sciName]);
      const theirs = family ? familyOrders.get(family) : undefined;
      if (mine && theirs?.size && !theirs.has(mine)) wrong.push(`${n.sciName} (${n.common}): in ${family}, Open Tree order ${mine}`);
    }
    expect(wrong).toEqual([]);
  });

  // An `order` stamped on the hummingbird clade inside Trochilidae made Mosaic call two
  // hummingbirds "same order", and Kinship read them as far apart. A separation rank must be
  // narrower than every rank above it (patch-inverted-ranks.mjs). Equal ranks nested are fine.
  it("no clade's separation rank is broader than a rank above it", () => {
    const ORDER = [
      "domain", "kingdom", "subkingdom", "superphylum", "phylum", "subphylum", "infraphylum",
      "superclass", "class", "subclass", "infraclass", "subterclass", "cohort", "subcohort",
      "magnorder", "superorder", "order", "suborder", "infraorder", "parvorder",
      "superfamily", "family", "subfamily", "tribe", "subtribe",
      "genus", "subgenus", "species group", "species subgroup", "species", "subspecies",
    ];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const pos = (n?: TaxonNode) => { const i = ORDER.indexOf(n?.sepRank ?? n?.rank ?? ""); return i < 0 ? null : i; };
    const inverted: string[] = [];
    for (const n of nodes) {
      const mine = pos(n);
      if (n.rank === "species" || mine == null) continue;
      for (let c: string | null | undefined = n.parentId; c; c = byId.get(c)?.parentId) {
        const theirs = pos(byId.get(c));
        if (theirs != null && theirs > mine) { inverted.push(`${n.sciName || n.id} (${n.sepRank ?? n.rank}) inside ${byId.get(c)!.sciName}`); break; }
      }
    }
    expect(inverted).toEqual([]);
  });
});
