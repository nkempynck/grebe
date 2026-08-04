import { useState } from "react";
import { STRENGTH_MIN_GAMES, type DerivedStats, type GroupScore, type GroupWin } from "../data/stats";
import { fmtFieldPct, MIN_CLADE_DAYS, type FieldStat, type FieldStats } from "../data/field";
import { cladeGroup } from "../data/clades";
import type { GameId } from "../data/games";
import type { UsePlayer } from "../hooks/usePlayer";
import { Turnstile, captchaEnabled } from "./Turnstile";
import { randomSpeciesName } from "../data/speciesNames";

function SyncBar({ player }: { player: UsePlayer }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"register" | "login">("register");
  // Register: the handle is chosen for you (a creature name) and locked — you
  // rename yourself later in Account. Login: you type the name you registered.
  const [regName, setRegName] = useState(randomSpeciesName);
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [token, setToken] = useState<string | null>(null);
  // Bumped after each attempt to remount the widget for a fresh, single-use token.
  const [capKey, setCapKey] = useState(0);
  const blocked = captchaEnabled && !token;
  const resetCaptcha = () => { setToken(null); setCapKey((k) => k + 1); };

  const doRegister = async () => {
    if (blocked || !p) return;
    await player.signUp(regName, p, token ?? undefined);
    resetCaptcha();
  };
  const doLogin = async () => {
    if (blocked || !u.trim() || !p) return;
    await player.signIn(u, p, token ?? undefined);
    resetCaptcha();
  };

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
          <div className="sync-tabs" role="tablist">
            <button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "is-on" : ""} onClick={() => setMode("register")}>Create account</button>
            <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "is-on" : ""} onClick={() => setMode("login")}>Log in</button>
          </div>

          {mode === "register" ? (
            <>
              <p>Carry your stats to other devices. Just a creature name and a password, nothing else.</p>
              <div className="admin-login-fields">
                <div className="sync-handle">
                  <input type="text" value={regName} readOnly aria-label="Your creature name (assigned)" />
                  <button type="button" className="sync-reroll" title="Shuffle name" aria-label="Shuffle name" onClick={() => setRegName(randomSpeciesName())}>🎲</button>
                </div>
                <input type="password" autoComplete="new-password" placeholder="password" value={p} onChange={(e) => setP(e.target.value)} />
              </div>
              <p className="stats-sync-note">You'll be <b>{regName}</b>. Rename yourself anytime in Account, and note it to log in elsewhere.</p>
              <p className="stats-sync-warn">There's no password recovery, so pick one you'll remember.</p>
              <Turnstile key={capKey} onToken={setToken} />
              <div className="stats-sync-actions">
                <button className="admin-rand" disabled={blocked} onClick={doRegister}>Create account</button>
                <button className="linkbtn" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p>Log in with the name and password you created.</p>
              <div className="admin-login-fields">
                <input type="text" autoComplete="username" placeholder="your creature name" value={u} onChange={(e) => setU(e.target.value)} />
                <input type="password" autoComplete="current-password" placeholder="password" value={p} onChange={(e) => setP(e.target.value)} />
              </div>
              <Turnstile key={capKey} onToken={setToken} />
              <div className="stats-sync-actions">
                <button className="admin-rand" disabled={blocked} onClick={doLogin}>Log in</button>
                <button className="linkbtn" onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </>
          )}
          {player.error && <p className="admin-authmsg is-err">{player.error}</p>}
        </div>
      )}
    </div>
  );
}

/** Per-clade rows whose bar length encodes the primary metric (points for daily,
 *  win% for practice), so the strongest groups read at a glance. When vs-field data
 *  is available, each daily row also carries how that clade compares to everyone
 *  else who played those days. */
