import type { Tree } from "../core";

/** THE FIRST SCREEN of Mosaic's narrow-down, stated rather than derived.
 *
 *  It used to be derived: the shared stats buckets, plus whatever the tree walk turned up that
 *  they did not already cover. That worked only because the drill counted the fame-filtered
 *  answer pool, which quietly kept most of the invertebrates out of the panel. Counting every
 *  species instead — which is what stops the drill publishing the fame floor, see
 *  mosaicBrowseSet — brought them all back, and the walk had nothing to collapse them into: the
 *  top of this tree is a chain of unnamed junctions, so the opening menu filled with single
 *  obscure genera and buried the groups anyone would actually tap.
 *
 *  So the first level is a LIST, and a short one. Below it the walk is fine and stays in
 *  charge; it only ever needed help at the top, where this tree has no phylum-level names.
 *
 *  These are SHORTCUTS, not a partition, and they are allowed to nest. Birds sit inside
 *  Reptiles — cladistically that is simply true, and this game is about the tree — so the Birds
 *  chip is a way to skip a step, not a claim that birds are not reptiles. What the list does
 *  have to do is REACH everything: every animal in the tree is under one of these, and a test
 *  holds it there, so a branch can never go unreachable the way the invertebrates did. */
export interface MosaicClade {
  /** Scientific name, resolved against the tree at load. Absent from the tree → skipped. */
  sci: string;
  /** What to call it inside its group. Falls back to the tree's own name. */
  label?: string;
}

export interface MosaicTopGroup {
  key: string;
  label: string;
  clades: MosaicClade[];
}

/** Most groups are ONE clade, and their chip narrows straight to that node — Mammals is
 *  Mammalia and nothing else. Fish and Other animals cannot be: no node in this tree holds the
 *  ray-finned fish, the sharks, the lampreys and the coelacanth without also holding every
 *  land vertebrate, and "the invertebrates" is not a clade at all. Those two narrow to the
 *  GROUP, which then offers its clades as the next step. */
export const MOSAIC_TOP_GROUPS: MosaicTopGroup[] = [
  { key: "mammals", label: "Mammals", clades: [{ sci: "Mammalia" }] },
  { key: "birds", label: "Birds", clades: [{ sci: "Aves" }] },
  // Sauropsida, which the tree already calls Reptiles. It holds the birds too, and the two
  // non-avian dinosaurs in the tree, which is where they belong — on the old derived list they
  // stood on the first screen as two chips of one species each.
  { key: "reptiles", label: "Reptiles", clades: [{ sci: "Sauropsida" }] },
  { key: "amphibians", label: "Amphibians", clades: [{ sci: "Amphibia" }] },
  {
    key: "fish",
    label: "Fish",
    clades: [
      { sci: "Actinopterygii", label: "Ray-finned fish" },
      { sci: "Chondrichthyes", label: "Sharks & rays" },
      { sci: "Cyclostomata", label: "Lampreys & hagfish" },
      { sci: "Coelacanthimorpha", label: "Coelacanths" },
    ],
  },
  { key: "insects", label: "Insects", clades: [{ sci: "Insecta" }] },
  {
    key: "other",
    label: "Other animals",
    clades: [
      { sci: "Chelicerata", label: "Spiders & scorpions" },
      { sci: "Mollusca", label: "Molluscs" },
      { sci: "Malacostraca", label: "Crabs, shrimp & woodlice" },
      { sci: "Cnidaria", label: "Jellyfish, corals & anemones" },
      { sci: "Annelida", label: "Segmented worms" },
      { sci: "Platyhelminthes", label: "Flatworms" },
      { sci: "Echinodermata", label: "Starfish & sea urchins" },
      { sci: "Nematoda", label: "Roundworms" },
      { sci: "Myriapoda", label: "Centipedes & millipedes" },
      { sci: "Tunicata", label: "Sea squirts & salps" },
      { sci: "Porifera", label: "Sponges" },
      { sci: "Branchiopoda", label: "Water fleas" },
      { sci: "Cirripedia", label: "Barnacles" },
      { sci: "Copepoda", label: "Copepods" },
      { sci: "Collembola", label: "Springtails" },
      { sci: "Tardigrada", label: "Tardigrades" },
    ],
  },
];

/** Marks a drill id as a GROUP rather than a clade node. A tree id is a GBIF/OTL number, so
 *  there is nothing to collide with. */
export const MOSAIC_GROUP_PREFIX = "grp:";

export const groupIdFor = (key: string) => `${MOSAIC_GROUP_PREFIX}${key}`;

/** The group a drill id names, or undefined for an ordinary clade node. */
export function topGroupById(id: string): MosaicTopGroup | undefined {
  if (!id.startsWith(MOSAIC_GROUP_PREFIX)) return undefined;
  const key = id.slice(MOSAIC_GROUP_PREFIX.length);
  return MOSAIC_TOP_GROUPS.find((g) => g.key === key);
}

/** A group's clades that this tree actually has, as node ids with the label to show them
 *  under. Order follows the table; the panel sorts by size anyway. */
export function groupClades(tree: Tree, group: MosaicTopGroup): Array<{ id: string; label: string }> {
  const out: Array<{ id: string; label: string }> = [];
  for (const c of group.clades) {
    const id = cladeIdOf(tree, c.sci);
    if (!id) continue;
    const n = tree.byId.get(id);
    out.push({ id, label: c.label ?? n?.common ?? n?.sciName ?? c.sci });
  }
  return out;
}

/** Scientific name → node id, memoised per tree: the table is resolved on every rebuild of the
 *  first level and the tree is thousands of nodes. */
const bySci = new WeakMap<Tree, Map<string, string>>();
function cladeIdOf(tree: Tree, sci: string): string | undefined {
  let index = bySci.get(tree);
  if (!index) {
    index = new Map();
    for (const n of tree.byId.values()) if (n.sciName && !index.has(n.sciName)) index.set(n.sciName, n.id);
    bySci.set(tree, index);
  }
  return index.get(sci);
}
