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
| assemble| `assemble-taxonomy.mjs` | prune tree to in-set tips → nodes; rank clades; inject genus names → `sel-nodes.json` |
| names   | `build-names.mjs` | species = Wikipedia title else Wikidata P1843; clades = P1843; `common-name-overrides.mjs` win → `sel-nodes-named.json` |
| finalize| `finalize-taxonomy.mjs` | write `src/data/taxonomy.json` + provenance (OTL synth + Wikidata date) + scopes |
| out-of-set | `build-taxon-index.mjs` | pool taxa NOT in in-set → `src/data/guessIndex.generated.json` (graft lineage from topology, + views). Needs `node --max-old-space-size=8192` |

`npm run build:taxonomy` chains assemble→names→finalize. `npm run build:guessindex` = build-taxon-index.

**Species node-id = GBIF key is load-bearing:** OTL reuses some ott ids for both a clade
AND a tip, so keying species by ott collides with clade nodes and drops them. GBIF keys
give species a separate id namespace. Clade ids = OTT.

## C. Ship to DB  (needs the service-role key — NOT in .env.local by design)
1. Apply schema: run `supabase/taxon_index.sql` in the Supabase SQL editor (adds `views`, prominence-ranked search). **First.**
2. Back up: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backup-taxon-index.mjs`
3. Load:    `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/load-guess-index.mjs --replace`

## D. Freeze dailies
`npm run pin` (needs Supabase env) — regenerate frozen daily puzzles for the new tree.

## Kept utilities
`common-name-overrides.mjs` (build-names), `curated-extras.mjs` (inject-extras),
`load-guess-index.mjs`, `backup-taxon-index.mjs`, `pin-puzzles.ts`, `preview-*.ts`.

## Retired (removed — old GBIF-occurrence pipeline)
build-taxonomy.mjs, build-guess-index.mjs, enrich-wiki.mjs, build-augment.mjs,
patch-common-names.mjs, patch-prominence.mjs, and the exploration probes
(build-select, classify-families [Wikidata], calibrate-*, proto-wiki-select,
bench-wikidata-names).

## TODO (not yet done)
- Kinship/Branches depth: the current `taxonomyAugment.json` is the OLD GBIF-era augment;
  rebuild it (or its replacement) from the new pool so Kinship/Branches get genus depth.
- Wire Amphibians + Reptiles (new scopes) into leaderboards/badges.
