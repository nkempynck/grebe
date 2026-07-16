// Out-of-set guess index (PROOF OF CONCEPT).
//
// The playable/answer set is curated, but a player can guess ANY organism. This
// module maps a typed name to a graft payload (the species + whatever ancestor
// clades we're missing, with a connection point that already exists in the tree),
// so an out-of-set guess lands informatively — see src/core/graft.ts.
//
// This is a hand-built SAMPLE of a couple of genuine gaps, using real OTT ids for
// the connection points and `oos:`-prefixed ids for the nodes we materialise (so
// they can never collide with a baked id). The real index will be DB-backed and
// cover the whole named tree (search_taxa RPC), replacing this file wholesale.

import { normalizeName, type GraftTaxon } from "../core";

interface IndexEntry {
  graft: GraftTaxon;
  /** Normalized names/synonyms this entry answers to. */
  keys: string[];
}

const SAMPLE: IndexEntry[] = [
  {
    // Okapi hangs directly under Giraffidae (ott768685), which we ship (giraffe is
    // in the set) — so this grafts a single leaf right beside the giraffe.
    keys: ["okapi", "okapia johnstoni", "forest giraffe"],
    graft: {
      id: "oos:okapia-johnstoni", sciName: "Okapia johnstoni", common: "Okapi", rank: "species",
      lineage: [{ id: "ott768685", sciName: "Giraffidae", rank: "family" }],
    },
  },
  {
    // Pangolins (order Pholidota) are missing entirely; their nearest shipped
    // ancestor is Laurasiatheria (ott392223). This grafts the family + order too,
    // so the missing Pholidota branch appears on the tree.
    keys: ["pangolin", "pangolins", "chinese pangolin", "manis pentadactyla", "scaly anteater"],
    graft: {
      id: "oos:manis-pentadactyla", sciName: "Manis pentadactyla", common: "Chinese pangolin", rank: "species",
      lineage: [
        { id: "oos:manidae", sciName: "Manidae", common: "Pangolins", rank: "family" },
        { id: "oos:pholidota", sciName: "Pholidota", common: "Pangolins", rank: "order" },
        { id: "ott392223", sciName: "Laurasiatheria", rank: "superorder" },
      ],
    },
  },
].map((e) => ({ ...e, keys: e.keys.map(normalizeName) }));

/** A typeahead hit for an out-of-set organism (rendered below in-set matches). */
export interface OutOfSetHit { id: string; common: string; sci: string; }

/** Out-of-set organisms whose name matches `query`, prefix hits before substring
 *  hits. Empty query returns nothing (the browse list stays in-set only). */
export function searchOutOfSet(query: string, limit = 4): OutOfSetHit[] {
  const q = normalizeName(query);
  if (!q) return [];
  const pre: OutOfSetHit[] = [];
  const sub: OutOfSetHit[] = [];
  for (const e of SAMPLE) {
    const hit: OutOfSetHit = { id: e.graft.id, common: e.graft.common ?? e.graft.sciName, sci: e.graft.sciName };
    if (e.keys.some((k) => k.startsWith(q))) pre.push(hit);
    else if (e.keys.some((k) => k.includes(q))) sub.push(hit);
  }
  return [...pre, ...sub].slice(0, limit);
}

/** Resolve typed text (or the "Common (Scientific)" autocomplete form) to a graft
 *  payload, or null if it's not a known out-of-set organism. */
export function resolveOutOfSet(text: string): GraftTaxon | null {
  const combined = text.match(/^\s*(.*?)\s*\(([^()]+)\)\s*$/);
  const queries = combined ? [combined[1], combined[2], text] : [text];
  for (const raw of queries) {
    const q = normalizeName(raw);
    if (!q) continue;
    const e = SAMPLE.find((entry) => entry.keys.includes(q));
    if (e) return e.graft;
  }
  return null;
}
