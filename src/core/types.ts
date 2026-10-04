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
  /** Clades only: where `common` came from when scripts/patch-clade-common.mjs gave it ("Wikipedia
   *  title" or "Wikidata"). Absent for names from the base build or hand-written ones. */
  commonSource?: string;
  /** Taxonomic rank label for display only (the math uses depth, not rank). */
  rank: string;
  /** Rank used to read group separation (separationTierOf), and shown as the rank label in
   *  every game's tree and Mosaic (displayRank). Never read by Lineage's win logic. Set by the name-injection steps on clades OTL left anonymous, whose
   *  `rank` must stay "clade": nearestAncestorOfRank stops at the first ancestor ranked
   *  above the one it wants, so promoting these to real ranks would break the family win
   *  target on lineages whose family crown is itself an injected clade — on days already
   *  pinned. Without this the rank-based separation scale measures how well OTL labels a
   *  corner of the tree rather than how close two groups are: plants had a ranked MRCA on
   *  4% of group-pairs versus 29-40% elsewhere, so every plant board read as trivial. */
  sepRank?: string;
  /** Parent node id, or null for the root of the whole dataset. */
  parentId: string | null;
  /** Wikipedia article title to link to. Falls back to common/sciName. */
  wikiTitle?: string;
  /** Species only: extinct, so no photograph of a living one exists. Mosaic never draws it as
   *  the answer; nothing else reads it. Set by scripts/patch-extinct.mjs. */
  extinct?: boolean;
  /** A label the build MADE UP for Kinship ("Phodopus & Mesocricetus", "Capra & Hemitragus"):
   *  an anonymous clade named by joining what is inside it, so Kinship has more groups of four.
   *  Only Kinship reads it as a name. Every other game treats the node as unnamed, which is how
   *  they saw it before the label existed. Set by patch-merged-clades and patch-junction-splits. */
  synthetic?: boolean;
  /** Set when `sciName` was given by scripts/patch-ott-names.mjs: the Open Tree Taxonomy taxon
   *  ("ott<N>") whose members in our trees are exactly the species under this node. */
  ottTaxon?: string;
  /** Set when `sciName` was given by scripts/patch-mdd-names.mjs: the Mammal Diversity Database
   *  taxon ("subfamily Globicephalinae") whose members in our trees are exactly the species
   *  under this node. */
  mddTaxon?: string;
  /** Set when `sciName` was given by scripts/patch-col-names.mjs: the Catalogue of Life taxon
   *  and the specialist database COL took it from ("subfamily Falconinae (ITIS 2026-08-26)"). */
  colTaxon?: string;
  /** Species only: its picture in speciesPhotos.json is a real photograph (not missing, not an
   *  old plate). Kinship deals only these. Set by scripts/patch-photo-flags.mjs. */
  photo?: boolean;
  /** Species only: ~60-day English Wikipedia pageviews — a fame/familiarity proxy
   *  (replaces the old GBIF `occ`; pageviews track recognition, not survey effort).
   *  Lineage weights the daily answer by a within-ORDER percentile of this (scaled by
   *  tier), so each order's recognisable members surface rather than the most
   *  species-rich group. */
  views?: number;
  /** Clades only: ~60-day pageviews of the clade's OWN article (set by
   *  scripts/patch-clade-views.mjs). A group can be famous while its species are not —
   *  "Clownfish" is one of the best-known animals alive, `Amphiprion perideraion` is not —
   *  so this is used to decide whether a group is RECOGNISABLE enough to show. It
   *  deliberately does not feed difficulty tiering; see MIN_BOARD_FAME in core/grid.ts. */
  cladeViews?: number;
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
