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
| assemble| `assemble-taxonomy.mjs` | prune tree to in-set tips → nodes; rank clades; inject genus, family and parent-taxon names → `sel-nodes.json`. `--rank-orders` additionally stamps order `sepRank` (off by default: changes difficulty, see below) |
| names   | `build-names.mjs` | species = Wikipedia title else Wikidata P1843; clades = P1843; `common-name-overrides.mjs` win → `sel-nodes-named.json` |
| finalize| `finalize-taxonomy.mjs` | write `src/data/taxonomy.json` + provenance (OTL synth + Wikidata date) + scopes |
| wiki titles | `patch-wiki-titles.mjs` | clade `wikiTitle` from Wikidata (P9157 → enwiki article), keyed on the OTT id so homonyms can't collide. Patches `src/data/taxonomy.json` in place |
| clade views | `patch-clade-views.mjs` | clade `cladeViews` from `sel-pool-pageviews.json`, joined on sciName. A JOIN, no network. Patches BOTH `taxonomy.json` and `taxonomyAugment.json` |
| merged clades | `patch-merged-clades.mjs` | names ~140 anonymous clades whose children are each too small to be a group, by joining them ("Vicugna & Lama"). Only where nothing below is ALREADY a group, so a name adds a group and costs none. No network |
| out-of-set | `build-taxon-index.mjs` | pool taxa NOT in in-set → `src/data/guessIndex.generated.json` (graft lineage from topology, + views). Needs `node --max-old-space-size=8192` |

`npm run build:taxonomy` chains assemble→names→finalize→**wiki-titles→clade-views→merged-clades**.
`npm run build:guessindex` = build-taxon-index.

The three patches are IN the chain because all three write fields finalize doesn't know
about, so a rebuild that stops at finalize drops them — losing the merged-clade names alone
costs ~24 distinct Kinship groups a year. Leaving them as a documented manual step did not
work: a rebuild on 2026-08-16 dropped 1119 common names and 140 clade labels.

**A rebuild is verified reproducible** (2026-08-17, full chain against the shipped tree):
0 id drift, and rank / parentId / sepRank / cladeViews / views identical on all 10850 nodes.
Named counts land exactly (3332 species, 790 clades). The residue is upstream drift, not
loss: 9 species where Wikidata now prefers a different vernacular, 1 wikiTitle, and 2 merged
labels. **Diff before accepting any rebuild** — those merged labels are Kinship group names,
so losing one silently removes a group.

Two traps that made an earlier rebuild destructive, both now fixed:
- `build-names.mjs` built its Latin-synonym test from the 3.8k in-set instead of the 18k
  pool, and only applied it to Wikipedia titles. Both halves matter — the test needs the
  first word to be a known genus AND the second a known epithet, so the narrow list simply
  failed to recognise a synonym.
- assemble's order-`sepRank` step is a DIFFICULTY change, so it is now off unless you pass
  `--rank-orders`. The shipped tree carries 164 `sepRank` nodes; that step takes it to 218.

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
`patch-wiki-titles.mjs` + `patch-clade-views.mjs` + `patch-merged-clades.mjs` (all post-finalize),
`load-guess-index.mjs`, `backup-taxon-index.mjs`, `pin-puzzles.ts`, `preview-*.ts`.

## One-time migrations
`migrate-augment-ids.mjs` — re-points `taxonomyAugment.json` at the corrected clade ids
after the `parseLabel` mrca fix (an `mrcaottAottB` label used to be parsed down to its
TRAILING ott number, handing the node an id belonging to an unrelated taxon). Idempotent,
refuses to write on any ambiguity. **Delete it once the augment is rebuilt** — see TODO.

## Retired (removed — old GBIF-occurrence pipeline)
build-taxonomy.mjs, build-guess-index.mjs, enrich-wiki.mjs,
patch-common-names.mjs, patch-prominence.mjs, and the exploration probes
(build-select, classify-families [Wikidata], calibrate-*, proto-wiki-select,
bench-wikidata-names).

## E. Kinship/Branches depth — the augment

`build-augment.mjs` (NOT retired) grafts extra named pool species onto the in-set tree so
Kinship and Branches get breadth Lineage's curated set can't give them: the in-set caps each
genus at **3** species and a group needs **4**, so no genus can be a group without it. It
reads `src/data/taxonomy.json` + `sel-pool.json` + `sel-classify-otl.json` +
`sel-family-anchors.json` and writes `src/data/taxonomyAugment.json`. **Re-run
`patch-clade-views.mjs` afterwards** — the augment carries `cladeViews` too.

It GRAFTS onto existing base nodes rather than re-pruning, so base and augment cannot
disagree about a clade's id. Two guards keep it that way:

- **Never mint a genus node for a genus the base tree already holds species of.** Genus
  injection rejects a genus that isn't monophyletic in our topology — *Bison* nests inside
  *Bos*, the sun bear inside *Ursus* — so there is no `Bos` node even though Bos taurus is in
  the tree under Bovinae. Minting `auggen_Bos` for the rest produced a board asking you to
  sort one Bos into "Bovinae" and another into "Bos", and a group that is taxonomically
  false. Those species graft where their relatives already live instead.
- **Never mint a node whose NAME already exists in the base tree.**

Duplicate scientific names across base+augment: 49 before, 5 after.

## TODO (not yet done)
- `migrate-augment-ids.mjs` can be deleted: it existed only to re-point the OLD augment after
  the parseLabel id fix, and the augment is now rebuilt from the current tree.
- Variety: ~334 internal nodes sit at usable group size (4-25 named species) above the fame
  floor with NO name at all, and are therefore invisible to Kinship — a potential +28% on the
  theme pool, spread across every class. They are intermediate branch points with no Linnaean
  name, so naming them needs subfamily/tribe data we don't pull yet. Adding SPECIES is the
  weaker lever by comparison: 2,657 nameable pool species are missing but only ~40 genera
  would cross the four-species line.
- `build-augment.mjs` requires a two-word binomial, so hybrids are dropped — that loses
  Fragaria × ananassa (strawberry, 90k views) and friends.
- Wire Amphibians + Reptiles (new scopes) into leaderboards/badges.
