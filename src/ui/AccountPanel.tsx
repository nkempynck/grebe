import { useEffect, useState } from "react";
import type { DerivedStats } from "../data/stats";
import type { UsePlayer } from "../hooks/usePlayer";
import { StatsPanel } from "./StatsPanel";
import { BadgesPanel } from "./BadgesPanel";
import { OverallBadgesPanel } from "./OverallBadgesPanel";

interface Props {
  stats: DerivedStats;
  player: UsePlayer;
}

/** Account identity + settings: the (fixed) login username, the editable public
 *  leaderboard name, a self-serve password change, and leaderboard opt-in. Each
 *  game's all-time standing lives in that game's panel below (see BadgesPanel). */
function Profile({ player }: { player: UsePlayer }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Self-serve password change. There's no recovery email, so a forgotten password
  // still needs an admin reset, but a remembered one can be rotated here.
  const [pwEditing, setPwEditing] = useState(false);
  const [pw, setPw] = useState("");
  const [pwSaved, setPwSaved] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);

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

  const savePw = async () => {
    setPwErr(null);
    const { error } = await player.changePassword(pw);
    setPwErr(error);
    if (!error) {
      setPwEditing(false);
      setPw("");
      setPwSaved(true);
      setTimeout(() => setPwSaved(false), 2200);
    }
  };

  const toggleVisible = async () => {
    setErr(null);
    const { error } = await player.setShowOnLeaderboard(!player.showOnLeaderboard);
    if (error) setErr(error);
  };

  return (
    <div className="acct">
      <div className="acct-row">
        <div>
          <div className="acct-label">Username</div>
          <div className="acct-name">{player.username ?? "—"}</div>
          <div className="acct-sub">What you log in with. It can’t be changed.</div>
        </div>
      </div>

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

      <div className="acct-row">
        <div>
          <div className="acct-label">Password</div>
          {pwEditing ? (
            <div className="acct-edit">
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} minLength={6} autoComplete="new-password" aria-label="New password" placeholder="New password, min 6 characters" />
              <button className="admin-rand" onClick={savePw}>Save</button>
              <button className="linkbtn" onClick={() => { setPwEditing(false); setPw(""); setPwErr(null); }}>Cancel</button>
            </div>
          ) : (
            <div className="acct-name">
              <button className="linkbtn" onClick={() => setPwEditing(true)}>Change password</button>
              {pwSaved && <span className="acct-saved">changed ✓</span>}
            </div>
          )}
          {pwErr && <div className="acct-err">{pwErr}</div>}
        </div>
      </div>

      <div className="acct-row acct-toggle-row">
        <div>
          <div className="acct-label">Show me on the leaderboard</div>
          <div className="acct-sub">
            {player.showOnLeaderboard
              ? "Your name and scores appear on the public boards."
              : "You’re hidden from the public boards. Your stats still count for you."}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={player.showOnLeaderboard}
          className={`acct-switch${player.showOnLeaderboard ? " is-on" : ""}`}
          onClick={toggleVisible}
        >
          <span className="acct-switch-knob" />
        </button>
      </div>

      <div className="acct-note">
        <span>
          <b>There’s no password recovery on Grebe.</b> Keep your password written down
          somewhere safe. If you lose it, you lose access to this account and its streaks.
        </span>
      </div>
    </div>
  );
}

export function AccountPanel({ stats, player }: Props) {
  return (
    <>
      {player.session && <Profile player={player} />}
      <StatsPanel stats={stats} player={player} />
      <OverallBadgesPanel player={player} />
      <BadgesPanel stats={stats} player={player} game="lineage" />
      <BadgesPanel stats={stats} player={player} game="kinship" />
      <BadgesPanel stats={stats} player={player} game="branches" />
    </>
  );
}
