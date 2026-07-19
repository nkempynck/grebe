// Framework-agnostic type definitions for the phylogeny engine.
// NOTHING in src/core may import React, the DOM, or any UI library.
// This is the portable heart of the game — it can be lifted into an
// Expo / React Native app (or a server) without modification.

/** A single node in the tree of life. Both internal clades and leaf species
 *  use this same shape; a leaf is simply a node with no children. */
export interface TaxonNode {
  /** Stable unique id (slug). Used for all lookups and daily seeding. */
  id: string;
  /** Scientific name, e.g. "Tursiops truncatus" or "Mammalia". */
  sciName: string;
  /** Common name, if the node has a recognisable one, e.g. "Bottlenose dolphin". */
  common?: string;
  /** Taxonomic rank label for display only (the math uses depth, not rank). */
  rank: string;
  /** Parent node id, or null for the root of the whole dataset. */
  parentId: string | null;
  /** Wikipedia article title to link to. Falls back to common/sciName. */
  wikiTitle?: string;
  /** Species only: ~60-day English Wikipedia pageviews — a fame/familiarity proxy
   *  (replaces the old GBIF `occ`; pageviews track recognition, not survey effort).
   *  Lineage weights the daily answer by a within-ORDER percentile of this (scaled by
   *  tier), so each order's recognisable members surface rather than the most
   *  species-rich group. */
  views?: number;
  /** Species only: a curated iconic species (matches EXTRAS) — floored to top
   *  prominence so easy/medium days favour icons even if lightly recorded. */
  icon?: boolean;
  /** True for a node GRAFTED at runtime — an out-of-set organism (and any missing
   *  ancestor clades) added to the tree by an informative guess. Never baked, never
   *  a daily answer, never a winning guess; purely to show where a probe lands. */
  virtual?: boolean;
}

/** An indexed, ready-to-query tree built from a flat TaxonNode list. */
export interface Tree {
  byId: Map<string, TaxonNode>;
  /** child ids for a given node id */
  childrenOf: Map<string, string[]>;
  /** depth from the dataset root (root = 0) */
  depthOf: Map<string, number>;
  rootId: string;
  /** Optional: normalized alternate name → node id, for synonym guesses
   *  ("orca" → the killer-whale node). Attached by the data loader; `core/`
   *  stays data-free, so this is undefined for a bare buildTree(). */
  synonyms?: Map<string, string>;
}

/** User-defined difficulty. Both knobs are just coordinates on the tree:
 *  scopeRootId sets the ROOT we start from, winWithin sets how far down
 *  the LEAVES the answer must be pinned. */
export interface GameConfig {
  /** Node id to treat as the root of play (e.g. "aves" for birds-only). */
  scopeRootId: string;
  /** How close a guess must land to count as a win, measured in edges
   *  between the answer leaf and the shared ancestor.
   *  0 = exact species, 1 = same genus, 2 = same family, ... */
  winWithin: number;
}

/** Result of scoring one guess against the hidden answer. */
export interface GuessResult {
  guess: TaxonNode;
  /** Most recent common ancestor of guess and answer. */
  mrca: TaxonNode;
  /** Edges between the answer leaf and the MRCA (0 means guess == answer). */
  stepsFromAnswer: number;
  /** 0 (coldest, only shares the scope root) .. 1 (exact hit), rescaled to scope. */
  warmth: number;
  /** True when the guess is within the configured winWithin tolerance. */
  isWin: boolean;
}

export type GameStatus = "playing" | "won" | "gaveup";
