import type { Tree } from "../core";
import { isAncestor } from "../core";
import { SCOPE_PRESETS } from "./presets";

/** The taxonomic groups we track "how good are you" stats for. Each id is a real
 *  clade node (a scope preset); an answer is tagged with the first group whose
 *  clade contains it, else the "other" bucket. */
export interface CladeGroup {
  id: string;
  label: string;
  icon: string;
}

const byKeyword = (re: RegExp) => SCOPE_PRESETS.find((s) => re.test(s.label))?.id;

export const CLADE_GROUPS: CladeGroup[] = (
  [
    { id: byKeyword(/mammal/i), label: "Mammals", icon: "🐘" },
    { id: byKeyword(/bird/i), label: "Birds", icon: "🐦" },
    { id: byKeyword(/fish/i), label: "Fish", icon: "🐟" },
    { id: byKeyword(/amphibian/i), label: "Amphibians", icon: "🐸" },
    { id: byKeyword(/reptile/i), label: "Reptiles", icon: "🦎" },
    { id: byKeyword(/insect/i), label: "Insects", icon: "🦋" },
    // Arthropoda AFTER insects so insects claim their own bucket first, which leaves
    // this one holding the arthropods that AREN'T insects: chelicerates (spiders,
    // scorpions, mites, horseshoe crabs), crustaceans, centipedes. Named for those two
    // halves rather than the clade — an "Arthropods" bar sitting beside an "Insects" bar
    // read as though insects weren't arthropods.
    { id: byKeyword(/arthropod/i), label: "Crustaceans & spiders", icon: "🦀" },
    { id: byKeyword(/plant/i), label: "Plants", icon: "🌿" },
  ] as Array<{ id: string | undefined; label: string; icon: string }>
).filter((g): g is CladeGroup => Boolean(g.id));

export const OTHER_GROUP: CladeGroup = { id: "other", label: "Other animals", icon: "🐾" };

const GROUP_BY_ID = new Map<string, CladeGroup>(
  [...CLADE_GROUPS, OTHER_GROUP].map((g) => [g.id, g])
);

export function cladeGroup(id: string): CladeGroup {
  return GROUP_BY_ID.get(id) ?? OTHER_GROUP;
}

/** Which group an answer species belongs to (its id). */
export function groupOf(tree: Tree, answerId: string): string {
  for (const g of CLADE_GROUPS) {
    if (tree.byId.has(g.id) && isAncestor(tree, g.id, answerId)) return g.id;
  }
  return OTHER_GROUP.id;
}

/** The group a whole BOARD sits in, from any ids it is built out of (clades or
 *  species). Kinship and Branches boards never span two groups — both generators
 *  reject a container that spans two classes — so the first id the tree knows
 *  settles it. Null when the tree knows none of them: that leaves the day out of the
 *  clade bars, rather than filing it under "Other animals" as if that were a result.
 *  Pass the widest set of ids available (clade ids first, they resolve most often:
 *  Kinship/Branches boards are built from the rich tree, whose extra species are
 *  absent from the base tree but whose parent families usually aren't). */
export function boardGroupOf(tree: Tree, ids: string[]): string | null {
  for (const id of ids) if (tree.byId.has(id)) return groupOf(tree, id);
  return null;
}
