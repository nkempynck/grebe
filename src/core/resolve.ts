import type { Tree, TaxonNode } from "./types";

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Resolve a typed guess to a node. Matches common name or scientific name,
 * case-insensitively.
 *
 * TODO (the quietly expensive part — see README): real play needs a synonym
 * layer. "mallard" -> Anas platyrhynchos, "orca"/"killer whale" -> same node,
 * plus fuzzy matching for typos. Start that table here when you wire in a real
 * dataset; keep it as data, not code, so it can grow independently.
 */
export function resolveGuess(tree: Tree, input: string): TaxonNode | null {
  // Accept the "Common name (Scientific name)" form the autocomplete offers, as
  // well as either name on its own.
  const combined = input.match(/^\s*(.*?)\s*\(([^()]+)\)\s*$/);
  const queries = combined ? [combined[1], combined[2], input] : [input];
  for (const raw of queries) {
    const q = norm(raw);
    if (!q) continue;
    for (const node of tree.byId.values()) {
      if (node.common && norm(node.common) === q) return node;
      if (norm(node.sciName) === q) return node;
    }
  }
  return null;
}

/** Guess suggestions for autocomplete, ranked by prefix match then substring. */
export function suggestGuesses(
  tree: Tree,
  input: string,
  limit = 8
): TaxonNode[] {
  const q = norm(input);
  if (!q) return [];
  const names = (n: TaxonNode) => [n.common, n.sciName].filter(Boolean).map((x) => norm(x!));
  const prefix: TaxonNode[] = [];
  const substr: TaxonNode[] = [];
  for (const node of tree.byId.values()) {
    const ns = names(node);
    if (ns.some((x) => x.startsWith(q))) prefix.push(node);
    else if (ns.some((x) => x.includes(q))) substr.push(node);
  }
  return [...prefix, ...substr].slice(0, limit);
}
