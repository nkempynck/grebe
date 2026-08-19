import { useState } from "react";
import type { DerivedStats } from "../data/stats";
import type { FieldStats } from "../data/field";
import type { GameId } from "../data/games";
import type { UsePlayer } from "../hooks/usePlayer";
import { GameStatsPanel, OverallStatsPanel } from "./StatsPanel";
import { BadgesPanel } from "./BadgesPanel";
import { OverallBadgesPanel } from "./OverallBadgesPanel";

interface Props {
  stats: DerivedStats;
  field: FieldStats | null;
  player: UsePlayer;
}

/** Tabs mirroring the leaderboard's game switcher, so "overall, then per game"
 *  means the same thing on both screens. */
const TABS: { id: "overall" | GameId; label: string }[] = [
  { id: "overall", label: "🏆 Overall" },
  { id: "lineage", label: "🧬 Lineage" },
  { id: "kinship", label: "🧩 Kinship" },
  { id: "branches", label: "🌿 Branches" },
];

/** The Stats section: one tab per game (plus an overall tab), each holding that
 *  game's stats above that game's badges. Separate from Account, which is identity
 *  and settings — the two were one long scroll. */
export function StatsTabs({ stats, field, player }: Props) {
  const [tab, setTab] = useState<"overall" | GameId>("overall");

  return (
    <>
      <div className="lb-gametabs" role="tablist" aria-label="Stats and badges by game">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            // Each tab carries its game's accent, exactly as the games nav does, so
            // the selected tab is marked in the colour that game uses everywhere
            // else. "overall" has no game and falls back to brass.
            data-game={t.id === "overall" ? undefined : t.id}
            className={`lb-seg${tab === t.id ? " is-on" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "overall" ? (
        <>
          <OverallStatsPanel stats={stats} field={field} />
          <OverallBadgesPanel player={player} />
        </>
      ) : (
        <>
          <GameStatsPanel stats={stats} field={field} game={tab} />
          <BadgesPanel stats={stats} player={player} game={tab} />
        </>
      )}
    </>
  );
}
