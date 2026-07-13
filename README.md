# Grebe

Grebe is a platform of daily puzzle games played on the **tree of life** — the
shared-ancestry tree that connects every living thing. Each game is new every day and the
same for all players. Two games ship today:

- **Lineage** — guess the hidden organism; every wrong guess is placed on a shared-ancestry
  tree at the clade it has in common with the answer, so each miss narrows down where the
  answer sits. Inspired by [Metazooa](https://metazooa.com).
- **Kinship** — sixteen species, four hidden groups of four, each group a real clade; sort
  them before four mistakes run out. A daily grid in the spirit of the New York Times'
  [Connections](https://www.nytimes.com/games/connections).

Both run on one bundled taxonomy snapshot (GBIF × Open Tree of Life). An optional Supabase
backend adds accounts, cross-device sync, and leaderboards; without it the whole thing runs
in the browser.

## Games

### Lineage

The player names organisms; each wrong guess is placed on the tree at the clade it shares
with the hidden answer. Two controls are coordinates on the tree rather than difficulty dials:

- **Scope** is where the tree is rooted (e.g. "Birds" roots it at `Aves`) — not only animals,
  but also fungi, plants, or all of life.
- **Resolution** is how close a guess must land to count as a win. It indexes a rank ladder
  (`0` = exact species, `1` = same genus, `2` = family, `3` = order).

Alongside the shared-ancestry feedback, each guess carries a warmth score rescaled to the
current scope, so the signal stays meaningful even in narrow modes (in a birds-only game every
guess already shares `Aves`, which a global score would read as uniformly "hot"). There is a
shared daily with a leaderboard, plus free play for practice.

### Kinship

A 4×4 grid of sixteen species split into four hidden groups of four; each group is a real,
recognisable clade ("Owls", "Sandpipers"). Pick four tiles you think share a group and guess;
a correct group locks in and its clade name is revealed, a wrong one costs one of four
mistakes.

Difficulty is not the breadth of each group (groups are always tight and recognisable) — it is
the **separation** between the four groups, and it ramps by weekday in lock-step with Lineage's
difficulty tier. An easy board draws its four groups from far-apart branches (a frog, a fern, a
beetle, a crab); a hard board draws four sibling clades that all look alike (four kinds of
perch). Within a board the yellow→purple colour ranks the groups by how confusable they are —
the two clades sitting closest together on the tree get the hard colours, the "trap" pair.
The board is deterministic per date, and Kinship has its own ranked daily leaderboard (scored
by difficulty and mistakes).

## Stack

React 18 + TypeScript, built with Vite. Three runtime dependencies (`react`, `react-dom`,
`@supabase/supabase-js`). The backend is optional; without it the games run entirely in the
browser.

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build
npm run typecheck  # types only
npm test           # vitest unit tests
```

Node 18+. The app runs fully offline out of the box: the taxonomy is bundled and every daily
is computed client-side, so no network is required to play.

## Architecture

The game logic is a set of pure functions over a tree. It lives in `src/core/` and imports
nothing from React or the DOM; everything else is arranged around it.

```
src/
  core/              portable engine — no React, no DOM
    types.ts         shared shapes (TaxonNode, GameConfig, GuessResult)
    tree.ts          build/index the tree; ancestry, MRCA, descendants, distance
    game.ts          evaluateGuess + scope-relative warmth + rank-ladder win logic
    daily.ts         deterministic daily pick (seeded by date + scope) + puzzle number
    solver.ts        informed "par" solver for Lineage
    grid.ts          Kinship board generator (pure, deterministic per date + tier)
    resolve.ts       typed name -> node
    index.ts         public barrel — UI imports from "../core" only
  data/
    taxonomy.json    the bundled tree (built by scripts/build-taxonomy.mjs)
    loadTaxonomy.ts  the single source of the tree
    presets.ts       scope + resolution presets
    dailySchedule.ts weekday difficulty ramp + per-day seeded recipe pool (Lineage)
    clades.ts        clade groupings for per-group stats/leaderboards
    cladeNames.ts    friendly common names for clades (group guesses + Kinship labels)
    score.ts         difficulty-weighted points (mirrors the SQL scoring)
    stats.ts         local stats model (streaks, points, per-clade tallies)
    gridDaily.ts     today's Kinship board (tier from the weekday ramp)
    gridProgress.ts  per-day Kinship attempt persistence
    games.ts         Supabase RPCs: submit_game, leaderboard, standing, player_badges
    wikipedia.ts     Wikipedia summary + article links for the reveal card
  hooks/
    useGame.ts       couples the Lineage engine to React state
    useGridGame.ts   couples the Kinship board to React state
    useStats.ts      local + cloud stats sync
    usePlayer.ts     auth session, display name, admin flag
  ui/                presentational components (HomePanel, GridGame, Cladogram, …)
```

Because `core/` and `data/` have no UI dependencies, they are portable to a native
(React Native / Expo) shell; only `ui/` and the hooks are web-specific.

## Daily puzzles

`dailySchedule.ts` turns a date into a puzzle deterministically, so every player gets the same
puzzle without a server round-trip:

- The **weekday** sets a difficulty tier (Monday gentlest, Sunday hardest). The tier is also
  the leaderboard's point weight, so it is fixed to the weekday. Kinship reuses this tier for
  its board's group-separation, so both games get harder across the week together.
- A **per-day seed** draws the specifics (Lineage's scope + resolution + assist; Kinship's
  container and groups) from that day's options, so each puzzle is unpredictable but
  reproducible from the date.
- `daily.ts` selects Lineage's answer by hashing `date + scope` into the scope's leaves.

Because this is seeded rather than truly random, each puzzle is a pure function of the date and
is fully reproducible (and, with the source public, computable in advance). A curator can
override any Lineage day through the admin panel (`#admin`).

## Taxonomy

`src/data/taxonomy.json` is generated by `scripts/build-taxonomy.mjs` from two sources:

- **[GBIF](https://www.gbif.org) backbone** — the species list and nested hierarchy (common
  names, ranks), selected per group by number of occurrence records.
- **[Open Tree of Life](https://tree.opentreeoflife.org)** — the induced topology used for the
  shared-ancestry hints (branching structure, named clades, ranks).

The snapshot holds roughly 1,700 recognisable species across about 5,000 nodes. The underlying
dumps contain over a million species, most of them obscure; curating down to organisms people
can recognise is the bulk of the content work. Regenerating the JSON is the only step that
touches the network.

## Backend (optional)

With no Supabase environment variables set, the app is fully local (bundled daily plan plus
`localStorage`). Setting `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`)
enables accounts, cross-device sync, and the Lineage leaderboard. The anon key is public by
design; row-level security in the database is what protects writes.

- **Scores are computed server-side.** Clients call the `submit_game()` RPC, which pins the
  difficulty tier from the date and derives guess/hint counts from the submitted id arrays;
  direct table inserts are denied by RLS. Only daily games are stored server-side.
- The schema lives in `supabase/schema.sql` (kept out of the repository; run once in the
  Supabase SQL editor). The admin panel includes a live schema self-check.
- Kinship adds its own table and RPCs in `supabase/kinship.sql` (run once, after `schema.sql`):
  a `grid_games` table plus server-scored `submit_grid_game()`, `grid_leaderboard()`, and
  `grid_leaderboard_standing()`. Verify with `select public.grid_schema_check();`.

Player stats for both games sync through the single `player_stats` blob; only the leaderboards
use per-game tables.

## Scoring

Both games share a difficulty weight — the day's tier, `40 + 20 × tier` — so scores are
comparable across the week.

**Lineage:** `weight × efficiency × hint-factor`, zero for a loss; efficiency decays gently
with guess count and the hint factor drops with an escalating penalty per hint. Client
`gamePoints` (`src/data/score.ts`) must stay identical to `game_points` (`supabase/schema.sql`).

**Kinship:** `weight × (1 − mistakes/4)`, zero for a loss — a clean board earns the full weight,
each mistake shaves a quarter. Client `kinshipPoints` (`src/data/score.ts`) mirrors
`grid_game_points` (`supabase/kinship.sql`).

Both are pinned by golden-value unit tests to catch client/SQL drift.

## Limitations

- **Name matching is exact.** `resolve.ts` matches a guess against exact common or scientific
  names (any clade is guessable by either); there is no synonym table or typo tolerance, so
  "orca" does not resolve to "killer whale". A data-driven synonym layer is the largest gap.
- **Folk categories are not clades.** "Fish", "reptiles", and "bugs" are not monophyletic;
  where a scope follows folk intuition rather than strict cladistics that is a deliberate
  simplification.
- **Leaderboard integrity is casual.** `won` cannot be verified server-side (the tree is
  client-only), so the board is effectively self-reported, capped at one daily per player per
  day.
- **Kinship difficulty tracks tree-clustering**, which is a proxy for perceived hardness rather
  than a measure of it — a mid-week board can land on an unusually tricky group.
- **Accounts have no email**, so a forgotten password cannot be recovered.

## Testing

`npm test` runs the Vitest suite: a scoring golden-table (guarding client/SQL parity), daily
determinism, the Lineage win-rank ladder and solver-par bounds, streak logic, and the Kinship
board generator (structure, determinism, difficulty ordering, one-away detection).

## References

- **[Metazooa](https://metazooa.com)** (and its plant counterpart Metaflora) — the daily
  animal-guessing game that inspired **Lineage**.
- **[Connections](https://www.nytimes.com/games/connections)** (The New York Times) — the
  grouping game that inspired **Kinship**.
- **[GBIF](https://www.gbif.org)** — Global Biodiversity Information Facility; species list,
  common names, and ranks.
- **[Open Tree of Life](https://tree.opentreeoflife.org)** — synthetic phylogeny; the branching
  topology behind the shared-ancestry hints.
- **[Wikipedia](https://www.wikipedia.org)** — summary and thumbnail on the reveal card (the
  only third-party request during normal play).
