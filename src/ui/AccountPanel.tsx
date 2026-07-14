import { useEffect, useState } from "react";
import type { DerivedStats } from "../data/stats";
import type { UsePlayer } from "../hooks/usePlayer";
import { StatsPanel } from "./StatsPanel";
import { BadgesPanel } from "./BadgesPanel";

interface Props {
  stats: DerivedStats;
  player: UsePlayer;
}

/** Editable public leaderboard name. Each game's all-time standing lives in that
 *  game's panel below (see BadgesPanel), so no single game is singled out here. */
function Profile({ player }: { player: UsePlayer }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(player.displayName ?? "");
  }, [player.displayName]);

  const save = async () => {
    const { error } = await player.updateDisplayName(name);
    setErr(error);
    if (!error) {
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    }
  };

  return (
    <div className="acct">
      <div className="acct-row">
        <div>
          <div className="acct-label">Leaderboard name</div>
          {editing ? (
            <div className="acct-edit">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} aria-label="Display name" placeholder="3–20 chars, must be unique" />
              <button className="admin-rand" onClick={save}>Save</button>
              <button className="linkbtn" onClick={() => { setEditing(false); setName(player.displayName ?? ""); }}>Cancel</button>
            </div>
          ) : (
            <div className="acct-name">
              {player.displayName ?? "—"}
              <button className="linkbtn" onClick={() => setEditing(true)}>edit</button>
              {saved && <span className="acct-saved">saved ✓</span>}
            </div>
          )}
          {err && <div className="acct-err">{err}</div>}
        </div>
      </div>
    </div>
  );
}

export function AccountPanel({ stats, player }: Props) {
  return (
    <>
      {player.session && <Profile player={player} />}
      <StatsPanel stats={stats} player={player} />
      <BadgesPanel stats={stats} player={player} game="lineage" />
      <BadgesPanel stats={stats} player={player} game="kinship" />
      <BadgesPanel stats={stats} player={player} game="branches" />
    </>
  );
}
