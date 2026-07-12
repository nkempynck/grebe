import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "./hooks/useGame";
import { informedPar } from "./core";
import { groupOf } from "./data/clades";
import { useStats } from "./hooks/useStats";
import { usePlayer } from "./hooks/usePlayer";
import { recordGame, fetchPlayerBadges } from "./data/games";
import { newDailyWins } from "./data/badges";
import { todayKey, dailyNumber, dailyAnswerId } from "./core/daily";
import { resolveDailyRules } from "./data/dailySchedule";
import { SettingsPanel } from "./ui/SettingsPanel";
import { GuessInput } from "./ui/GuessInput";
import { ResultCard } from "./ui/ResultCard";
import { Cladogram } from "./ui/Cladogram";
import { ShareCard } from "./ui/ShareCard";
import { LeaderboardPanel } from "./ui/LeaderboardPanel";
import { AccountPanel } from "./ui/AccountPanel";
import { AboutPanel } from "./ui/AboutPanel";
import { AdminPanel } from "./ui/AdminPanel";
import { GridGame } from "./ui/GridGame";
import { RESOLUTION_PRESETS, SCOPE_PRESETS } from "./data/presets";

export default function App() {
  const player = usePlayer();
  const userId = player.session?.user.id ?? null;
  const g = useGame(userId);
  // The daily is deterministic, so a past date's clade group is recomputable —
  // lets per-clade daily stats include games recorded before groups were stored.
  const tree = g.tree;
  const dailyGroupOf = useCallback(
    (dateKey: string): string | null => {
      if (!tree) return null;
      const rules = resolveDailyRules(dateKey);
      const answerId = rules.answerId ?? dailyAnswerId(tree, rules.config.scopeRootId, dateKey);
      return groupOf(tree, answerId);
    },
    [tree]
  );
  // The answer species for a past date (deterministic) — shown on that day's
  // leaderboard. Callers only use it for finished days, never today's puzzle.
  const dailyAnswerOf = useCallback(
    (dateKey: string): { name: string; sci: string } | null => {
      if (!tree) return null;
      const rules = resolveDailyRules(dateKey);
      const answerId = rules.answerId ?? dailyAnswerId(tree, rules.config.scopeRootId, dateKey);
      const node = tree.byId.get(answerId);
      return node ? { name: node.common ?? node.sciName, sci: node.sciName } : null;
    },
    [tree]
  );
  const { stats, record } = useStats(userId, dailyGroupOf);
  const [view, setView] = useState<"play" | "grid" | "leaderboard" | "account" | "about">("play");
  // Bumped once a finished game's server write resolves, so the post-game board
  // refetches and includes the row just submitted (instead of racing the write).
  const [boardReload, setBoardReload] = useState(0);
  // Daily-winner celebration: on sign-in, fetch the player's recent winning days
  // and surface any not yet shown on this device (see newDailyWins for baseline).
  const [winNudge, setWinNudge] = useState<string[]>([]);
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

  // Informed-solver "par" for the finished puzzle (cheap; only when it's over).
  // Computed here so the record effect can persist it with the game row.
  const par = useMemo(
    () => (roundOver && g.tree && g.answerId ? informedPar(g.tree, g.config, g.answerId, g.assist) : null),
    [roundOver, g.tree, g.answerId, g.config.scopeRootId, g.config.winWithin, g.assist]
  );

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
    // Only DAILY games get a durable cloud row (free play is tracked in stats
    // only). Descriptive detail (answer, assist, resolution, par) rides along but
    // never affects scoring. On resolve, bump boardReload to refetch the board.
    if (daily && player.session) {
      void recordGame({
        userId: player.session.user.id,
        puzzleDate: todayKey(),
        scopeId: g.config.scopeRootId,
        cladeGroup: group,
        won: g.status === "won",
        guessIds: g.guesses.map((r) => r.guess.id),
        hintIds: g.hintIds,
        answerId: g.answerId!,
        assist: g.assist,
        winWithin: g.config.winWithin,
        par,
      }).then(() => setBoardReload((c) => c + 1));
    }
  }, [roundOver, daily, g.dailyLocked, g.mode, g.tree, g.answerId, g.status, g.guesses, g.hintIds, g.daily.tier, g.config.scopeRootId, g.config.winWithin, g.assist, par, player.session, record]);

  useEffect(() => {
    if (!player.session) { setWinNudge([]); return; }
    let live = true;
    fetchPlayerBadges().then((b) => {
      if (!live || !b) return;
      const fresh = newDailyWins(b.win_dates ?? []);
      if (fresh.length) setWinNudge(fresh);
    });
    return () => { live = false; };
  }, [player.session]);

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
    view === "grid" ? "Daily grid" :
    view === "leaderboard" ? "Leaderboard" :
    view === "account" ? "Your account" :
    view === "about" ? "About Grebe" :
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
          <ResultCard tree={g.tree} answer={answer} won={g.status === "won"} guessCount={g.guesses.length} streak={daily ? stats.daily.currentStreak : null} par={par} />
          <ShareCard
            config={g.config}
            guesses={g.guesses}
            status={g.status === "won" ? "won" : "gaveup"}
            hintCount={g.hintIds.length}
            date={today}
            mode={g.mode}
            tier={daily ? g.daily.tier : null}
            streak={daily ? stats.daily.currentStreak : null}
          />
          {/* Show where you landed among everyone right after a daily. */}
          {daily && player.configured && <LeaderboardPanel me={boardName} variant="today" canPreview={player.isAdmin} reloadKey={boardReload} />}
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
        {(["play", "grid", "leaderboard", "account", "about"] as const).map((v) => {
          if (v === "account" && !player.configured) return null;
          const labels = { play: "Play", grid: "Grid", leaderboard: "Leaderboard", account: "Account", about: "About" };
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

      {winNudge.length > 0 && (
        <div className="winbanner" role="status">
          <span className="winbanner-ico" aria-hidden="true">👑</span>
          <span className="winbanner-txt">
            {winNudge.length === 1
              ? <>You topped the daily — <b>№{dailyNumber(winNudge[0])}</b> ({winNudge[0]}). Daily-winner badge earned.</>
              : <>You topped <b>{winNudge.length}</b> recent dailies. Daily-winner badge earned.</>}
          </span>
          <button className="winbanner-x" onClick={() => setWinNudge([])} aria-label="Dismiss">×</button>
        </div>
      )}

      {view === "play" && play}
      {view === "grid" && <GridGame tree={g.tree} />}
      {view === "leaderboard" && (
        <>
          <LeaderboardPanel me={boardName} variant="today" canPreview={player.isAdmin} />
          <LeaderboardPanel me={boardName} variant="config" canPreview={player.isAdmin} answerForDate={dailyAnswerOf} />
        </>
      )}
      {view === "account" && <AccountPanel stats={stats} player={player} />}
      {view === "about" && <AboutPanel />}
    </div>
  );
}
