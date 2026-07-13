import { useEffect, useState } from "react";
import type { DerivedStats } from "../data/stats";
import type { UsePlayer } from "../hooks/usePlayer";
import { fetchStanding, type Standing } from "../data/games";
import { StatsPanel } from "./StatsPanel";
import { BadgesPanel } from "./BadgesPanel";

interface Props {
  stats: DerivedStats;
  player: UsePlayer;
}

/** Editable public name + all-time standing, shown above the stats. */
function Profile({ player }: { player: UsePlayer }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [standing, setStanding] = useState<Standing | null>(null);

  useEffect(() => {
    setName(player.displayName ?? "");
  }, [player.displayName]);

  useEffect(() => {
    let live = true;
    fetchStanding("all", null).then((s) => live && setStanding(s));
    return () => { live = false; };
  }, []);

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

      <div className="acct-standing">
        <div className="acct-label">All-time standing</div>
        {standing && standing.my_rank != null ? (
          <div className="acct-standing-val">
            #{standing.my_rank} of {standing.total_players} · {standing.my_score} pts
          </div>
        ) : (
          <div className="acct-standing-val is-muted">No ranked daily games yet.</div>
        )}
      </div>
    </div>
  );
}

export function AccountPanel({ stats, player }: Props) {
  return (
    <>
      {player.session && <Profile player={player} />}
      <StatsPanel stats={stats} player={player} />
      <BadgesPanel stats={stats} player={player} />
    </>
  );
}
