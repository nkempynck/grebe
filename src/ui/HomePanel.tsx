import { dailyLabel, todayKey } from "../core/daily";

interface Props {
  onPlay: (view: "lineage" | "kinship" | "branches") => void;
}

const GAMES = [
  {
    id: "lineage" as const,
    icon: "🧬",
    name: "Lineage",
    tagline:
      "Guess the hidden organism. Every miss lands on the tree of life at the clade it shares with the answer, so each guess narrows where the target sits.",
    inspired: "Metazooa",
  },
  {
    id: "kinship" as const,
    icon: "🧩",
    name: "Kinship",
    tagline:
      "Sixteen species, four hidden groups of four. Sort each into the clade it belongs to before you run out of guesses.",
    inspired: "Connections",
  },
  {
    id: "branches" as const,
    icon: "🌿",
    name: "Branches",
    tagline:
      "Rebuild a slice of the tree: drag each species onto the branch it belongs to, using the worked examples already in place as your guide.",
    inspired: null,
  },
];

/** The platform landing: what Grebe is, and a card per game to choose from. */
export function HomePanel({ onPlay }: Props) {
  const label = dailyLabel(todayKey());
  return (
    <div className="home">
      <p className="home-intro">
        Grebe is a set of daily puzzle games played on the <b>tree of life</b>, the
        shared-ancestry tree that connects every living thing. Each game is new every day and
        the same for everyone. Pick one, or more, and enjoy!
      </p>

      <div className="home-games">
        {GAMES.map((game) => (
          <button key={game.id} className={`home-card is-${game.id}`} data-game={game.id} onClick={() => onPlay(game.id)}>
            <div className="home-card-top">
              <span className="home-card-ico" aria-hidden="true">{game.icon}</span>
              <span className="home-card-daily">{label === "Preview" ? "Preview" : `Daily ${label}`}</span>
            </div>
            <h2 className="home-card-name">{game.name}</h2>
            <p className="home-card-tag">{game.tagline}</p>
            <div className="home-card-foot">
              <span className="home-card-inspired">{game.inspired ? `inspired by ${game.inspired}` : "a Grebe original"}</span>
              <span className="home-card-play">Play →</span>
            </div>
          </button>
        ))}

        <div className="home-card is-soon" aria-hidden="true">
          <div className="home-card-top"><span className="home-card-ico">🌱</span></div>
          <h2 className="home-card-name">More to come</h2>
          <p className="home-card-tag">Further tree-of-life games are in the works.</p>
        </div>
      </div>
    </div>
  );
}
