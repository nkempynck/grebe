import type { Tree, TaxonNode } from "./types";

/**
 * Normalize a name for matching: strip diacritics, lowercase, fold punctuation
 * and hyphens to spaces, collapse whitespace. Applied identically to queries,
 * node names, and synonym keys (at load), so matches are stable — e.g.
 * "Black-capped Chickadee" and "black capped chickadee" match, and "Réunion"
 * matches "reunion".
 */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD").replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
const norm = normalizeName;

/** Levenshtein edit distance (two-row DP). Names are short, so this is cheap. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/** Max edit distance tolerated for a query of a given length — tight for short
 *  words (where one edit changes the meaning) and looser for long ones. */
function fuzzTolerance(len: number): number {
  if (len < 4) return 0; // too short to fuzz safely ("bat" vs "cat")
  if (len <= 6) return 1;
  return 2;
}

/**
 * Resolve a typed guess to a node. In order: exact common/scientific name, then a
 * synonym ("orca" → killer whale), then a conservative typo-tolerant fallback.
 * The fuzzy step only fires when nothing exact matched, is length-gated, and
 * rejects ties — so a typo never silently resolves to the wrong species.
 */
export function resolveGuess(tree: Tree, input: string): TaxonNode | null {
  // Accept the "Common name (Scientific name)" form the autocomplete offers, as
  // well as either name on its own.
  const combined = input.match(/^\s*(.*?)\s*\(([^()]+)\)\s*$/);
  const queries = combined ? [combined[1], combined[2], input] : [input];

  for (const raw of queries) {
    const q = norm(raw);
    if (!q) continue;
    // 1) exact common / scientific name
    for (const node of tree.byId.values()) {
      if (node.common && norm(node.common) === q) return node;
      if (norm(node.sciName) === q) return node;
    }
    // 2) synonym
    const synId = tree.synonyms?.get(q);
    if (synId) {
      const n = tree.byId.get(synId);
      if (n) return n;
    }
  }

  // 3) typo-tolerant fallback on the primary query only — accept the unique
  //    closest name within tolerance; reject a tie between different nodes.
  const q = norm(combined ? combined[1] : input);
  const tol = fuzzTolerance(q.length);
  if (!q || tol === 0) return null;
  let best: TaxonNode | null = null;
  let bestD = tol + 1;
  let tie = false;
  for (const node of tree.byId.values()) {
    for (const name of [node.common, node.sciName]) {
      if (!name) continue;
      const d = editDistance(q, norm(name));
      if (d < bestD) {
        bestD = d;
        best = node;
        tie = false;
      } else if (d === bestD && best && node.id !== best.id) {
        tie = true;
      }
    }
  }
  return best && !tie && bestD <= tol ? best : null;
}

/** Guess suggestions for autocomplete, ranked by prefix match then substring —
 *  over common + scientific names, plus synonym keys (so "orca" surfaces the
 *  killer whale). */
export function suggestGuesses(tree: Tree, input: string, limit = 8): TaxonNode[] {
  const q = norm(input);
  if (!q) return [];
  const seen = new Set<string>();
  const prefix: TaxonNode[] = [];
  const substr: TaxonNode[] = [];
  const add = (arr: TaxonNode[], node: TaxonNode) => {
    if (!seen.has(node.id)) { seen.add(node.id); arr.push(node); }
  };
  const names = (n: TaxonNode) => [n.common, n.sciName].filter(Boolean).map((x) => norm(x!));

  for (const node of tree.byId.values()) {
    const ns = names(node);
    if (ns.some((x) => x.startsWith(q))) add(prefix, node);
    else if (ns.some((x) => x.includes(q))) add(substr, node);
  }
  if (tree.synonyms) {
    for (const [alt, id] of tree.synonyms) {
      const node = tree.byId.get(id);
      if (!node || seen.has(id)) continue;
      if (alt.startsWith(q)) add(prefix, node);
      else if (alt.includes(q)) add(substr, node);
    }
  }
  return [...prefix, ...substr].slice(0, limit);
}
