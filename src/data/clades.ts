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
    // Arthropods AFTER insects so insects claim their own bucket first; this
    // catches the non-insect arthropods (arachnids, crustaceans, …).
    { id: byKeyword(/arthropod/i), label: "Arthropods", icon: "🦂" },
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