function GroupBars({ groups, metric, strengthId, field }: {
  groups: (GroupScore | GroupWin)[];
  metric: "points" | "winpct" | "field";
  strengthId?: string | null;
  field?: Record<string, FieldStat>;
}) {
  const pctOf = (g: GroupScore | GroupWin) => field?.[g.id]?.pct ?? 0;
  const valueOf = (g: GroupScore | GroupWin) =>
    metric === "points" ? (g as GroupScore).avgPoints : metric === "field" ? pctOf(g) : g.winPct;
  // A vs-field value is signed, so its bars diverge from a midline and scale to the
  // largest swing in either direction; the other metrics start at zero and grow right.
  const max = Math.max(1, ...groups.map((g) => (metric === "field" ? Math.abs(valueOf(g)) : valueOf(g))));

  return (
    <div className={`stats-clades${metric === "field" ? " is-signed" : ""}`}>
      {groups.map((g) => {
        const val = valueOf(g);
        const isStrength = g.id === strengthId;
        const f = field?.[g.id];
        // Half the track per side, so a full-length bar is the biggest swing shown.
        const half = (Math.abs(val) / max) * 50;
        return (
          <div className={`clade-row${isStrength ? " is-strength" : ""}`} key={g.id}>
            <span className="clade-ico">{g.icon}</span>
            <span className="clade-name">{g.label}{isStrength && <span className="clade-star">★</span>}</span>
            <div className="clade-track">
              {metric === "field" ? (
                <div
                  className={`clade-bar${val < 0 ? " is-neg" : ""}`}
                  style={{ width: `${half}%`, marginLeft: `${val < 0 ? 50 - half : 50}%` }}
                />
              ) : (
                <div className="clade-bar" style={{ width: `${(val / max) * 100}%` }} />
              )}
            </div>
            {metric === "points" ? (
              <>
                <span className="clade-pct">{(g as GroupScore).avgPoints}p<span className="clade-unit"> avg</span></span>
                <span className="clade-meta">{(g as GroupScore).totalPoints}p total · {g.wins}/{g.played}</span>
              </>
            ) : metric === "field" ? (
              <>
                <span className={`clade-pct ${fieldClass(f?.pct ?? 0)}`}>{f ? fmtFieldPct(f.pct) : "—"}</span>
                <span className="clade-meta">
                  {f ? `${f.games} ${f.games === 1 ? "game" : "games"}` : "no field"}
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

/** Above / below / level with the field, for colour. */
const fieldClass = (pct: number) => `vs-field${pct > 0 ? " is-up" : pct < 0 ? " is-down" : ""}`;

/** The vs-field tile: how this player scored against everyone who played, over the
 *  days they played. Absent (not zero) when there's no field data to compare to. */
function FieldTile({ stat, played, label = "Vs field" }: { stat: FieldStat | null; played: number; label?: string }) {
  if (!stat) return null;
  // No count normally: the Played tile sits right beside this one and says the same
  // thing. It's printed only when the two DIFFER, which happens when a day's field
  // was too thin to compare — otherwise the figure would silently cover fewer games
  // than the tile next door implies.
  const skipped = stat.games < played;
  return (
    <div className="stat">
      <b className={fieldClass(stat.pct)}>{fmtFieldPct(stat.pct)}</b>
      <span>{label}{skipped ? ` · ${stat.games} of ${played}` : ""}</span>
    </div>
  );
}

/** Says WHY a vs-field number is missing, when field data arrived but none of this
 *  player's days carried a big enough field to compare against. Silent when there's
 *  no field data at all (no backend, or field.sql not run): that's an operator
 *  problem rather than a player one, and the admin health page reports it. Without
 *  this, an absent tile and a broken migration look identical from here. */
function FieldNote({ field, stat }: { field: FieldStats | null; stat: FieldStat | null }) {
  if (!field || stat) return null;
  return (
    <p className="stats-strength">
      <span className="stats-strength-note">
        No vs-field figure yet: comparing needs a day that at least three players recorded.
      </span>
    </p>
  );
}

/** The account header: cross-device sync (or the local-only note). Its own panel
 *  so each game's stats can sit directly above that game's badges below. */
export function SyncPanel({ player }: { player: UsePlayer }) {
  return (
    <div className="stats">
      <SyncBar player={player} />
    </div>
  );
}

/** The daily line every ranked game shares, plus the flawless count for the games
 *  that have one (it's what the ✨ badge is counting, so it was worth surfacing). */
function DailyNums({ s, flawless, field }: {
  s: { points: { total: number; avg: number; best: number }; currentStreak: number; maxStreak: number; played: number; winPct: number };
  flawless?: number | null;
  field?: FieldStat | null;
}) {
  return (
    <div className="stats-nums">
      <div className="stat"><b>{s.points.total}</b><span>Total points</span></div>
      <div className="stat"><b>{s.points.avg}</b><span>Avg / game</span></div>
      <FieldTile stat={field ?? null} played={s.played} />
      <div className="stat"><b>{s.points.best}</b><span>Best game</span></div>
      <div className="stat"><b>{s.currentStreak}</b><span>Streak</span></div>
      <div className="stat"><b>{s.maxStreak}</b><span>Max streak</span></div>
      <div className="stat"><b>{s.played}</b><span>Played · {s.winPct}% won</span></div>
      {flawless != null && <div className="stat"><b>{flawless}</b><span>Flawless</span></div>}
    </div>
  );
}

/** The line under the clade bars naming the clade you're strongest in. It ALWAYS
 *  says something: it used to render nothing at all when no clade had enough games,
 *  which read as "this doesn't exist" rather than "not yet".
 *
 *  Preferred measure is vs-field (how you did against everyone else on those days,
 *  which is what "best at" really means); without field data it falls back to your
 *  own points-per-game average, and says which one it used either way. */
function BestClade({ daily, field }: { daily: DerivedStats["daily"]; field: FieldStats | null }) {
  const bestField = field?.bestCladeId ? field.byClade[field.bestCladeId] : null;
  if (field?.bestCladeId && bestField) {
    return (
      <p className="stats-strength">
        Strongest clade: <b>{cladeGroup(field.bestCladeId).label}</b>{" "}
        <span className={fieldClass(bestField.pct)}>{fmtFieldPct(bestField.pct)} vs field</span>
        <span className="stats-strength-note">
          {" "}Measured against everyone who played those days, failed days included, over the
          clades you've played at least {MIN_CLADE_DAYS} of.
        </span>
      </p>
    );
  }
  if (daily.strengthId) {
    return (
      <p className="stats-strength">
        Best average, {STRENGTH_MIN_GAMES}+ games: <b>{daily.groups.find((g) => g.id === daily.strengthId)?.label}</b>
        <span className="stats-strength-note">
          {" "}Ranked on your points per game, so a clade you've played once or twice can show a
          higher average without qualifying.
        </span>
      </p>
    );
  }
  const most = [...daily.groups].sort((a, b) => b.played - a.played)[0];
  return (
    <p className="stats-strength">
      No strongest clade yet.
      <span className="stats-strength-note">
        {" "}It needs {STRENGTH_MIN_GAMES} dailies in one clade
        {most ? `; your most played is ${most.label} with ${most.played}.` : "."}
      </span>
    </p>
  );
}

/** The Overall tab: the three games' local totals side by side (there's no combined
 *  local score, so this is a sum, not a rank), plus the one comparative number that
 *  spans every game. */
export function OverallStatsPanel({ stats, field }: { stats: DerivedStats; field: FieldStats | null }) {
  const games = [stats.daily, stats.kinship, stats.branches];
  const points = games.reduce((s, g) => s + g.points.total, 0);
  const played = games.reduce((s, g) => s + g.played, 0);
  const wins = games.reduce((s, g) => s + g.wins, 0);

  return (
    <div className="stats">
      <div className="stats-sub">All games · daily</div>
      {played === 0 ? (
        <p className="stats-empty">Play any daily to start scoring. Each game keeps its own points, streak and badges; this adds them up.</p>
      ) : (
        <div className="stats-nums">
          <div className="stat"><b>{points}</b><span>Total points</span></div>
          <div className="stat"><b>{played}</b><span>Played · {Math.round((wins / played) * 100)}% won</span></div>
          <FieldTile stat={field?.overall ?? null} played={played} />
          <div className="stat"><b>{stats.daily.currentStreak}</b><span>Lineage streak</span></div>
          <div className="stat"><b>{stats.kinship.currentStreak}</b><span>Kinship streak</span></div>
          <div className="stat"><b>{stats.branches.currentStreak}</b><span>Branches streak</span></div>
        </div>
      )}
      {field?.overall ? (
        <p className="stats-strength">
          <span className="stats-strength-note">
            Vs field compares your score to the average of everyone who played that day, pooled
            across all three games. A day anyone failed counts as the zero it scored, yours
            included, so a day the field found hard is worth more than an easy one.
          </span>
        </p>
      ) : (
        played > 0 && <FieldNote field={field} stat={null} />
      )}
    </div>
  );
}

const EMPTY: Record<GameId, string> = {
  lineage: "Play a daily to start scoring. Points reward harder days, fewer guesses, and no hints.",
  kinship: "Play the daily Kinship grid to start scoring. Fewer mistakes score more; a clean board earns the full weight.",
  branches: "Play the daily Branches board to start scoring. Correct placements score; hints, peeks and mistakes trim it.",
};
const TITLE: Record<GameId, string> = { lineage: "Lineage", kinship: "Kinship", branches: "Branches" };

/** One game's daily stats. Lineage additionally carries its per-clade scoring and
 *  its free-play practice tally (practice exists only for Lineage), so everything
 *  about a game sits in one block, above that game's badges. */
export function GameStatsPanel({ stats, field, game }: { stats: DerivedStats; field: FieldStats | null; game: GameId }) {
  const { daily, practice, kinship, branches } = stats;
  const s = game === "lineage" ? daily : game === "kinship" ? kinship : branches;
  const flawless = game === "lineage" ? null : (s as typeof kinship).flawless;
  // Which reading of the clade bars is showing. Defaults to vs-field when there is
  // one: it's the more informative of the two, and the other is a click away.
  const [cladeMetric, setCladeMetric] = useState<"points" | "field">("field");
  const cladeField = !!field && Object.keys(field.byClade).length > 0;

  return (
    <div className="stats">
      <div className="stats-sub">{TITLE[game]} · daily</div>
      {s.played === 0 ? (
        <p className="stats-empty">{EMPTY[game]}</p>
      ) : (
        <>
          <DailyNums s={s} flawless={flawless} field={field?.byGame[game]} />
          <FieldNote field={field} stat={field?.byGame[game] ?? null} />
        </>
      )}

      {/* Per-clade daily scoring — Lineage only (the other games' categories are
          per-board, not persistent). */}
      {game === "lineage" && daily.groups.length > 0 && (
        <>
          <div className="stats-dist-hd">
            <span className="stats-dist-ttl">By clade</span>
            {/* Two ways to read the same clades: your own scoring, or how it compared
                to everyone else's. The toggle only appears once there's a field to
                compare against. */}
            {cladeField ? (
              <div className="lb-segs" role="tablist" aria-label="Clade metric">
                <button role="tab" aria-selected={cladeMetric === "points"} className={`lb-seg${cladeMetric === "points" ? " is-on" : ""}`} onClick={() => setCladeMetric("points")}>Avg score</button>
                <button role="tab" aria-selected={cladeMetric === "field"} className={`lb-seg${cladeMetric === "field" ? " is-on" : ""}`} onClick={() => setCladeMetric("field")}>Vs field</button>
              </div>
            ) : (
              <span className="stats-dist-note">avg score</span>
            )}
          </div>
          <GroupBars
            groups={daily.groups}
            metric={cladeField ? cladeMetric : "points"}
            strengthId={field?.bestCladeId ?? daily.strengthId}
            field={field?.byClade}
          />
          <BestClade daily={daily} field={field} />
        </>
      )}

      {/* Practice is Lineage free play: self-chosen difficulty, so unranked and
          unscored — win-rate by group only. */}
      {game === "lineage" && (
        <>
          <div className="stats-sub stats-sub-2">Practice · free play</div>
          {practice.played === 0 ? (
            <p className="stats-empty">Free-play rounds show up here. Practice is unranked, so it isn't scored, just win-rate by group.</p>
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
        </>
      )}
    </div>
  );
}
