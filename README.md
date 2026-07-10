# Grebe

A daily *guess-the-organism* game played on the tree of life — the Metazooa idea,
but with user-chosen **scope** (root the tree wherever you like) and **resolution**
(how close counts as a win), reaching past animals into fungi, plants, and beyond.

Every miss tells you the shared ancestor you branched apart at, plus a warmth score
that's **rescaled to your scope** so hints stay meaningful even in narrow modes.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typechecks + production build
npm run typecheck  # types only
```

Node 18+ recommended. The app runs fully **offline** out of the box — the taxonomy is
bundled and the daily is computed client-side. The backend (accounts + leaderboard) is
optional; see [Backend](#backend-optional).

## The one idea to keep in mind

The whole game is a **pure function over a tree**. That logic lives in `src/core/`
and imports *nothing* from React or the DOM. Everything else is replaceable around it.

```
src/
  core/            ← PORTABLE ENGINE. No React, no DOM. Keep it that way.
    types.ts         shared shapes (TaxonNode, GameConfig, GuessResult)
    tree.ts          build/index the tree; ancestry, MRCA, descendants, distance
    game.ts          evaluateGuess + scope-relative warmth + rank-ladder win logic
    daily.ts         deterministic daily pick (seeded by date + scope) + puzzle number
    solver.ts        informed "par" solver — plays the puzzle from the same feedback
    resolve.ts       typed-name → node
    index.ts         public barrel — UI imports from "../core" only
  data/
    taxonomy.json    the bundled tree (built by scripts/build-taxonomy.mjs)
    loadTaxonomy.ts  the ONE place the tree comes from
    presets.ts       scope + resolution presets (validated against taxonomy.json)
    dailySchedule.ts weekday difficulty ramp + per-day seeded recipe pool
    dailyPlan.ts     curator overrides (committed dailyPlan.json + admin drafts)
    clades.ts        clade groupings used for per-group stats/leaderboards
    score.ts         difficulty-weighted points (mirrors the SQL scoring)
    stats.ts         local stats model (streaks, points, per-clade tallies)
    games.ts         Supabase RPCs: submit_game, leaderboard, standing
    supabase.ts      client (null when env vars are absent → offline mode)
    wikipedia.ts     CORS-friendly Wikipedia summary + article links
  hooks/
    useGame.ts       couples the engine to React state
    useStats.ts      local + cloud stats sync
    usePlayer.ts     auth session, display name, admin flag
  ui/                presentational components (the swappable layer)
```

**Why this shape matters for going native:** moving to Expo / React Native brings
`core/` and `data/` across untouched. You rewrite `ui/` and the hooks against native
components; the hard part — the tree math — never changes.

## How the two knobs work

They look like difficulty sliders. They're really coordinates on the tree:

- **Scope** = *where the tree is rooted.* "Birds" sets the root to `Aves`.
- **Resolution** = *how far down a win has to land.* It's an index into a rank ladder
  (`0` = exact species, `1` = same genus, `2` = family, `3` = order): a guess wins when
  it shares the answer's clade at that rank.

The non-obvious part, in `game.ts`: **narrowing scope flattens the hint signal.** In
birds-only every guess already shares `Aves`, so a global warmth score would read
"all hot." Warmth is therefore rescaled to the scope root — sharing only the scope root
reads coldest (0), an exact hit reads 1.

## Daily puzzles

`dailySchedule.ts` turns a date into a puzzle deterministically, so everyone plays the
same thing without a server:

- **Weekday sets the difficulty tier** (Mon = gentle … Sun = brutal). The tier is also
  the leaderboard's point weight, so it stays locked to the weekday.
- **A per-day seed draws the specific recipe** from that day's pool (scope + resolution +
  assist), so the puzzle is unpredictable but reproducible from the date alone.
- **`daily.ts` picks the answer** by hashing `date + scope` into the scope's leaves.

A curator can override any day (scope, resolution, assist, or a pinned answer) via the
admin panel (`#admin`); `resolveDailyRules` folds the override over the auto-suggestion.

## The taxonomy

`src/data/taxonomy.json` is built by `scripts/build-taxonomy.mjs` from two sources:

- **GBIF backbone** — the species list and clean nested hierarchy (common names, ranks).
- **Open Tree of Life** — the induced topology used for honest MRCA hints.

It currently holds ~1,700 recognisable species across ~5,000 nodes. Raw dumps have 1M+
species (mostly obscure beetles); the curation down to organisms people can actually name
is the real content work. To rebuild, run the script and commit the regenerated JSON.

## Backend (optional)

With no Supabase env vars set, the app is fully local (bundled daily plan + localStorage).
Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (see `.env.example`) to enable
accounts, cross-device sync, and the leaderboard. The anon key is public-safe: **row-level
security** in the database is what protects writes.

- **Leaderboard scores are server-computed.** Clients call the `submit_game()` RPC; the
  server pins the difficulty tier from the date and derives guess/hint counts, so a client
  can't post a fabricated score. Direct table inserts are revoked.
- **Setup lives in `supabase/schema.sql`** (kept out of this repo — run it once in the
  Supabase SQL editor). The admin panel has a live schema self-check.

## Design tensions you may still want to decide on

- **The synonym layer is the expensive content.** `resolve.ts` matches exact
  common/scientific names. Real play wants "orca" = "killer whale", typo tolerance, etc.
  Build it as **data**, not code, so it can grow. Likely the biggest content cost.
- **Folk categories aren't clades.** "Fish", "reptiles", "bugs" aren't monophyletic.
  Whether a scope obeys cladistics or folk intuition is a per-scope call — a "reptiles"
  scope that excludes birds is a *feature* that teaches.

## Suggested next steps

- Fuzzy, synonym-aware guess matching (see the synonym note above).
- Lift `core/` into its own workspace package to share with a future native app.
- Truly-random (server-rolled) daily answers, if seeded determinism ever feels too
  predictable now that the code is public.
- Richer per-clade / past-day leaderboard browsing.
