import { useState } from "react";
import { GUESS_BUCKET_LABELS, guessBucket, type DerivedStats } from "../data/stats";
import type { UsePlayer } from "../hooks/usePlayer";

interface Props {
  stats: DerivedStats;
  player: UsePlayer;
  /** Highlight this guess-count bucket (this round's result), if won. */
  highlightGuesses?: number | null;
  onClose?: () => void;
}

const BUCKET_LABELS = GUESS_BUCKET_LABELS;

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

export function StatsPanel({ stats, player, highlightGuesses, onClose }: Props) {
  const maxBar = Math.max(1, ...stats.distribution);
  const hlIndex = highlightGuesses != null ? guessBucket(highlightGuesses) : -1;

  return (
    <div className="stats">
      {onClose && (
        <button className="stats-close" onClick={onClose} aria-label="Close stats">×</button>
      )}
      <div className="stats-sub">Daily statistics</div>
      <SyncBar player={player} />

      <div className="stats-nums">
        <div className="stat"><b>{stats.played}</b><span>Played</span></div>
        <div className="stat"><b>{stats.winPct}</b><span>Win %</span></div>
        <div className="stat"><b>{stats.currentStreak}</b><span>Streak</span></div>
        <div className="stat"><b>{stats.maxStreak}</b><span>Max streak</span></div>
        <div className="stat"><b>{stats.points.total}</b><span>Points</span></div>
        <div className="stat"><b>{stats.points.avg}</b><span>Avg / game</span></div>
      </div>

      <div className="stats-dist-ttl">Daily guess distribution</div>
      {stats.wins === 0 ? (
        <p className="stats-empty">No solved dailies yet — your histogram fills in here.</p>
      ) : (
        <div className="stats-dist">
          {stats.distribution.map((count, i) => (
            <div className="dist-row" key={i}>
              <span className="dist-label">{BUCKET_LABELS[i]}</span>
              <div className="dist-track">
                <div
                  className={`dist-bar${i === hlIndex ? " is-hl" : ""}`}
                  style={{ width: `${(count / maxBar) * 100}%` }}
                >
                  <span className="dist-count">{count}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="stats-clade-head">
        <span className="stats-dist-ttl">By clade — all games</span>
        {stats.overall.played > 0 && (
          <span className="stats-overall">{stats.overall.winPct}% of {stats.overall.played}</span>
        )}
      </div>
      {stats.clades.length === 0 ? (
        <p className="stats-empty">Play some rounds (daily or free) to see which groups you're best at.</p>
      ) : (
        <>
          <div className="stats-clades">
            {stats.clades.map((c) => (
              <div className={`clade-row${c.id === stats.strengthId ? " is-strength" : ""}`} key={c.id}>
                <span className="clade-ico">{c.icon}</span>
                <span className="clade-name">{c.label}{c.id === stats.strengthId && <span className="clade-star">★</span>}</span>
                <div className="clade-track">
                  <div className="clade-bar" style={{ width: `${c.winPct}%` }} />
                </div>
                <span className="clade-pct">{c.winPct}%</span>
                <span className="clade-meta" title={c.totalPoints ? `${c.totalPoints} pts total` : undefined}>
                  {c.wins}/{c.played}{c.avgPoints != null && ` · ⌀${c.avgPoints}p`}
                </span>
              </div>
            ))}
          </div>
          {stats.strengthId && (
            <p className="stats-strength">
              Strongest: <b>{stats.clades.find((c) => c.id === stats.strengthId)?.label}</b>
            </p>
          )}
        </>
      )}
    </div>
  );
}
