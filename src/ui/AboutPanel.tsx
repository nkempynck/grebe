import taxonomy from "../data/taxonomy.json";

/** Where Grebe gets its data, how much of it there is, and how it's built.
 *  Numbers come straight from the built snapshot so they never drift. */
export function AboutPanel() {
  const species = taxonomy.counts?.species ?? 0;
  const nodes = taxonomy.counts?.nodes ?? 0;
  const scopes = taxonomy.scopes?.length ?? 0;
  const built = (taxonomy.generatedAt ?? "").slice(0, 10);

  return (
    <div className="about">
      <p className="about-lede">
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

      <h3 className="about-h">Sources</h3>
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

      <h3 className="about-h">How it's built</h3>
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

      <p className="about-foot">
        Snapshot built {built || "—"} · GBIF (species + names) × Open Tree of Life (topology + ranks).
        Sources: <a href="https://www.gbif.org" target="_blank" rel="noreferrer">gbif.org</a> ·{" "}
        <a href="https://tree.opentreeoflife.org" target="_blank" rel="noreferrer">tree.opentreeoflife.org</a>
      </p>
    </div>
  );
}
