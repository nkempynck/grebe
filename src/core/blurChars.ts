// BLUR — the character table.
//
// Each column is a trait the player can judge about their OWN guess ("I guessed a lion, a lion
// has four legs and fur"), shown beside the answer's value so a wrong guess still narrows the
// field. Mastermind, with taxonomy as the hidden code.
//
// EVERY CHARACTER IS AUTHORED. The tree supplies structure, not traits: it knows a dolphin is
// inside Cetacea, it does not know a dolphin swims. So a character is an ordered list of
// clade -> value rules, FIRST MATCH WINS walking up from the species, plus a default. That
// ordering is what makes it tractable — `aquatic` is fifteen entries and a default of "no",
// not a decision for each of 1155 families.
//
// WHY NOT SINGLE CLADES. Indicator columns for nested clades are laminar: "is a chordate",
// "is a tetrapod", "is a mammal" are one chain, so k of them yield at most k+1 distinct rows.
// Measured over every clade in the tree, a greedy optimiser got 3.13 bits of the 11.5 needed.
// The characters that actually partition are the CONVERGENT ones — legs, flight, water — whose
// rule is a union of clades scattered across the tree. Hence the shape below.
//
// KNOWN LIMIT, by design. This set separates 3844 species into ~20 rows and saturates inside a
// class (all 394 fish share one row). That is expected and is not what the table is for: the
// image carries identification, the table carries direction, and inside a scope the player
// narrows by filtering the guess bar to clades they have ruled in or out. Per-scope character
// sets were considered and rejected — within a scope the tree has no trait information left to
// give, so they would be hand-written content per family rather than rules over the tree.
import type { Tree } from "./types";

/** A value of "n/a" prints as a dash and never counts as a match — a plant has no leg count,
 *  and pretending it has zero would score a sunflower and a snake as agreeing. */
export const NA = "n/a";

export interface Character {
  id: string;
  /** Column header. Short: this sits above a narrow column on a phone. */
  label: string;
  /** Ordered clade -> value, by SCIENTIFIC name. First ancestor matched wins, so put the
   *  exceptions above the generalisations (flightless birds before Aves). */
  rules: Array<[string, string]>;
  /** Value for a species no rule matches. */
  fallback: string;
}

