# Taxonomy data pipeline

Grebe's tree is built **Wikipedia-first**: species SELECTION by English-Wikipedia
pageviews, TOPOLOGY from Open Tree of Life, NAMES from Wikipedia titles + Wikidata
P1843. GBIF supplies only the species node-id (a stable key). Two products:

- **In-set** → `src/data/taxonomy.json` (baked, browser): ~3,800 recognizable species,
  capped (3/genus + prominence-scaled per-family) — Lineage's answer pool + the tree.
- **Out-of-set** → `public.taxon_index` (Supabase DB): ~21k guessable taxa (species +
  clade groups) with graft lineages + pageviews — guess coverage; Kinship/Branches depth.

All intermediate data caches live in `node_modules/.cache/sel-*.json` (resumable).

## A. Selection & pull  (network-heavy; caches resume)
| step | script | writes |
|------|--------|--------|
| families    | *(one-off, cached)* — all enwiki families + sitelinks + parent | `sel-families.json` |
| classify    | `classify-families-otl.mjs` then `classify-names.mjs` — kingdom/phylum per family from **OTL** | `sel-classify-otl.json` |
| family set  | `build-family-set.mjs` — animals+plants: current-data families + ALL prominent classified families | `sel-familyset.json` |
| species     | `pull-species.mjs` — per-family species (enwiki, sitelinks, gbif, genus); dedup QID, drop fossils | `sel-familyspecies.json` |
| pageviews   | `pull-pageviews.mjs` — ~60-day views for species+genera+families (drains the `continue` token!) | `sel-pool-pageviews.json` |
| *(repair)*  | `fix-pageviews.mjs` — re-fetch any zero-valued titles with continue-drain (only if pulled by an older buggy run) | patches the above |

