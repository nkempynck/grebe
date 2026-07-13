import { useState } from "react";
import type { DerivedStats, GroupScore, GroupWin } from "../data/stats";
import type { UsePlayer } from "../hooks/usePlayer";

interface Props {
  stats: DerivedStats;
  player: UsePlayer;
  onClose?: () => void;
}

function SyncBar({ player }: { player: UsePlayer }) {
  const [open, setOpen] = useState(false);
  const [u, setU] = useState("");
  const [p, setP] = useState("");

  if (!player.configured) {
    return <div className="stats-sync"><span className="stats-sync-note">Saved on this device</span></div>;
  }
  if (player.session) {
    return (
      <div className="stats-sync">
        <span className="stats-sync-on">☁ Synced as {player.username}</span>
        <button className="linkbtn" onClick={player.signOut}>Sign out</button>
      </div>
    );
  }
  return (
    <div className="stats-sync">
      {!open ? (
        <button className="linkbtn" onClick={() => setOpen(true)}>Sync across devices →</button>
      ) : (
        <div className="stats-sync-form">
          <p>Use a username + password to carry your stats to other devices. No email needed.</p>
          <p className="stats-sync-warn">Because there's no email, a forgotten password can't be recovered — pick one you'll remember.</p>
          <div className="admin-login-fields">
            <input type="text" autoComplete="username" placeholder="username" value={u} onChange={(e) => setU(e.target.value)} />
            <input type="password" autoComplete="current-password" placeholder="password" value={p} onChange={(e) => setP(e.target.value)} />
          </div>
          <div className="stats-sync-actions">
            <button className="admin-rand" onClick={() => player.signIn(u, p)}>Sign in</button>
            <button className="admin-rand" onClick={() => player.signUp(u, p)}>Create account</button>
            <button className="linkbtn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
          {player.error && <p className="admin-authmsg is-err">{player.error}</p>}
        </div>
      )}
    </div>
  );
}

/** Per-clade rows whose bar length encodes the primary metric (points for daily,
 *  win% for practice), so the strongest groups read at a glance. */
function GroupBars({ groups, metric, strengthId }: {
  groups: (GroupScore | GroupWin)[];
  metric: "points" | "winpct";
  strengthId?: string | null;
}) {
  const valueOf = (g: GroupScore | GroupWin) =>
    metric === "points" ? (g as GroupScore).avgPoints : g.winPct;
  const max = Math.max(1, ...groups.map(valueOf));
  return (
    <div className="stats-clades">
      {groups.map((g) => {
        const val = valueOf(g);
        const isStrength = g.id === strengthId;
        return (
          <div className={`clade-row${isStrength ? " is-strength" : ""}`} key={g.id}>
            <span className="clade-ico">{g.icon}</span>
            <span className="clade-name">{g.label}{isStrength && <span className="clade-star">★</span>}</span>
            <div className="clade-track">
              <div className="clade-bar" style={{ width: `${(val / max) * 100}%` }} />
            </div>
            {metric === "points" ? (
              <>
                <span className="clade-pct">{(g as GroupScore).avgPoints}p</span>
                <span className="clade-meta" title={`${(g as GroupScore).totalPoints} pts total`}>
                  {g.wins}/{g.played} · {g.winPct}%
                </span>
              </>
            ) : (
              <>
                <span className="clade-pct">{g.winPct}%</span>
                <span className="clade-meta">{g.wins}/{g.played}</span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function StatsPanel({ stats, player, onClose }: Props) {
  const { daily, practice, kinship } = stats;

  return (
    <div className="stats">
      {onClose && (
        <button className="stats-close" onClick={onClose} aria-label="Close stats">×</button>
      )}
      <SyncBar player={player} />

      {/* ---------- LINEAGE — ranked, score-based ---------- */}
      <div className="stats-sub">Lineage · daily</div>
      <div className="stats-nums">
        <div className="stat"><b>{daily.points.total}</b><span>Total points</span></div>
        <div className="stat"><b>{daily.points.avg}</b><span>Avg / game</span></div>
        <div className="stat"><b>{daily.points.best}</b><span>Best game</span></div>
        <div className="stat"><b>{daily.currentStreak}</b><span>Streak</span></div>
        <div className="stat"><b>{daily.maxStreak}</b><span>Max streak</span></div>
        <div className="stat"><b>{daily.played}</b><span>Played · {daily.winPct}% won</span></div>
      </div>

      <div className="stats-dist-ttl">Points by clade</div>
      {daily.groups.length === 0 ? (
        <p className="stats-empty">Play a daily to start scoring. Points reward harder days, fewer guesses, and no hints.</p>
      ) : (
        <>
          <GroupBars groups={daily.groups} metric="points" strengthId={daily.strengthId} />
          {daily.strengthId && (
            <p className="stats-strength">
              Highest-scoring: <b>{daily.groups.find((g) => g.id === daily.strengthId)?.label}</b>
            </p>
          )}
        </>
      )}

      {/* ---------- KINSHIP — ranked grid ---------- */}
      <div className="stats-sub stats-sub-2">Kinship · daily</div>
      {kinship.played === 0 ? (
        <p className="stats-empty">Play the daily Kinship grid to start scoring. Fewer mistakes score more; a clean board earns the full weight.</p>
      ) : (
        <div className="stats-nums">
          <div className="stat"><b>{kinship.points.total}</b><span>Total points</span></div>
          <div className="stat"><b>{kinship.points.avg}</b><span>Avg / game</span></div>
          <div className="stat"><b>{kinship.points.best}</b><span>Best game</span></div>
          <div className="stat"><b>{kinship.currentStreak}</b><span>Streak</span></div>
          <div className="stat"><b>{kinship.maxStreak}</b><span>Max streak</span></div>
          <div className="stat"><b>{kinship.played}</b><span>Played · {kinship.winPct}% won</span></div>
        </div>
      )}

      {/* ---------- PRACTICE — free play, unranked ---------- */}
      <div className="stats-sub stats-sub-2">Practice · free play</div>
      {practice.played === 0 ? (
        <p className="stats-empty">Free-play rounds show up here. Practice is unranked, so it isn't scored — just win-rate by group.</p>
      ) : (
        <>
          <div className="stats-nums">
            <div className="stat"><b>{practice.played}</b><span>Played</span></div>
            <div className="stat"><b>{practice.wins}</b><span>Won</span></div>
            <div className="stat"><b>{practice.winPct}</b><span>Win %</span></div>
          </div>
          <div className="stats-dist-ttl">Win rate by clade</div>
          <GroupBars groups={practice.groups} metric="winpct" />
        </>
      )}
    </div>
  );
}
