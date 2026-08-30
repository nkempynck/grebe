import { useEffect } from "react";
import taxonomy from "../data/taxonomy.json";

/** Smoothly scroll a section into view without touching the URL hash (the app
 *  uses the hash for #admin routing, so we avoid polluting it). */
function jump(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

const SECTIONS = [
  { id: "about-platform", label: "What Grebe is" },
  { id: "about-name", label: "The name" },
  { id: "about-games", label: "The games" },
  { id: "about-data", label: "Data sources" },
  { id: "about-build", label: "How it's built" },
  { id: "about-privacy", label: "Privacy" },
];

/** What Grebe is, where its data comes from, how it's built, and what it stores.
 *  Data numbers come straight from the built snapshot so they never drift. */
/** @param focus  a section id to scroll to on open (e.g. deep-linked from a game
 *  page's "How this works" link). */
export function AboutPanel({ focus }: { focus?: string | null }) {
  const species = taxonomy.counts?.species ?? 0;
  const nodes = taxonomy.counts?.nodes ?? 0;
  const scopes = taxonomy.scopes?.length ?? 0;
  const built = (taxonomy.generatedAt ?? "").slice(0, 10);

  useEffect(() => {
    if (!focus) return;
    const el = document.getElementById(focus);
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [focus]);

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
        Grebe is a small platform of daily puzzle games, each played on the <b>tree of life</b>,
        the shared-ancestry tree that connects every living thing. Every game is new each day and
        the same for all players.
      </p>
      <p className="about-p">
        Grebe was made purely as a personal project, coming from my interest in evolutionary biology
        and love for daily puzzle games. It is intended for fun and educational purposes, and I hope it
        helps people learn more about the diversity of life on Earth.
      </p>

      {/* ---------- The name ---------- */}
      <h3 id="about-name" className="about-h">The name</h3>
      <p className="about-p">
        Grebes are a family of diving waterbirds (<i>Podicipedidae</i>) found on lakes and ponds
        worldwide. They have quite an interesting look and can be easy to overlook, and are not closely related to the duck
        and loon species they superficially resemble. They also have{" "}
        <a href="https://www.youtube.com/watch?v=98ceB5SPRXI" target="_blank" rel="noreferrer">very interesting courtship displays</a>.
        I chose the name because the Great Crested Grebe was one of the first birds I observed and
        photographed closely in my birding journey. The logo is a drawing of a photo of that grebe,
        taken the day I bought my first birding camera.
      </p>
      {/* ---------- The games ---------- */}
      <h3 id="about-games" className="about-h">The games</h3>
      <div className="about-games">
        <div className="about-game" id="about-lineage">
          <div className="about-game-hd">
            <span className="about-game-ico" aria-hidden="true">🧬</span>
            <b>Lineage</b>
            <span className="about-game-src">inspired by Metazooa</span>
          </div>
          <p>
            Guess the hidden organism. Every wrong guess lands on the shared-ancestry tree at the
            clade it has in common with the answer, so each guess narrows where the target sits:
            closer guesses branch off lower down. You can re-root the tree to any scope (animals,
            plants, birds, all of life), pick how close counts as a win (from exact species out to
            same order), and read a drawn cladogram of where each guess split off. It has a shared
            daily with a leaderboard, plus free play. Directly inspired by{" "}
            <a href="https://metazooa.com" target="_blank" rel="noreferrer">Metazooa</a> and its
            plant counterpart Metaflora. Check them out! Also thanks to my buddy Jasper for introducing
            me to Metazooa!
          </p>
          <details className="about-score">
            <summary>How scoring works</summary>
            <p>
              A daily is scored <b>difficulty&nbsp;weight × efficiency × hint&nbsp;factor</b>, and zero
              for a loss. The weight is the day's tier (<code>100–160 by day</code>), so a Sunday win is
              worth a little more than a Monday one. Efficiency rewards fewer guesses, and your
              opening guess is the cheapest on the board, since it's made blind. You get
              <b> two hints</b>: the first costs 20% of the day's points, the second 30%. Giving up
              scores zero. Only the daily is ranked. Free play isn't scored.
            </p>
          </details>
        </div>

        <div className="about-game" id="about-kinship">
          <div className="about-game-hd">
            <span className="about-game-ico" aria-hidden="true">🧩</span>
            <b>Kinship</b>
            <span className="about-game-src">inspired by Connections</span>
          </div>
          <p>
            Sixteen species, four hidden groups of four; each group a real clade. Sort every
            species into the family it belongs to before four wrong guesses run out; the harder the
            day, the more the groups look alike (four kinds of perch rather than a frog, a fern and a
            beetle). A daily grid in the spirit of the New York Times'{" "}
            <a href="https://www.nytimes.com/games/connections" target="_blank" rel="noreferrer">Connections</a>.
            The idea to Grebe-inize this came from my partner, the goat, Maria.
          </p>
          <details className="about-score">
            <summary>How scoring works</summary>
            <p>
              A board is scored <b>the day's weight × (1 − mistakes⁄4)</b>, and zero for a loss. A clean
              board earns the full weight (<code>100–160 by day</code>); each of your up-to-four mistakes
              shaves a quarter. Early in the week every species' name and picture is shown for free to help;
              midweek the pictures hide behind a gentle peek that never ends the board (the first three
              free, then each further reveal costs 15% of the day's points). The weekend flips it: the
              pictures are the tiles and the names are hidden, revealed the same way (first four free).
              It shares the weekday weight with Lineage, so scores are comparable across the games.
            </p>
          </details>
        </div>

        <div className="about-game" id="about-branches">
          <div className="about-game-hd">
            <span className="about-game-ico" aria-hidden="true">🌿</span>
            <b>Branches</b>
            <span className="about-game-src">a Grebe original</span>
          </div>
          <p>
            Rebuild a slice of the tree. You're handed a labelled skeleton of named clades, all from a
            single class (all birds, or all spiders), some already showing a worked-example species,
            plus a tray of species to slot onto the right branch. Drag each onto the group it belongs
            to, then <b>Submit</b> to check: correct slots <b>lock in</b>, and a wrong board <b>costs a
            mistake</b> (the misplaced tiles come back to try again). You can miss once
            (Mon–Wed) or twice (Thu–Sun) and still win, and one more than that ends the board. It gets
            harder through the week: gentle days are broad and forgiving, the toughest pit tight
            look-alike clades that reward knowing your groups. Read it as a top-down tree or a circular
            fan, and tap any clade or anchor for its field notes. Those articles often list their
            members by name, so any species still waiting in the tray is blanked out of the text.
            The unedited article is one tap further, and that one costs you.
          </p>
          <details className="about-score">
            <summary>How scoring works</summary>
            <p>
              A win starts at <b>the day's weight × (correct − penalties) ⁄ slots</b>, then each
              surviving <b>mistake</b> knocks off <b>35%</b> (so one mistake keeps 65%, two keep 30%),
              never dropping below a tenth of the weight so long as one slot was earned unaided. A{" "}
              <b>hint</b> reveals a slot and forfeits that whole slot, and there's only one per board;
              looking a to-place species up on
              Wikipedia forfeits <b>half</b> of one, since the article usually names its family and so is
              only a soft nudge. Opening the full article, where nothing is blanked out, costs the same
              half, once per clade or species. A slot is the day's weight split across the board, so half
              of one runs <b>11 to 20 points</b> depending on the day and how many slots it deals. Reading
              the card in the app, and enlarging a species' picture, is free. Going{" "}
              <b>over the mistake limit</b> ends the board as a loss: you still keep the
              slots you'd locked, at 35% credit, but the streak resets. It shares the weekday weight
              (<code>100–160 by day</code>) with Lineage and Kinship, so scores line up across all three.
            </p>
          </details>
        </div>

        <div className="about-game" id="about-mosaic">
          <div className="about-game-hd">
            <span className="about-game-ico" aria-hidden="true">🖼</span>
            <b>Mosaic</b>
            <span className="about-game-src">a Grebe original</span>
          </div>
          <p>
            Name the animal. Its photograph has been cut into tiles and shuffled, and every wrong
            guess puts a little more of it back together, so the picture is clearest on your last
            guess rather than your first. Beside it, a table shows which <b>traits</b> your guess
            shares with the answer, things like how many legs it has, whether it flies, whether it
            lives in water and what covers it. Those are traits, <b>not relatedness</b>: a dolphin
            and a shark agree on almost every row and are not close relatives at all.
          </p>
          <p>
            Every guess also gets a <b>closeness</b> reading, and that one <i>is</i> relatedness.
            Early in the week it names the rank you share, <i>same family</i> or <i>same
            order</i>, never which one. From midweek it is a number in <b>degrees</b>, where 0
            shares nothing with the answer but being an animal and 100 is the answer itself.
          </p>
          <p>
            What changes through the week is the <b>help</b>. Early on you can narrow the field to
            a group and look any animal up to see where it sits. Midweek the lookup goes, and by
            the weekend it is the photograph and the table alone. Harder days give you more
            guesses to make up for it, and the picture comes back in smaller steps. The answer is
            always an animal well known enough to have a decent picture.
          </p>
          <p>
            Mosaic is in <b>beta</b>. Unlike the other three it is not yet a daily: the animal is
            drawn at random each time you open it, so yours is not everyone's and there is nothing
            to compare. Nothing is scored or recorded, you can play as many as you like, and the
            difficulty is yours to set rather than the day's. Tell us how it plays on the feedback
            board under the game.
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
      <p className="about-p">
        Each game keeps its own streak: how many days in a row you've won it. Only a win extends a
        streak, and only a win keeps one. A give-up, a lost board or a day left unplayed ends the
        run, whichever game it was.
      </p>
      <p className="about-p">
        The games above are inspired by these existing games, not connected to them. Grebe is not
        affiliated with Metazooa, the New York Times, or their creators in any way.
      </p>

      {/* ---------- Data sources ---------- */}
      <h3 id="about-data" className="about-h">Data sources</h3>
      <p className="about-p">
        The species and the tree come from a few open sources, combined once into a static snapshot
        the game ships with. The app reads that snapshot locally, the species and tree themselves
        never need the network.
      </p>
      <div className="about-snap">
        <span><b>{species.toLocaleString()}</b> species</span>
        <span><b>{nodes.toLocaleString()}</b> tree nodes</span>
        <span><b>{scopes}</b> scopes</span>
        <span>snapshot built <b>{built || "—"}</b></span>
      </div>
      <div className="about-srcs">
        <div className="about-src is-teal">
          <div className="about-src-tag">Wikipedia &amp; Wikidata · species &amp; names</div>
          <p>
            Which species make the cut is decided by readership: organisms are ranked by how many
            people read their English <a href="https://www.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia</a> article,
            so the game leans toward the ones you're likely to recognise rather than the
            best-sampled ones. Each species' common name is its article title, with{" "}
            <a href="https://www.wikidata.org" target="_blank" rel="noreferrer">Wikidata</a> filling
            in the names Wikipedia titles don't cover and naming the clades. Grebe leans on these
            for free, so if you enjoy it, please{" "}
            <a href="https://donate.wikimedia.org" target="_blank" rel="noreferrer">donate to Wikipedia</a>.
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
      <div className="about-src is-teal about-src-full">
        <div className="about-src-tag">Images · Wikimedia</div>
        <p>
          Every species picture is fetched live from Wikipedia and stays the property of its
          respective photographer, author, and licensor. Grebe stores none of them and claims no
          rights over them; each image is served straight from Wikimedia under its own licence, and
          the full details for any picture are on its Wikipedia page.
        </p>
      </div>
      <p className="about-p about-srcs-note">
        A stable per-species identifier from the{" "}
        <a href="https://www.gbif.org" target="_blank" rel="noreferrer">Global Biodiversity
        Information Facility</a> (GBIF) keys everything together, so each species stays distinct on
        the tree.
      </p>

      {/* ---------- How it's built ---------- */}
      <h3 id="about-build" className="about-h">How it's built</h3>
      <p className="about-p">
        Those sources are combined into the snapshot in a few steps:
      </p>
      <ol className="about-build">
        <li>
          <b>Pick the species.</b> Rank organisms in each group (mammals, birds, insects, plants,
          and so on) by how widely they're read about on Wikipedia and keep the most recognisable,
          then add a short curated list of familiar extras like humans, lab model organisms, and
          well-known animals. Balance out the pool so no one genus or family dominates.
        </li>
        <li>
          <b>Connect them on the tree.</b> Look up how those species are related and keep the slice
          of the tree of life that links them together.
        </li>
        <li>
          <b>Name everything.</b> Give each species its everyday name from its Wikipedia title,
          falling back to Wikidata, and name the clades the same way.
        </li>
        <li>
          <b>Save a snapshot.</b> The result is baked into a single file bundled with the app, so
          everyday play needs no network.
        </li>
      </ol>
      <p className="about-p">
        The full source, with all the technical detail, is on{" "}
        <a href="https://github.com/nkempynck/grebe" target="_blank" rel="noreferrer">GitHub</a>.
        Coding was done by Claude Opus 4.8. Software engineering and page design were done by me and Claude. Game design and
        feature design were done by me (and inspiration from the existing games mentioned before obviously),
        with help from Maria and valuable feedback from Eren.
      </p>

      {/* ---------- Privacy ---------- */}
      <h3 id="about-privacy" className="about-h">Privacy</h3>
      <p className="about-p">
        Grebe collects as little as possible. Your stats, guesses and history stay on your device
        unless you create an account. The only exception is an anonymous count when you finish a
        daily.
      </p>
      <ul className="about-privacy">
        <li>
          <b>Playing signed out.</b> Your stats live only in this browser (local storage). Nothing
          about your games leaves your device except the anonymous count.
        </li>
        <li>
          <b>Accounts are optional.</b> If you create one, it's just a name and a password. Your
          stats and finished games then sync so they carry across devices and can appear on the
          leaderboard. (There's no password recovery, so pick one you'll remember.)
        </li>
        <li>
          <b>What others can see.</b> Your leaderboard display name, your aggregate scores, and
          anything you post in a discussion. Your individual guesses are never shared; the
          leaderboard shows totals, not your rows.
        </li>
        <li>
          <b>Discussions.</b> Each daily puzzle has a discussion you can read once you've finished
          it, and post in with an account. A comment is public under your display name. Discussions
          are per puzzle and per day: once the day rolls over, that discussion is no longer shown.
          Comments you delete, and comments removed for breaking the rules, are kept out of sight but
          not erased from the database.
        </li>
        <li>
          <b>Network requests.</b> When a round ends, the reveal card fetches a summary and thumbnail
          from <a href="https://www.wikipedia.org" target="_blank" rel="noreferrer">Wikipedia</a>, which is
          the only third-party service Grebe uses. While you're online, the day's puzzle and the
          leaderboards load from Grebe's own backend. Fonts are bundled with the app, not loaded from
          a CDN. Apart from the count below, nothing about your play is uploaded unless you've
          signed in.
        </li>
        <li>
          <b>The anonymous count.</b> When you finish a daily, Grebe sends the game, the date, and
          whether you won. That's added to a daily total, with nothing linking it to you.
        </li>
        <li>
          <b>No tracking.</b> No analytics service, no ads, no third-party trackers.
        </li>
      </ul>

      <p className="about-foot">
        Snapshot built {built || "—"} · species selected by Wikipedia readership, names from
        Wikipedia &amp; Wikidata, topology &amp; ranks from Open Tree of Life.
        Sources: <a href="https://www.wikipedia.org" target="_blank" rel="noreferrer">wikipedia.org</a> ·{" "}
        <a href="https://www.wikidata.org" target="_blank" rel="noreferrer">wikidata.org</a> ·{" "}
        <a href="https://tree.opentreeoflife.org" target="_blank" rel="noreferrer">tree.opentreeoflife.org</a>
      </p>
      <p className="about-foot">
        Made by Niklas. © 2026 Niklas Kempynck. Free to play, share, and build on for
        noncommercial use; not for commercial use (
        <a href="https://github.com/nkempynck/grebe/blob/main/LICENSE.md" target="_blank" rel="noreferrer">PolyForm Noncommercial License</a>).
      </p>
    </div>
  );
}
