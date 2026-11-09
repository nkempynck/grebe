# Taxonomy data pipeline

This document describes how Grebe's tree is generated from public data. To use the finished tree,
no build is needed: see "Using the tree" in the [README](../README.md).

## Overview

The tree combines four kinds of data:

- Species selection: English Wikipedia pageviews over a window of about 60 days.
- Topology and most clade ranks: the Open Tree of Life synthetic tree.
- Common names: Wikipedia article titles and the Wikidata property "taxon common name" (P1843).
- Names for clades that Open Tree leaves unnamed: the Open Tree Taxonomy (OTT), the Mammal
  Diversity Database (MDD) and the Catalogue of Life (COL).

GBIF keys, taken from Wikidata (P846), serve only as species identifiers.

| Output | Contents |
|--------|----------|
| `src/data/taxonomy.json` | The base tree, capped at 3 species per genus and a per-family limit that scales with pageviews. Used by all games. |
| `src/data/taxonomyAugment.json` | Further species and genera attached to the base tree. Used by Kinship and Branches only. |
| `src/data/guessIndex.generated.json` | Taxa outside the base tree, each with a lineage for attaching it to the tree. Used to place guesses. |

The selection stages (A and B below) write their results to `sel-*.json` files in
`node_modules/.cache/`, which git does not track.

## Rebuilding from frozen inputs

A snapshot of those files is available as a release. It fixes the species set and the topology:

```bash
npm ci
mkdir -p node_modules/.cache
curl -L https://github.com/nkempynck/grebe/releases/download/pipeline-inputs-2026-11-09/grebe-pipeline-inputs.tar.gz \
  | tar -xz -C node_modules/.cache
npm run build:taxonomy
git diff --stat src/data
```

The build takes a few minutes, requires access to the Open Tree and Wikidata APIs, and overwrites
`taxonomy.json`, `taxonomyAugment.json` and `junctionSplits.json`.

Run this way, `npm run build:taxonomy` exits with status 1. The final step,
`check-taxonomy-ranks`, reports rank errors that are corrected by a patch outside the default
chain. The output files have been written by that point.

### Including the rank corrections

Two rank changes are excluded from the default chain because they alter game difficulty: order
ranks (`--rank-orders`) and the homonym corrections. The shipped tree has them. To include them:

```bash
node scripts/assemble-taxonomy.mjs --rank-orders
for s in build-names finalize-taxonomy patch-wiki-titles patch-clade-views patch-merged-clades \
         patch-junction-splits patch-drop-excluded patch-extinct patch-ott-names patch-mdd-names \
         patch-col-names patch-seprank-homonyms patch-inverted-ranks patch-clade-common \
         patch-photo-flags stamp-snapshot check-taxonomy-ranks; do
  node "scripts/$s.mjs"
done
```

`patch-seprank-homonyms` and `check-taxonomy-ranks` can exit with status 1 when an entry needs
review. In the test below both did, and the remaining steps ran normally.

### Differences from the shipped tree

The commands above were tested on 2026-11-09 from a clean clone of commit 5861aa0. The result was
compared with the committed files:

| Compared | Result |
|----------|--------|
| Base tree: node ids, `parentId`, `rank` | No differences (10,870 nodes) |
| Augment: all fields | No differences (4,928 nodes) |
| Joined labels (`synthetic`), base tree | 49 absent from the rebuild, 3 new |
| `cladeViews` | Absent on 21 nodes |
| `common` | 18 species and 3 clades differ |
| `sepRank` | 10 nodes differ |
| `wikiTitle` | 8 nodes differ |

The rebuild therefore reproduces the structure of the tree but not all of its labels. The known
causes are:

1. Joined labels. `patch-merged-clades` labels an unnamed clade only if no smaller nameable group
   lies below it and the label has two or three parts. Once a clade is labelled, later runs on the
   same file leave it alone. Most shipped labels were written before the augment grew from 3,615
   to 4,928 nodes on 2026-10-04. A rebuild applies the same test against the larger augment. Run
   against the current augment, 42 of the 49 missing labels fail the test; against the earlier
   augment, 41 of the 49 pass.
2. Live lookups. Build steps 1 to 4 query Open Tree and Wikidata on each run, and the frozen inputs
   do not cover those responses. All 18 species with a different name received it through the P1843
   lookup. `build-names` takes the first name returned and does not sort them, so a difference can
   come from an edit on Wikidata or from result order.
