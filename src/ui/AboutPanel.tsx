import taxonomy from "../data/taxonomy.json";

/** Smoothly scroll a section into view without touching the URL hash (the app
 *  uses the hash for #admin routing, so we avoid polluting it). */
function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const SECTIONS = [
  { id: "about-platform", label: "What Grebe is" },
  { id: "about-games", label: "The games" },
  { id: "about-data", label: "Data sources" },
  { id: "about-build", label: "How it's built" },
  { id: "about-name", label: "The name" },
  { id: "about-privacy", label: "Privacy" },
];

/** What Grebe is, where its data comes from, how it's built, and what it stores.
 *  Data numbers come straight from the built snapshot so they never drift. */
export function AboutPanel() {
  const species = taxonomy.counts?.species ?? 0;
  const nodes = taxonomy.counts?.nodes ?? 0;
  const scopes = taxonomy.scopes?.length ?? 0;
  const built = (taxonomy.generatedAt ?? "").slice(0, 10);

  return (
    <div className="about">
      <nav className="about-toc" aria-label="About sections">
        {SECTIONS.map((s) => (
          <button key={s.id} className="about-toc-link" onClick={() => jump(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>

      {/* ---------- What Grebe is ---------- */}
      <h3 id="about-platform" className="about-h">What Grebe is</h3>
      <p className="about-lede">
        Grebe is a small platform of daily puzzle games, each played on the <b>tree of life</b> —
        the shared-ancestry tree that connects every living thing. Every game is new each day and
        the same for all players.
      </p>
      <p className="about-p">
        Grebe was made purely as a personal project, coming from my interest in evolutionary biology
        and love for daily puzzle games. It is not affiliated with Metazooa, the New York Times, or
        their creators in any way. It is intended for fun and educational purposes, and I hope it
        helps people learn more about the diversity of life on Earth.
      </p>

      {/* ---------- The games ---------- */}
      <h3 id="about-games" className="about-h">The games</h3>
      <div className="about-games">
        <div className="about-game">
          <div className="about-game-hd">
            <span className="about-game-ico" aria-hidden="true">🧬</span>
            <b>Lineage</b>
            <span className="about-game-src">inspired by Metazooa</span>
          </div>
          <p>
            Guess the hidden organism. Every wrong guess lands on the shared-ancestry tree at the
            clade it has in common with the answer, so each guess narrows where the target sits —
            closer guesses branch off lower down. You can re-root the tree to any scope (animals,
            fungi, plants, all of life), pick how close counts as a win (from exact species out to
            same order), and read a drawn cladogram of where each guess split off. It has a shared
            daily with a leaderboard, plus free play. Directly inspired by{" "}
            <a href="https://metazooa.com" target="_blank" rel="noreferrer">Metazooa</a> and its
            plant counterpart Metaflora — check them out!
          </p>
        </div>

        <div className="about-game">
          <div className="about-game-hd">
            <span className="about-game-ico" aria-hidden="true">🧩</span>
            <b>Kinship</b>
            <span className="about-game-src">inspired by Connections</span>
          </div>
          <p>
            Sixteen species, four hidden groups of four — each group a real clade. Sort every
            species into the family it belongs to before four wrong guesses run out; the harder the
            day, the more the groups look alike (four kinds of perch rather than a frog, a fern and a
            beetle). A daily grid in the spirit of the New York Times'{" "}
            <a href="https://www.nytimes.com/games/connections" target="_blank" rel="noreferrer">Connections</a>.
          </p>
        </div>

        <div className="about-game is-soon">
          <div className="about-game-hd">
            <span className="about-game-ico" aria-hidden="true">🌱</span>
            <b>More to come</b>
          </div>
          <p>Further tree-of-life games are in the works.</p>
        </div>
      </div>

      {/* ---------- Data sources ---------- */}
      <h3 id="about-data" className="about-h">Data sources</h3>
      <p className="about-p">
        The species and the tree come from two open biodiversity databases, combined once into a
        static snapshot the game ships with. The app reads that snapshot locally and never touches
        the network while you play.
      </p>
      <div className="about-snap">
        <span><b>{species.toLocaleString()}</b> species</span>
        <span><b>{nodes.toLocaleString()}</b> tree nodes</span>
        <span><b>{scopes}</b> scopes</span>
        <span>snapshot built <b>{built || "—"}</b></span>
      </div>
      <div className="about-srcs">
        <div className="about-src is-teal">
          <div className="about-src-tag">GBIF · species &amp; names</div>
          <p>
            The <a href="https://www.gbif.org" target="_blank" rel="noreferrer">Global
            Biodiversity Information Facility</a> aggregates occurrence records from museums,
            herbaria, and citizen-science platforms (iNaturalist, eBird). It provides the set of
            species, selected per group and ranked by number of occurrence records — along with
            their English common names.
          </p>
        </div>
        <div className="about-src is-brass">
          <div className="about-src-tag">Open Tree of Life · topology</div>
          <p>
            The <a href="https://tree.opentreeoflife.org" target="_blank" rel="noreferrer">Open
            Tree of Life</a> is a synthetic phylogeny assembled from published studies and
            reference taxonomies. It provides the tree connecting those species; the branching
            structure, the named clades (Amniota, Tetrapoda…), and the taxonomic ranks.
          </p>
        </div>
      </div>

      {/* ---------- How it's built ---------- */}
      <h3 id="about-build" className="about-h">How it's built</h3>
      <ol className="about-build">
        <li>
          <b>Select species.</b> GBIF is queried per group (mammals, birds, insects, plants…)
          with a target count per group, filled from the most-recorded species that have a clean
          English common name. A short curated list of extras — humans and lab model organisms —
          is added on top.
        </li>
        <li>
          <b>Resolve to the tree.</b> Each name is matched to its Open Tree identifier, and the
          induced subtree over those identifiers is fetched — the minimal slice of the global
          tree that connects them.
        </li>
        <li>
          <b>Flatten &amp; label.</b> Single-child links are collapsed; named clades and the
          remaining branch points are kept (unnamed ones render as bare junctions); taxonomic
          ranks are attached and checked against each clade's own identifier.
        </li>
        <li>
          <b>Write the snapshot.</b> The result is written to a single JSON file. The network is
          used only during this build step: run <code>npm run build:taxonomy</code> to refresh it.
        </li>
      </ol>

      {/* ---------- The name ---------- */}
      <h3 id="about-name" className="about-h">The name</h3>
      <p className="about-p">
        Grebes are a family of diving waterbirds (<i>Podicipedidae</i>) found on lakes and ponds
        worldwide. Striking to watch, easy to overlook, and not closely related to the ducks and
        loons they superficially resemble. They also have very interesting courtship displays, <a href="https://www.youtube.com/watch?v=98ceB5SPRXI " target="_blank" rel="noreferrer">check that out for sure</a>.

        I chose the name Grebe because the Great Crested Grebe was one of the first birds in my birding journey that I observed and photographed quite closely.
      </p>

      {/* ---------- Privacy ---------- */}
      <h3 id="about-privacy" className="about-h">Privacy</h3>
      <p className="about-p">
        Grebe collects as little as possible, and works fully offline unless you choose to sign in.
      </p>
      <ul className="about-privacy">
        <li>
          <b>Playing signed out.</b> Your stats live only in this browser (local storage). Nothing
          about your games leaves your device.
        </li>
        <li>
          <b>Accounts are optional.</b> If you create one, it's a username and password only, no
          email. Your stats and finished games then sync so they carry across devices and can appear
          on the leaderboard. (No email means a forgotten password can't be recovered.)
        </li>
        <li>
          <b>What others can see.</b> Only your leaderboard display name and your aggregate scores.
          Your individual guesses are never shared; the leaderboard shows totals, not your rows.
        </li>
        <li>
          <b>One external request.</b> When a round ends, the reveal card fetches a short summary and
          thumbnail from <a href="https://www.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia</a>.
          That's the only third-party call during normal play.
        </li>
        <li>
          <b>No tracking.</b> No analytics, no ads, no third-party trackers.
        </li>
      </ul>

      <p className="about-foot">
        Snapshot built {built || "—"} · GBIF (species + names) × Open Tree of Life (topology + ranks).
        Sources: <a href="https://www.gbif.org" target="_blank" rel="noreferrer">gbif.org</a> ·{" "}
        <a href="https://tree.opentreeoflife.org" target="_blank" rel="noreferrer">tree.opentreeoflife.org</a>
      </p>
    </div>
  );
}
