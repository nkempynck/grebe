# Grebe

A daily *guess-the-organism* game played on the tree of life — the Metazooa idea,
but with user-chosen **scope** (root the tree wherever you like) and **resolution**
(how close counts as a win), and reaching past animals into fungi, plants, and beyond.

Every miss tells you the shared ancestor you branched apart at, and a warmth score
that's **rescaled to your scope** so hints stay meaningful even in narrow modes.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typechecks + production build
npm run typecheck  # types only
```

Node 18+ recommended.

## The one idea to keep in mind

The whole game is a **pure function over a tree**. That logic lives in `src/core/`
and imports *nothing* from React or the DOM. Everything else is replaceable around it.

```
src/
  core/            ← PORTABLE ENGINE. No React, no DOM. Keep it that way.
    types.ts         shared shapes (TaxonNode, GameConfig, GuessResult)
    tree.ts          build/index the tree; ancestry, MRCA, descendants, distance
    game.ts          evaluateGuess + scope-relative warmth + win logic
    daily.ts         deterministic daily pick (seeded by date + scope)
    resolve.ts       typed-name → node (add the synonym table here later)
    index.ts         public barrel — UI imports from "../core" only
  data/
    taxonomy.seed.ts curated seed tree + scope/resolution presets
    loadTaxonomy.ts  the ONE place the tree comes from (swap for a real source)
    wikipedia.ts     CORS-friendly Wikipedia summary + article links
  hooks/
    useGame.ts       the only file that couples the engine to React state
  ui/                presentational components (the swappable layer)
```

**Why this shape matters for going native:** when you move to Expo / React Native,
`core/` and `data/` come across untouched. You rewrite `ui/` and `useGame.ts` against
native components, and the hard part — the tree math — never changes. If you want to
be strict about it, lift `core/` into its own workspace package (`packages/engine`)
and have both the web app and the native app depend on it. The seam is already in the
right place; extraction is a move, not a rewrite.

## How the two knobs actually work

They look like difficulty sliders. They're really coordinates on the tree:

- **Scope** = *where the tree is rooted.* "Birds only" sets the root to `Aves`.
  Set in `SCOPE_PRESETS` (in `taxonomy.seed.ts`).
- **Resolution** = *how far down the leaves a win has to land.* `winWithin: 0` means
  exact species; `1` means same genus counts; and so on — measured in edges from the
  answer leaf up to the shared ancestor. Set in `RESOLUTION_PRESETS`.

The non-obvious part, handled in `game.ts`: **narrowing scope flattens the hint signal.**
In birds-only, every guess already shares `Aves`, so a global warmth score would read
"all hot" and feel dead. Warmth is therefore rescaled to the scope root — sharing only
the scope root reads as coldest (0), an exact hit reads as 1. (Verified: raven vs penguin
is warmth 0.78 in animals-scope but 0.00 in birds-scope.)

## Design tensions you'll want to decide on

- **Shared vs personal daily.** `daily.ts` seeds on `date + scope`, so each scope has
  its own puzzle — a *personal* daily. A single shared "everyone solves the same thing"
  leaderboard only works if you lock the scope. Change one line (drop scope from the
  seed) when you decide.
- **The synonym layer is the expensive content.** `resolve.ts` currently matches exact
  common/scientific names. Real play needs "orca" = "killer whale", "mallard" =
  *Anas platyrhynchos*, and typo tolerance. Build that as **data**, not code, so it can
  grow on its own. It'll be the biggest content cost in the app.
- **Folk categories aren't clades.** "Fish", "reptiles", "bugs" aren't monophyletic. A
  "reptiles" scope that quietly refuses to include birds is a *feature* for your audience
  — a joke that teaches. Decide per-scope whether you obey cladistics or folk intuition.

## Swapping the seed for a real dataset

`taxonomy.seed.ts` is ~40 curated organisms with deliberate convergence traps
(shark vs dolphin, sugar glider vs flying squirrel). To scale up, keep the exact same
node shape and change only `loadTaxonomy.ts`:

- **Open Tree of Life** — true evolutionary topology (best for honest MRCA hints).
- **GBIF backbone / NCBI Taxonomy** — clean nested hierarchies (easier, not strictly
  phylogenetic).

Raw dumps have 1M+ species, ~90% obscure beetles. Curate down to organisms people can
actually recognise, or the game is unwinnable. That curation is the real work.

## Wikipedia

`wikipedia.ts` hits the CORS-enabled REST summary endpoint for a blurb + thumbnail on the
reveal card, and always has a working article link as a fallback. Add a `wikiTitle` on a
node when the auto-derived title is wrong or ambiguous.

## Suggested next steps

- Autocomplete beyond the native `<datalist>` (fuzzy, keyboard-navigable).
- A drawn cladogram on the reveal that highlights the path your guesses carved.
- Share-a-result grid (emoji temperature squares) for the daily.
- The feral-Attenborough narrator reacting to each guess.
- Persisted state / streaks (localStorage on web; async storage on native).