Run the long ones under `caffeinate -i` (Mac won't sleep). Logs: `/tmp/grebe-*.log`.

## B. Pool → in-set + out-of-set
| step | script | notes |
|------|--------|-------|
| pool    | `build-pool.mjs` | `POOL_MIN` (default 500) view filter → dedup synonyms by redirect-resolved article → clean junk/fossils → `sel-pool.json` |
| extras  | `inject-extras.mjs` | add curated icons the pull can't reach (article on a non-taxon item: cat, horse, coconut…) from `curated-extras.mjs`. **Run after build-pool, before topology.** |
| topology| `pull-topology.mjs` | TNRS pool → OTT ids, OTL induced_subtree → `sel-topology.json` |
| in-set  | `build-inset.mjs` | `INSET_FLOOR` (default 1500) + cap 3/genus + prominence-scaled family cap → `sel-inset.json` |
| assemble| `assemble-taxonomy.mjs` | prune tree to in-set tips → nodes; rank clades; inject genus, family and parent-taxon names → `sel-nodes.json` |
| names   | `build-names.mjs` | species = Wikipedia title else Wikidata P1843; clades = P1843; `common-name-overrides.mjs` win → `sel-nodes-named.json` |
| finalize| `finalize-taxonomy.mjs` | write `src/data/taxonomy.json` + provenance (OTL synth + Wikidata date) + scopes |
| wiki titles | `patch-wiki-titles.mjs` | clade `wikiTitle` from Wikidata (P9157 → enwiki article), keyed on the OTT id so homonyms can't collide. Patches `src/data/taxonomy.json` in place |
| clade views | `patch-clade-views.mjs` | clade `cladeViews` from `sel-pool-pageviews.json`, joined on sciName. A JOIN, no network. Patches BOTH `taxonomy.json` and `taxonomyAugment.json` |
| out-of-set | `build-taxon-index.mjs` | pool taxa NOT in in-set → `src/data/guessIndex.generated.json` (graft lineage from topology, + views). Needs `node --max-old-space-size=8192` |

`npm run build:taxonomy` chains assemble→names→finalize. `npm run build:guessindex` = build-taxon-index.

**Re-run `patch-wiki-titles.mjs` AND `patch-clade-views.mjs` after any finalize** — both
write fields finalize doesn't know about, so a rebuild drops them.

Without wiki titles, clades fetch Wikipedia by bare Latin name, and uninomial names aren't
unique: "Linaria" the finch loses to Linaria the toadflax, "Acer" to Acer Inc., "Glycine"
to the amino acid.

Without clade views, Kinship rates a group only by the median pageviews of the four SPECIES
it shows, which underrates any group whose fame lives in the group: clownfish (Amphiprion)
score 1030 against their own article's 34410, octopus 1319 against 141386. ~85 recognisable
groups silently drop below `MIN_BOARD_FAME` and stop appearing on boards. It patches the
augment too, because Amphiprion and Octopus are `auggen_*` nodes.

**Species node-id = GBIF key is load-bearing:** OTL reuses some ott ids for both a clade
AND a tip, so keying species by ott collides with clade nodes and drops them. GBIF keys
give species a separate id namespace. Clade ids = OTT.

## C. Ship to DB  (needs the service-role key — NOT in .env.local by design)
1. Apply schema: run `supabase/taxon_index.sql` in the Supabase SQL editor (adds `views`, prominence-ranked search). **First.**
2. Back up: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backup-taxon-index.mjs`
3. Load:    `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/load-guess-index.mjs --replace`

## D. Freeze dailies
`npm run pin` (needs Supabase env) — regenerate frozen daily puzzles for the new tree.

### Injected names (assemble steps 3-5)

OTL labels an internal node only when that node IS a taxon in its taxonomy, so after pruning
to our tips most internal nodes arrive anonymous and the name CANNOT be looked up by id.
Three steps name them from what sits underneath, each strictly: a name is injected only if
every leaf under the node belongs to it, and only if **no other node already carries that
name** — OTL can split a family across our tips (its `Caprimulgidae` holds 16 of our
nightjars, a disjoint branch holds 9 more), and without that guard both get named, which
lands on a Kinship board as two groups with the identical label.

Step 5 (parent taxa, from `sel-families.json`'s Wikidata P171 parent) exists for SEPARATION.
Kinship reads difficulty off the RANK of the MRCA between two groups, so an unranked stretch
of tree reads as "trivially separable" however close the groups are — and that is not spread
evenly: only 4% of plant group-pairs had a ranked MRCA against 29-40% elsewhere, because
nine of the twenty major plant orders were missing from the tree entirely. Four Asparagales
families then read as far apart as a bird and a beetle.

**The rank from step 4/5 lands in `sepRank`, never in `rank`.** Lineage's
`nearestAncestorOfRank` stops at the first ancestor ranked ABOVE the one it wants, so a real
"family"/"order" here would make the search for a species' family fail wherever that family
crown is one of our injected clades — silently tightening the win target on days already
pinned. `separationTierOf` reads `sepRank ?? rank`; nothing else looks at it.

## Kept utilities
`common-name-overrides.mjs` (build-names), `curated-extras.mjs` (inject-extras),
`patch-wiki-titles.mjs` + `patch-clade-views.mjs` (both post-finalize),
`load-guess-index.mjs`, `backup-taxon-index.mjs`, `pin-puzzles.ts`, `preview-*.ts`.

## One-time migrations
`migrate-augment-ids.mjs` — re-points `taxonomyAugment.json` at the corrected clade ids
after the `parseLabel` mrca fix (an `mrcaottAottB` label used to be parsed down to its
TRAILING ott number, handing the node an id belonging to an unrelated taxon). Idempotent,
refuses to write on any ambiguity. **Delete it once the augment is rebuilt** — see TODO.

## Retired (removed — old GBIF-occurrence pipeline)
build-taxonomy.mjs, build-guess-index.mjs, enrich-wiki.mjs, build-augment.mjs,
patch-common-names.mjs, patch-prominence.mjs, and the exploration probes
(build-select, classify-families [Wikidata], calibrate-*, proto-wiki-select,
bench-wikidata-names).

## TODO (not yet done)
- Kinship/Branches depth: the current `taxonomyAugment.json` is the OLD GBIF-era augment;
  rebuild it (or its replacement) from the new pool so Kinship/Branches get genus depth.
  It supplies 43% of the species Kinship shows but only ~11% of the groups, so this is the
  largest remaining variety lever. Rebuilding it also retires `migrate-augment-ids.mjs`.
- Wire Amphibians + Reptiles (new scopes) into leaderboards/badges.