3. One `sepRank` difference (Ascaridida) arises because `patch-seprank-homonyms` found a value it
   did not expect and skipped the entry.

The remaining `sepRank`, `cladeViews`, `wikiTitle` and clade `common` differences have not been
traced individually.

Joined labels are the names of Kinship groups, so a rebuild should be compared with the existing
tree before it replaces it.

## Stages

### A. Selection

These stages query external services and can be resumed. They are needed only to change the
species selection.

| Step | Script | Output |
|------|--------|--------|
| Families | None in this repository. The file came from a one-off query of families with English Wikipedia articles, and the release is its only source. | `sel-families.json` |
| Classification | `classify-families-otl.mjs`, then `classify-names.mjs`. Kingdom and phylum per family, from Open Tree. | `sel-classify-otl.json` |
| Family set | `build-family-set.mjs`. Animal and plant families. | `sel-familyset.json` |
| Species | `pull-species.mjs`. Species per family, with Wikipedia title, sitelink count, GBIF key and genus. Removes duplicates and fossils. | `sel-familyspecies.json` |
| Pageviews | `pull-pageviews.mjs`. Views for species, genera and families. | `sel-pool-pageviews.json` |
| Repair | `fix-pageviews.mjs`. Refetches titles recorded with zero views. Only needed after a faulty pull. | updates the above |

### B. Candidate pool and base set

| Step | Script | Notes |
|------|--------|-------|
| Pool | `build-pool.mjs` | Minimum views `POOL_MIN` (default 500). Merges titles that redirect to one article, removes fossils and non-species. Writes `sel-pool.json`, `sel-redirects.json`. |
| Extras | `inject-extras.mjs` | Adds common species whose Wikipedia article is on a non-taxon Wikidata item, such as cat and horse (`curated-extras.mjs`). Run after the pool and before topology. |
| Topology | `pull-topology.mjs` | Matches the pool to OTT ids and requests the induced subtree from Open Tree. Writes `sel-topology.json`. |
| Base set | `build-inset.mjs` | Minimum views `INSET_FLOOR` (default 1500) and the genus and family caps. Writes `sel-inset.json`. |

### C. Build chain

`npm run build:taxonomy` runs these steps in order.

| # | Script | Queries | Function |
|---|--------|---------|----------|
| 1 | `assemble-taxonomy.mjs` | Open Tree | Prunes the tree to the base set, assigns clade ranks, adds genus, family and parent-taxon names to unlabelled nodes. |
| 2 | `build-names.mjs` | Wikidata | Species: Wikipedia title, otherwise P1843. Clades: P1843. Entries in `common-name-overrides.mjs` take precedence. |
| 3 | `finalize-taxonomy.mjs` | Open Tree | Writes `taxonomy.json` with provenance and scopes. |
| 4 | `patch-wiki-titles.mjs` | Wikidata | Sets the Wikipedia article for clades, matched on OTT id. |
| 5 | `patch-clade-views.mjs` | | Copies pageviews onto clades, matched on scientific name. |
| 6 | `patch-merged-clades.mjs` | | Labels small unnamed clades by joining the names of their parts. |
| 7 | `patch-junction-splits.mjs` | | Adds named sub-clades at unnamed junctions, from `sel-junction-splits.json`. |
| 8 | `patch-drop-excluded.mjs` | | Removes entries in `exclude-taxa.mjs`. |
| 9 | `patch-extinct.mjs` | | Flags species listed in `extinct-taxa.json`. |
| 10 | `patch-ott-names.mjs` | | Names a clade from `ott-lineages.json` when its species are exactly the members of an OTT taxon. |
| 11 | `patch-mdd-names.mjs` | | The same test for mammals, from `mdd-ranks.json`. |
| 12 | `patch-col-names.mjs` | | The same test for other groups, from `col-ranks.json`. |
| 13 | `patch-inverted-ranks.mjs` | | Removes a `sepRank` that is broader than a rank above it. |
| 14 | `patch-clade-common.mjs` | | Adds English names to clades that have only a Latin name, from `clade-names.json`. |
| 15 | `patch-photo-flags.mjs` | | Sets `photo` on species with a photograph in `speciesPhotos.json`. |
| 16 | `stamp-snapshot.mjs` | | Records counts and the data date. |
| 17 | `check-taxonomy-ranks.mjs` | Wikidata | Checks injected ranks. Reports only. |

