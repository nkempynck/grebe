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
 *
 * Two trees exist:
 *  • loadTree()      — the BASE in-set tree. Lineage's answer + guess pool; MUST
 *    stay curated or dailies get impossibly obscure.
 *  • loadRichTree()  — base PLUS a quality-filtered augment (taxonomyAugment.json),
 *    used ONLY by Kinship/Branches for richer clade variety. The augment is lazy-
 *    loaded (a separate chunk fetched when those games open), so the initial page
 *    and Lineage never pay for it.
 */
let cached: Promise<Tree> | null = null;
let richCached: Promise<Tree> | null = null;

export function loadTree(): Promise<Tree> {
  if (!cached) cached = build(taxonomy.nodes as TaxonNode[]);
  return cached;
}

/** The base tree grafted with the Kinship/Branches augment. Same node refs as the
 *  base for shipped taxa are NOT guaranteed (this is a distinct tree), so keep it to
 *  the two games that generate boards from it. Lazy — the augment chunk downloads on
 *  first call. */
export function loadRichTree(): Promise<Tree> {
  if (!richCached) {
    richCached = import("./taxonomyAugment.json").then((m) => {
      const augment = (m.default ?? m) as { nodes: TaxonNode[] };
      return build([...(taxonomy.nodes as TaxonNode[]), ...augment.nodes]);
    });
  }
  return richCached;
}

async function build(rawNodes: TaxonNode[]): Promise<Tree> {
  // Clade common names are DERIVED at build time (GBIF vernaculars, baked into
  // taxonomy.json). CLADE_COMMON is kept only as a CORRECTION layer: a curated entry
  // OVERRIDES the baked name, so we can fix GBIF's junk/ambiguous clade vernaculars
  // without regenerating. Clades with neither stay scientific-only. (The augment's
  // extra clades pass through here too, so the same corrections apply to them.)
  const nodes = rawNodes.map((n) =>
    n.rank !== "species" && CLADE_COMMON[n.sciName]
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
