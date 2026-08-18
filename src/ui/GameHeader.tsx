import type { ReactNode } from "react";

/** Games that have a header. Deliberately NOT data/games' GameId, which is the scored,
 *  persisted, leaderboarded set — Mosaic has a header long before it has any of that, and
 *  widening the scoring type to give it one would ripple into stats and the database. */
export type HeaderGameId = "lineage" | "kinship" | "branches" | "mosaic";

const LABEL: Record<HeaderGameId, string> = {
  lineage: "Lineage", kinship: "Kinship", branches: "Branches", mosaic: "Mosaic",
};

interface Props {
  game: HeaderGameId;
  /** Weekday difficulty tier 1–7. Omit for un-tiered modes (e.g. free play). */
  tier?: number;
  dayName?: string;
  difficulty?: string;
  /** Extra config after day · difficulty (e.g. Lineage's scope / resolution). */
  meta?: ReactNode;
  /** One-line description of what to do in this game. */
  blurb: ReactNode;
  /** Opens the matching About section. */
  onHowItWorks?: () => void;
  /** Game-specific controls under the blurb (view toggle, mode switch…). */
  children?: ReactNode;
}

/** The consistent per-game header: a difficulty/day line, a "how it works" link,
 *  a one-line blurb, then any game-specific controls. Each game gets a subtle
 *  accent from the palette via the data-game attribute (see --game in the CSS). */
export function GameHeader({ game, tier, dayName, difficulty, meta, blurb, onHowItWorks, children }: Props) {
  const pips = tier ? "●".repeat(tier) + "○".repeat(Math.max(0, 7 - tier)) : null;
  return (
    <header className="gamehead" data-game={game}>
      <div className="gamehead-row">
        <span className="gamehead-diff">
          {pips && <span className="gamehead-pips" title={`Difficulty ${tier}/7`}>{pips}</span>}
          {dayName && difficulty && <span className="gamehead-day">{dayName} · {difficulty}</span>}
          {meta && <span className="gamehead-meta">{meta}</span>}
        </span>
        {onHowItWorks && (
          <button className="linkbtn gamehead-how" onClick={onHowItWorks}>ⓘ How {LABEL[game]} works</button>
        )}
      </div>
      {blurb && <p className="gamehead-blurb">{blurb}</p>}
      {children}
    </header>
  );
}