Not in the chain: `patch-seprank-homonyms.mjs`, and `patch-order-sepranks.mjs`, which applies the
`--rank-orders` logic to an existing tree.

### D. Committed source snapshots

The chain reads these files without network access. A pull script needs to be run only to update
its source.

| Script | Snapshot | Source |
|--------|----------|--------|
| `pull-ott-lineages.mjs` | `scripts/ott-lineages.json` | Open Tree Taxonomy |
| `pull-mdd.mjs` | `scripts/mdd-ranks.json` | Mammal Diversity Database, at a pinned commit |
| `pull-col.mjs` | `scripts/col-ranks.json` | Catalogue of Life, through ChecklistBank |
| `pull-clade-names.mjs` | `scripts/clade-names.json` | Wikipedia and Wikidata. Requires the `WIKIMEDIA_CONTACT` environment variable. |
| `pull-extinct.mjs` | `scripts/extinct-taxa.json` | Wikidata |
| `pull-inat-photos.mjs` | `src/data/speciesPhotos.json` | iNaturalist |

These scripts write caches that are included in the release: `pull-junction-splits.mjs`,
`resolve-family-orders.mjs`, `pull-family-anchors.mjs`, `pull-genus-anchors.mjs`,
`pull-pool-names.mjs`.

### E. Augment

The build chain reads the committed `taxonomyAugment.json` and does not regenerate it. To
regenerate it, run `build-augment.mjs`, then `patch-clade-views.mjs`, since the augment also
carries `cladeViews`.

The augment exists because the base set allows at most 3 species per genus and a Kinship group
needs 4. Species are attached to existing base nodes, so the two files cannot assign different ids
to one clade. Two rules apply:

- No new genus node is created for a genus that already has species in the base tree. Some genera
  are not monophyletic in the topology (*Bison* falls inside *Bos*), so the base tree has no node
  for them, and their remaining species are attached where their relatives are.
- No new node is created with a name already present in the base tree.

### F. Guess index

`npm run build:guessindex` runs `build-taxon-index.mjs`. Lineages are computed from the pool
topology. It requires `node --max-old-space-size=8192`.

## Design notes

Species ids are GBIF keys because Open Tree sometimes uses one OTT id for both a clade and a tip.
With OTT ids, those species would collide with clade nodes. Clades use OTT ids.

Open Tree labels an internal node only if it corresponds to a taxon in its taxonomy, so after
pruning many internal nodes have no name. Assemble adds genus, family and parent-taxon names, under
two conditions: every leaf below the node belongs to that taxon, and no other node already has the
name. The second condition is needed because Open Tree can split a family across separate branches.

Kinship measures the separation of two groups by the rank of their most recent common ancestor. An
unranked stretch of tree therefore reads as distant even when the groups are close. This affected
plants most, and it is the reason parent-taxon names are added.

Ranks added by assemble are stored in `sepRank`, while `rank` remains `clade`. Lineage's
`nearestAncestorOfRank` stops at the first ancestor ranked above its target. If injected ranks were
stored in `rank`, the search could fail for species whose family node was injected, which would
change the win condition of puzzles already frozen. `separationTierOf` reads `sepRank ?? rank`.

`wikiTitle` is needed because names of genera and higher taxa are not unique on Wikipedia: "Linaria"
is both a finch and a toadflax, and "Glycine" is also an amino acid.

`cladeViews` is needed because Kinship would otherwise rate a group only by the pageviews of its
species, which underrates groups mainly known by the group name, such as clownfish.

## Open items

- Make rebuilds exact at the next change of the species set, when the tree is rebuilt and the
  puzzles frozen again anyway: store the responses of build steps 1 to 4, sort P1843 names, and
  store the joined labels.
- Many internal nodes of group size have no name, so Kinship cannot use them. Naming them needs
  classification data below family level that the current sources do not provide for every group.
- `build-augment.mjs` requires a two-part species name, so hybrids such as the garden strawberry
  are excluded.
- `migrate-augment-ids.mjs` is no longer needed and can be deleted.
