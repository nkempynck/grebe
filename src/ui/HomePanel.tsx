import { dailyLabel, todayKey } from "../core/daily";
import { MOSAIC_LAUNCH, mosaicIsLive } from "../core/mosaic";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL, InstagramIcon } from "./social";

type GameId = "lineage" | "kinship" | "branches" | "mosaic";

interface Props {
  onPlay: (view: GameId) => void;
  /** Today's result per game, null for a game not yet played today. */
  today: Record<GameId, { points: number; won: boolean } | null>;
}

const GAMES: {
  id: GameId;
  icon: string;
  name: string;
  tagline: string;
  inspired: string | null;
  beta: boolean;
  epoch?: string;
}[] = [
  {
    id: "lineage",
    icon: "🧬",
    name: "Lineage",
    tagline:
      "Guess the hidden organism. Every miss lands on the tree at the clade it shares with the answer, so each guess narrows where the target sits.",
    inspired: "Metazooa",
    beta: false,
  },
  {
    id: "kinship",
    icon: "🧩",
    name: "Kinship",
    tagline:
      "Sixteen species, four hidden groups of four. Sort each into the clade it belongs to before you run out of guesses.",
    inspired: "Connections",
    beta: false,
  },
  {
    id: "branches",
    icon: "🌿",
    name: "Branches",
    tagline:
      "Rebuild a slice of the tree: drag each species onto the branch it belongs to, using the worked examples already in place as your guide.",
    inspired: null,
    beta: false,
  },
  {
    id: "mosaic",
    icon: "🖼",
    name: "Mosaic",
    tagline:
      "Name the animal in a photograph that has been cut into tiles and shuffled. Every wrong guess puts a little more of the picture back together.",
    inspired: null,
    beta: false,
    // Mosaic opened months after the platform, so its row counts from its OWN first board.
    // The shared epoch called its second day №49, which is Grebe's number, not Mosaic's.
    epoch: MOSAIC_LAUNCH,
  },
];

/** The platform landing: what Grebe is, and a row per game to choose from. */
export function HomePanel({ onPlay, today: results }: Props) {
  const today = todayKey();
  // Per GAME, not per day: three of the four opened with the platform and share its count,
  // Mosaic carries its own.
  const labelFor = (epoch?: string) => dailyLabel(today, epoch);
  // A game that has not opened yet is not offered. Same test the nav uses, on the PUZZLE date,
  // so the row appears at the 09:00 rollover rather than at midnight.
  const live = GAMES.filter((g) => g.id !== "mosaic" || mosaicIsLive(today));
  // What is still to play comes first; played games drop below, each group in the usual order.
  const played = (id: GameId) => results[id] != null;
  const games = [...live.filter((g) => !played(g.id)), ...live.filter((g) => played(g.id))];
  return (
    <div className="home">
      <p className="home-intro">
        Grebe games are all built on the tree of life. They are updated daily. The goal is to have fun while ideally also learning. Enjoy!!  
      </p>

      <ul className="home-list">
        {games.map((game) => (
          <li key={game.id}>
            <button className={`home-row${played(game.id) ? " is-played" : ""}`} data-game={game.id} onClick={() => onPlay(game.id)}>
              <span className="home-row-ico" aria-hidden="true">{game.icon}</span>
              <span className="home-row-body">
                <span className="home-row-head">
                  <span className="home-row-name">{game.name}</span>
                  {game.beta && <span className="home-card-new">New</span>}
                  <span className="home-row-no">{labelFor(game.epoch)}</span>
                  {(() => {
                    const r = results[game.id];
                    return r && (
                      <span className="home-row-done">
                        {r.won ? "Played" : "Played (but failed...)"} · {r.points} pts
                      </span>
                    );
                  })()}
                </span>
                <span className="home-row-tag">{game.tagline}</span>
                {game.inspired && <span className="home-row-credit">Inspired by {game.inspired}.</span>}
              </span>
            </button>
          </li>
        ))}
        <li className="home-soon">
          <b>More to come.</b> Further tree-of-life games are in the works. In my mind at least. If you have ideas feel free to share.
        </li>
      </ul>

      <p className="home-social">
        Follow{" "}
        <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer"><InstagramIcon /> {INSTAGRAM_HANDLE} on Instagram</a>{" "}
        for news and updates, easy discussions (feel free to send me a DM with feature requests and
        ideas), and potentially some laughs.
      </p>
    </div>
  );
}