export const CHARACTERS: Character[] = [
  {
    id: "legs",
    label: "Legs",
    rules: [
      // Exceptions first: limbless or flipper-bearing lineages inside four-legged groups.
      ["Cetacea", "0"], ["Sirenia", "0"], ["Serpentes", "0"], ["Gymnophiona", "0"],
      ["Otariidae", "0"], ["Phocidae", "0"], ["Odobenidae", "0"],
      // Arthropods and friends.
      ["Insecta", "6"], ["Chelicerata", "8"], ["Myriapoda", "many"], ["Decapoda", "10"],
      // Two-legged.
      ["Aves", "2"], ["Hominidae", "2"], ["Macropodidae", "2"],
      // The four-legged default for the rest of the tetrapods.
      ["Mammalia", "4"], ["Squamata", "4"], ["Testudines", "4"], ["Amphibia", "4"],
      // There is no Crocodylia node in the tree, so the three families stand in for it.
      ["Alligatoridae", "4"], ["Crocodylidae", "4"], ["Gavialidae", "4"],
      // Everything green, and the sessile invertebrates, have no legs to count.
      ["Chloroplastida", NA], ["Porifera", NA], ["Cnidaria", NA],
    ],
    fallback: "0",
  },
  {
    id: "water",
    label: "In water",
    rules: [
      ["Cetacea", "yes"], ["Sirenia", "yes"],
      ["Otariidae", "yes"], ["Phocidae", "yes"], ["Odobenidae", "yes"], ["Lutrinae", "yes"],
      ["Hippopotamidae", "yes"],
      ["Actinopterygii", "yes"], ["Chondrichthyes", "yes"], ["Amphibia", "yes"],
      ["Testudines", "yes"], ["Spheniscidae", "yes"], ["Anatidae", "yes"],
      ["Alligatoridae", "yes"], ["Crocodylidae", "yes"], ["Gavialidae", "yes"],
      ["Cephalopoda", "yes"], ["Bivalvia", "yes"], ["Decapoda", "yes"],
      ["Cnidaria", "yes"], ["Echinodermata", "yes"], ["Porifera", "yes"],
    ],
    fallback: "no",
  },
  {
    id: "flies",
    label: "Flies",
    rules: [
      // Flightless birds before Aves, and the wingless insects before Pterygota.
      ["Sphenisciformes", "no"], ["Struthionidae", "no"], ["Rheidae", "no"],
      ["Casuariiformes", "no"], ["Spheniscidae", "no"],
      ["Aves", "yes"], ["Chiroptera", "yes"],
      ["Siphonaptera", "no"], ["Formicidae", "no"], ["Pterygota", "yes"],
      ["Chloroplastida", NA],
    ],
    fallback: "no",
  },
  {
    id: "warm",
    label: "Warm-blooded",
    rules: [["Mammalia", "yes"], ["Aves", "yes"], ["Chloroplastida", NA]],
    fallback: "no",
  },
  {
    id: "covering",
    label: "Covered in",
    rules: [
      ["Aves", "feathers"],
      ["Cetacea", "skin"], ["Sirenia", "skin"], ["Mammalia", "fur"],
      ["Squamata", "scales"],
      ["Alligatoridae", "scales"], ["Crocodylidae", "scales"], ["Gavialidae", "scales"],
      ["Testudines", "shell"], ["Bivalvia", "shell"], ["Gastropoda", "shell"],
      ["Actinopterygii", "scales"], ["Chondrichthyes", "skin"],
      ["Amphibia", "skin"], ["Cephalopoda", "skin"],
      ["Arthropoda", "shell"],
      ["Chloroplastida", NA],
    ],
    fallback: "skin",
  },
  {
    id: "kingdom",
    label: "Kind",
    rules: [
      ["Chloroplastida", "plant"], ["Fungi", "fungus"],
      ["Chordata", "vertebrate"], ["Metazoa", "invertebrate"],
    ],
    fallback: "other",
  },
];

/** sciName -> node id, per tree. Built once; the tree is a stable object. */
const nameIndex = new WeakMap<Tree, Map<string, string>>();
function indexOf(tree: Tree): Map<string, string> {
  let m = nameIndex.get(tree);
  if (!m) {
    m = new Map();
    for (const n of tree.byId.values()) if (n.sciName && !m.has(n.sciName)) m.set(n.sciName, n.id);
    nameIndex.set(tree, m);
  }
  return m;
}

/** Ancestors of `id`, nearest first, including itself. */
function chain(tree: Tree, id: string): string[] {
  const out: string[] = [];
  for (let c: string | null | undefined = id; c; c = tree.byId.get(c)?.parentId) out.push(c);
  return out;
}

/** The value of one character for one species. */
export function characterValue(tree: Tree, char: Character, speciesId: string): string {
  const idx = indexOf(tree);
  const anc = new Set(chain(tree, speciesId));
  for (const [sci, value] of char.rules) {
    const id = idx.get(sci);
    if (id && anc.has(id)) return value;
  }
  return char.fallback;
}

/** Every character for one species, keyed by character id. */
export function characterRow(tree: Tree, speciesId: string): Record<string, string> {
  const row: Record<string, string> = {};
  for (const c of CHARACTERS) row[c.id] = characterValue(tree, c, speciesId);
  return row;
}

/** Which clade names a rule references that the tree does not have. A rule naming an absent
 *  clade matches nothing and fails SILENTLY, which is the whole reason this is checked in a
 *  test: several obvious names simply are not in the tree (there is no Pinnipedia, no
 *  Arachnida, no Charadriiformes), so authoring has to be verified against the data. */
export function missingCladeNames(tree: Tree): string[] {
  const idx = indexOf(tree);
  const missing = new Set<string>();
  for (const c of CHARACTERS) for (const [sci] of c.rules) if (!idx.has(sci)) missing.add(sci);
  return [...missing].sort();
}
