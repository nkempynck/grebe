import taxonomy from "../data/taxonomy.json";

/** Smoothly scroll a section into view without touching the URL hash (the app
 *  uses the hash for #admin routing, so we avoid polluting it). */
function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const SECTIONS = [
  { id: "about-game", label: "The game" },
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

      {/* ---------- The game ---------- */}
      <h3 id="about-game" className="about-h">The game</h3>
      <p className="about-lede">
        Guess the hidden organism. Every miss lands on a shared-ancestry tree at the clade it has in
        common with the answer, so each guess narrows where the target sits — closer guesses branch
        off lower down.
      </p>
      <p className="about-p">
        Grebe is directly inspired by{" "}
        <a href="https://metazooa.com" target="_blank" rel="noreferrer">Metazooa</a> (and its plant
        counterpart, Metaflora) — the daily animal-guessing game where each wrong guess reveals the
        nearest shared taxonomic rank. Grebe keeps that core loop and adds a few twists: you can
        <b> re-root the tree</b> to any scope (not just animals — fungi, plants, all of life), pick
        how close counts as a win (<b>resolution</b>, from exact species out to same order), and
        read a <b>drawn cladogram</b> that shows exactly where each guess split off. There's a shared
        daily puzzle with a leaderboard, plus free play for practice.
      </p>

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
            species — selected per group and ranked by number of occurrence records — along with
            their English common names.
          </p>
        </div>
        <div className="about-src is-brass">
          <div className="about-src-tag">Open Tree of Life · topology</div>
          <p>
            The <a href="https://tree.opentreeoflife.org" target="_blank" rel="noreferrer">Open
            Tree of Life</a> is a synthetic phylogeny assembled from published studies and
            reference taxonomies. It provides the tree connecting those species — the branching
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
          used only during this build step — run <code>npm run build:taxonomy</code> to refresh it.
        </li>
      </ol>

      {/* ---------- The name ---------- */}
      <h3 id="about-name" className="about-h">The name</h3>
      <p className="about-p">
        Grebes are a family of diving waterbirds (<i>Podicipedidae</i>) found on lakes and ponds
        worldwide — striking to watch, easy to overlook, and not closely related to the ducks and
        loons they superficially resemble. A small, unshowy reminder that the tree of life is full
        of look-alikes that branched apart long ago.
      </p>
      {/* TODO(you): replace with your personal note on why "Grebe". */}
      <p className="about-p about-personal">
        <i>[Personal note about the name goes here.]</i>
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
          <b>Accounts are optional.</b> If you create one, it's a username and password only — no
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
