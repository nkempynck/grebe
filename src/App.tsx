import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "./hooks/useGame";
import { informedPar } from "./core";
import { groupOf } from "./data/clades";
import { useStats } from "./hooks/useStats";
import { usePlayer } from "./hooks/usePlayer";
import { recordGame } from "./data/games";
import { todayKey, dailyNumber } from "./core/daily";
import { SettingsPanel } from "./ui/SettingsPanel";
import { GuessInput } from "./ui/GuessInput";
import { ResultCard } from "./ui/ResultCard";
import { Cladogram } from "./ui/Cladogram";
import { ShareCard } from "./ui/ShareCard";
import { LeaderboardPanel } from "./ui/LeaderboardPanel";
import { AccountPanel } from "./ui/AccountPanel";
import { AboutPanel } from "./ui/AboutPanel";
import { AdminPanel } from "./ui/AdminPanel";
import { RESOLUTION_PRESETS, SCOPE_PRESETS } from "./data/presets";

export default function App() {
  const player = usePlayer();
  const userId = player.session?.user.id ?? null;
  const g = useGame(userId);
  const { stats, record } = useStats(userId);
  const [view, setView] = useState<"play" | "leaderboard" | "account" | "about">("play");
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const daily = g.mode === "daily";
  const roundOver = g.status !== "playing";
  // The name shown/highlighted on the leaderboard (edited display name, else login).
  const boardName = player.displayName ?? player.username;

  // Record each finished game once (per mode+answer), tagged with its clade
  // group. Daily results also pop the stats panel open.
  const recordedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!roundOver || !g.tree || !g.answerId) return;
    // A restored (already-played) daily is already recorded — don't count it again.
    if (daily && g.dailyLocked) return;
    const key = `${g.mode}:${g.answerId}:${g.status}`;
    if (recordedKey.current === key) return;
    recordedKey.current = key;
    const group = groupOf(g.tree, g.answerId);
    record(g.mode, group, {
      status: g.status === "won" ? "won" : "gaveup",
      guesses: g.guesses.length,
      hints: g.hintIds.length,
      tier: g.daily.tier,
    });
    // Signed-in players also get a durable per-game row (for stats/leaderboards).
    if (player.session) {
      void recordGame({
        userId: player.session.user.id,
        puzzleDate: daily ? todayKey() : null,
        mode: g.mode,
        scopeId: g.config.scopeRootId,
        cladeGroup: group,
        guesses: g.guesses.length,
        hints: g.hintIds.length,
        won: g.status === "won",
        tier: daily ? g.daily.tier : null,
        guessIds: g.guesses.map((r) => r.guess.id),
        hintIds: g.hintIds,
      });
    }
  }, [roundOver, daily, g.dailyLocked, g.mode, g.tree, g.answerId, g.status, g.guesses, g.hintIds, g.daily.tier, g.config.scopeRootId, player.session, record]);

  // Informed-solver "par" for the finished puzzle (cheap; only when it's over).
  const par = useMemo(
    () => (roundOver && g.tree && g.answerId ? informedPar(g.tree, g.config, g.answerId, g.assist) : null),
    [roundOver, g.tree, g.answerId, g.config.scopeRootId, g.config.winWithin, g.assist]
  );

  if (g.error && !g.tree) {
    return <div className="wrap"><p className="empty">Couldn't load the tree: {g.error}</p></div>;
  }
  if (!g.tree || !g.answerId) {
    return <div className="wrap"><p className="empty">Growing the tree of life…</p></div>;
  }

  if (hash === "#admin") return <AdminPanel tree={g.tree} />;

  const answer = g.tree.byId.get(g.answerId)!;
  const today = new Date().toISOString().slice(0, 10);

  const scopeLabel = SCOPE_PRESETS.find((s) => s.id === g.config.scopeRootId)?.label ?? "All life";
  const resLabel = RESOLUTION_PRESETS.find((r) => r.winWithin === g.config.winWithin)?.label ?? "";

  const eyebrow =
    view === "leaderboard" ? "Leaderboard" :
    view === "account" ? "Your account" :
    view === "about" ? "About the data" :
    daily ? `Daily specimen №${dailyNumber(today)}` : "Free play";

  const play = (
    <>
      <div className="modeswitch" role="tablist" aria-label="Game mode">
        <button
          role="tab"
          aria-selected={daily}
          className={`modetab${daily ? " is-on" : ""}`}
          onClick={() => g.setMode("daily")}
        >
          <span className="modetab-ttl">Daily puzzle</span>
          <span className="modetab-sub">One specimen · shared by all</span>
        </button>
        <button
          role="tab"
          aria-selected={!daily}
          className={`modetab${!daily ? " is-on" : ""}`}
          onClick={() => g.setMode("free")}
        >
          <span className="modetab-ttl">Free play</span>
          <span className="modetab-sub">Your rules · reroll anytime</span>
        </button>
      </div>

      {daily ? (
        <div className="daily-rules">
          <span className="dr-diff">
            <span className="dr-dots" aria-hidden="true">
              {"●".repeat(g.daily.tier)}{"○".repeat(7 - g.daily.tier)}
            </span>
            {g.daily.dayName} · {g.daily.difficulty}
          </span>
          <span className="dr-cfg">
            {scopeLabel.replace(/\s+only$/i, "")} · {resLabel} · {g.assist ? "assist on" : "no assist"}
          </span>
        </div>
      ) : (
        <SettingsPanel
          config={g.config}
          onScope={g.setScope}
          onWinWithin={g.setWinWithin}
          assist={g.assist}
          onAssist={g.setAssist}
        />
      )}

      {g.guesses.length === 0 && g.hintIds.length === 0 && !roundOver ? (
        <p className="empty">
          No guesses yet. Each guess appears on the tree at the clade it shares with the
          hidden species — closer guesses branch off <em>lower down</em>. Not sure of a species?
          Guess a whole group like <em>snakes</em> or <em>beetles</em> to scout. Stuck? Take a hint.
        </p>
      ) : (
        <Cladogram
          tree={g.tree}
          scopeRootId={g.config.scopeRootId}
          results={g.guesses}
          answerId={g.answerId}
          hintIds={g.hintIds}
          revealed={roundOver}
        />
      )}

      {roundOver && (
        <>
          <ResultCard tree={g.tree} answer={answer} won={g.status === "won"} guessCount={g.guesses.length} streak={daily ? stats.currentStreak : null} par={par} />
          <ShareCard
            config={g.config}
            guesses={g.guesses}
            status={g.status === "won" ? "won" : "gaveup"}
            hintCount={g.hintIds.length}
            date={today}
            mode={g.mode}
            tier={daily ? g.daily.tier : null}
            streak={daily ? stats.currentStreak : null}
          />
          {/* Show where you landed among everyone right after a daily. */}
          {daily && player.configured && <LeaderboardPanel me={boardName} variant="today" canPreview={player.isAdmin} />}
        </>
      )}

      {/* Guess bar sits at the bottom, under the tree, and sticks to the viewport
          so it stays reachable as the tree grows above it. */}
      <div className="playbar">
        <GuessInput
          tree={g.tree}
          config={g.config}
          disabled={roundOver}
          onSubmit={g.submit}
          focusCladeId={g.assist ? g.focusCladeId : null}
          guesses={g.guesses}
        />
        <div className="errline">{g.error}</div>

        <div className="subactions">
          {!roundOver && (
            <button className="linkbtn" onClick={g.revealHint} disabled={!g.canHint}>
              {g.canHint ? "Hint: reveal next branch" : "No hint left"}
            </button>
          )}
          {!roundOver && <button className="linkbtn" onClick={g.giveUp}>Give up & reveal</button>}
          {!daily && <button className="linkbtn" onClick={g.newRandom}>New random specimen</button>}
        </div>
      </div>
    </>
  );

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="title">Grebe</h1>
        <div className="subtitle">Guess the organism. Every miss tells you where you branched apart.</div>
      </header>

      <nav className="topnav" role="tablist" aria-label="Sections">
        {(["play", "leaderboard", "account", "about"] as const).map((v) => {
          if (v === "account" && !player.configured) return null;
          const labels = { play: "Play", leaderboard: "Leaderboard", account: "Account", about: "About" };
          return (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`topnav-tab${view === v ? " is-on" : ""}`}
              onClick={() => setView(v)}
            >
              {labels[v]}
            </button>
          );
        })}
      </nav>

      {view === "play" && play}
      {view === "leaderboard" && (
        <>
          <LeaderboardPanel me={boardName} variant="today" canPreview={player.isAdmin} />
          <LeaderboardPanel me={boardName} variant="config" canPreview={player.isAdmin} />
        </>
      )}
      {view === "account" && <AccountPanel stats={stats} player={player} />}
      {view === "about" && <AboutPanel />}
    </div>
  );
}
