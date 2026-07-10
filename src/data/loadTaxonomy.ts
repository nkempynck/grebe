import { buildTree } from "../core/tree";
import type { TaxonNode, Tree } from "../core/types";
import taxonomy from "./taxonomy.json";
import { CLADE_COMMON } from "./cladeNames";

/**
 * The single place the app gets its tree from. It reads a build-time snapshot
 * (src/data/taxonomy.json) produced by `npm run build:taxonomy`, which pulls a
 * balanced, occurrence-weighted slice of the GBIF backbone. The app itself never
 * hits the network — regenerate the JSON to refresh the data.
 */
export async function loadTree(): Promise<Tree> {
  // Give the major clades friendly common names so they can be guessed as groups
  // ("snakes", "cats") and read nicely. Species and already-named nodes untouched.
  const nodes = (taxonomy.nodes as TaxonNode[]).map((n) =>
    n.rank !== "species" && !n.common && CLADE_COMMON[n.sciName]
      ? { ...n, common: CLADE_COMMON[n.sciName] }
      : n
  );
  return buildTree(nodes);
}
