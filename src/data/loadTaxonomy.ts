import { buildTree } from "../core/tree";
import { normalizeName } from "../core/resolve";
import type { TaxonNode, Tree } from "../core/types";
import taxonomy from "./taxonomy.json";
import { CLADE_COMMON } from "./cladeNames";
import { SYNONYMS } from "./synonyms";

/**
 * The single place the app gets its tree from. It reads a build-time snapshot
 * (src/data/taxonomy.json) produced by `npm run build:taxonomy`, which pulls a
 * balanced, occurrence-weighted slice of the GBIF backbone. The app itself never
 * hits the network — regenerate the JSON to refresh the data.
 *
 * The built tree is cached (one promise), so every caller shares the SAME tree
 * and node object references. That matters when more than one `useGame` is live
 * (e.g. the admin test bench alongside the main game): guesses from one must be
 * renderable by components reading the other's tree, which only holds if the node
 * references are identical.
 */
let cached: Promise<Tree> | null = null;

export function loadTree(): Promise<Tree> {
  if (!cached) cached = build();
  return cached;
}

async function build(): Promise<Tree> {
  // Give the major clades friendly common names so they can be guessed as groups
  // ("snakes", "cats") and read nicely. Species and already-named nodes untouched.
  const nodes = (taxonomy.nodes as TaxonNode[]).map((n) =>
    n.rank !== "species" && !n.common && CLADE_COMMON[n.sciName]
      ? { ...n, common: CLADE_COMMON[n.sciName] }
      : n
  );
  const tree = buildTree(nodes);

  // Attach curated synonyms: resolve each alternate name to a node via its
  // scientific name. Entries whose target isn't in this snapshot are dropped.
  const bySci = new Map<string, string>();
  for (const n of tree.byId.values()) bySci.set(normalizeName(n.sciName), n.id);
  const synonyms = new Map<string, string>();
  for (const [alt, sci] of Object.entries(SYNONYMS)) {
    const id = bySci.get(normalizeName(sci));
    if (id) synonyms.set(normalizeName(alt), id);
  }
  return { ...tree, synonyms };
}
