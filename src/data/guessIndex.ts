// Out-of-set guess index.
//
// A player can guess ANY organism, not just the curated playable set. This module
// finds an out-of-set organism and returns a graft payload (species + missing
// ancestor clades + a connection point we ship) so the guess lands informatively
// on the tree — see src/core/graft.ts.
//
// Two tiers so the search bar never floods a casual player:
//   • LOCAL — a tiny curated set, always available (instant, works offline). Kept
//     deliberately small; it's the "we thought of these" layer.
//   • DB — the broad universe via the search_taxa RPC (supabase/taxon_index.sql),
//     populated by scripts/build-guess-index.mjs + load-guess-index.mjs. The
//     "for nerds" long tail, only queried when someone types past the curated set.
// In-set (playable) matches are ranked ABOVE both tiers by GuessInput.

import { normalizeName, type GraftTaxon } from "../core";
import { supabase } from "./supabase";

/** A typeahead hit for an out-of-set organism, carrying its graft payload so the
 *  caller can place it without a second lookup. */
export interface OutOfSetHit {
  id: string;
  common: string;
  sci: string;
  /** "group" for a clade (order/family/…), "species" otherwise — for display. */
  kind: "species" | "group";
  graft: GraftTaxon;
}

/** A clade rank reads as a "group"; species/subspecies read as a species. */
const kindOf = (rank: string): "species" | "group" =>
  /^(species|subspecies|form|variety)$/i.test(rank) ? "species" : "group";

interface LocalEntry { keys: string[]; graft: GraftTaxon; }

// Tiny curated layer. Keys normalized at load. Add well-known organisms here to
// guarantee they resolve even with no backend.
const LOCAL: LocalEntry[] = [
  {
    keys: ["okapi", "okapia johnstoni", "forest giraffe"],
    graft: {
      id: "oos:okapia-johnstoni", sciName: "Okapia johnstoni", common: "Okapi", rank: "species",
      lineage: [{ id: "ott768685", sciName: "Giraffidae", rank: "family" }],
    },
  },
].map((e) => ({ ...e, keys: e.keys.map(normalizeName) }));

const toHit = (g: GraftTaxon): OutOfSetHit => ({ id: g.id, common: g.common ?? g.sciName, sci: g.sciName, kind: kindOf(g.rank), graft: g });

function localMatches(nq: string): { pre: OutOfSetHit[]; sub: OutOfSetHit[] } {
  const pre: OutOfSetHit[] = [], sub: OutOfSetHit[] = [];
  for (const e of LOCAL) {
    if (e.keys.some((k) => k.startsWith(nq))) pre.push(toHit(e.graft));
    else if (e.keys.some((k) => k.includes(nq))) sub.push(toHit(e.graft));
  }
  return { pre, sub };
}

interface TaxaRow { ott_id: string; sci_name: string; common: string | null; rank: string | null; lineage: GraftTaxon["lineage"]; }
const rowToHit = (r: TaxaRow): OutOfSetHit => {
  const graft: GraftTaxon = { id: r.ott_id, sciName: r.sci_name, common: r.common ?? undefined, rank: r.rank ?? "species", lineage: r.lineage };
  return toHit(graft);
};

/** Out-of-set organisms whose name matches `query`: curated LOCAL hits first, then
 *  the DB long tail. Async because the DB is queried per keystroke (debounce at the
 *  call site). Returns [] when nothing matches or there's no backend. */
export async function searchOutOfSet(query: string, limit = 4): Promise<OutOfSetHit[]> {
  const nq = normalizeName(query);
  if (!nq) return [];
  const { pre, sub } = localMatches(nq);
  const out: OutOfSetHit[] = [...pre, ...sub];
  const seen = new Set(out.map((h) => h.id));

  if (supabase && out.length < limit) {
    try {
      const { data, error } = await supabase.rpc("search_taxa", { q: nq, lim: limit });
      if (!error && data) {
        for (const r of data as TaxaRow[]) {
          if (seen.has(r.ott_id)) continue;
          seen.add(r.ott_id);
          out.push(rowToHit(r));
        }
      }
    } catch { /* offline / not configured — local hits still stand */ }
  }
  return out.slice(0, limit);
}

/** Resolve typed text (or the "Common (Scientific)" autocomplete form) to a graft
 *  payload for the Enter-without-picking path. Curated LOCAL first, else the DB. */
export async function resolveOutOfSet(text: string): Promise<GraftTaxon | null> {
  const combined = text.match(/^\s*(.*?)\s*\(([^()]+)\)\s*$/);
  const queries = combined ? [combined[1], combined[2], text] : [text];
  for (const raw of queries) {
    const nq = normalizeName(raw);
    if (!nq) continue;
    const local = LOCAL.find((e) => e.keys.includes(nq));
    if (local) return local.graft;
  }
  // DB: take the best hit whose name matches the primary query exactly.
  const primary = normalizeName(combined ? combined[1] : text);
  if (!primary) return null;
  const hits = await searchOutOfSet(primary, 5);
  const exact = hits.find((h) => normalizeName(h.common) === primary || normalizeName(h.sci) === primary);
  return (exact ?? hits[0])?.graft ?? null;
}
