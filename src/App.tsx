import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "./hooks/useGame";
import { informedPar } from "./core";
import { groupOf } from "./data/clades";
import { useStats } from "./hooks/useStats";
import { usePlayer } from "./hooks/usePlayer";
import { recordGame, fetchPlayerBadges, recordGridGame, recordBranchesGame } from "./data/games";
import { newDailyWins } from "./data/badges";
import { kinshipRevealPenalty } from "./data/score";
import { todayKey, dailyNumber } from "./core/daily";
import { dailyAnswerFor } from "./data/dailySchedule";
import { loadStore } from "./data/stats";
import { primePinnedPuzzles, pinnedPuzzleCached } from "./data/pinnedPuzzles";
import { SettingsPanel } from "./ui/SettingsPanel";
import { GuessInput } from "./ui/GuessInput";
import { ResultCard } from "./ui/ResultCard";
import { Cladogram } from "./ui/Cladogram";
import { ShareCard } from "./ui/ShareCard";
import { LeaderboardNudge } from "./ui/LeaderboardNudge";
import { LeaderboardPanel } from "./ui/LeaderboardPanel";
import { AccountPanel } from "./ui/AccountPanel";
import { AboutPanel } from "./ui/AboutPanel";
import { AdminPanel } from "./ui/AdminPanel";
import { GridGame } from "./ui/GridGame";
import { BranchesGame } from "./ui/BranchesGame";
import { GameHeader } from "./ui/GameHeader";
import { HomePanel } from "./ui/HomePanel";
import { Leaderboard } from "./ui/Leaderboard";
import { CombinedLeaderboard } from "./ui/CombinedLeaderboard";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import type { GridComplete } from "./hooks/useGridGame";
import type { BranchesComplete } from "./hooks/useBranchesGame";
import { RESOLUTION_PRESETS, SCOPE_PRESETS } from "./data/presets";
import { useTheme } from "./data/theme";
import logoUrl from "../logo.png";

// The admin route lives behind a build-time env var so the real path is never in
// the source (only this "admin" dev fallback is). Set VITE_ADMIN_ROUTE to an
// obscure string in production. NB: this is defence-in-depth only — the actual
// protection is is_admin() + the admin password; the value is still present in
// the compiled bundle, just not in git.
const ADMIN_HASH = `#${import.meta.env.VITE_ADMIN_ROUTE ?? "admin"}`;
// The real protection is is_admin() + the admin password; the route is just
// obscurity. So in DEV builds we also honour plain "#admin" — a rotated or
// mistyped VITE_ADMIN_ROUTE can't lock you out of local testing. Production
// builds match ONLY the configured route.
const isAdminHash = (h: string) => h === ADMIN_HASH || (import.meta.env.DEV && h === "#admin");

export default function App() {
  const player = usePlayer();
  const [theme, toggleTheme] = useTheme();
  const userId = player.session?.user.id ?? null;
  const g = useGame(userId);
  // The daily is deterministic, so a past date's clade group is recomputable —
  // lets per-clade daily stats include games recorded before groups were stored.
  const tree = g.tree;
  // A past date's answer, preferring the FROZEN pin over the generator: after a
  // content/seeding change the generator would recompute a different species for
  // an old date, mislabelling history. `pinEpoch` bumps once the pins for the
  // relevant dates are primed, so these memoised lookups re-run against them.
  const [pinEpoch, setPinEpoch] = useState(0);
  const answerIdFor = useCallback(
    (dateKey: string): string | null => {
      if (!tree) return null;
      const pin = pinnedPuzzleCached("lineage", dateKey);
      return pin ? pin.answerId : dailyAnswerFor(tree, dateKey);
    },
    [tree, pinEpoch]
  );
  const dailyGroupOf = useCallback(
    (dateKey: string): string | null => {
      const id = answerIdFor(dateKey);
      return tree && id ? groupOf(tree, id) : null;
    },
    [tree, answerIdFor]
  );
  // The answer species for a past date — shown on that day's leaderboard. Callers
  // only use it for finished days, never today's puzzle.
  const dailyAnswerOf = useCallback(
    (dateKey: string): { name: string; sci: string } | null => {
      const id = answerIdFor(dateKey);
      const node = tree && id ? tree.byId.get(id) : null;
      return node ? { name: node.common ?? node.sciName, sci: node.sciName } : null;
    },
    [tree, answerIdFor]
  );
  const { stats, record, recordKinship, recordBranches } = useStats(userId, dailyGroupOf);

  // Prime the frozen pins for the past dates these lookups touch — the player's
  // local Lineage history, plus a recent window for the admin leaderboard preview.
  useEffect(() => {
    if (!tree) return;
    const dates = new Set<string>(Object.keys(loadStore().history));
    const t = Date.parse(`${todayKey()}T00:00:00Z`);
    for (let i = 1; i <= 120; i++) dates.add(new Date(t - i * 86_400_000).toISOString().slice(0, 10));
    let live = true;
    primePinnedPuzzles("lineage", [...dates]).then((added) => { if (live && added) setPinEpoch((v) => v + 1); });
    return () => { live = false; };
  }, [tree, stats]);
  const [view, setView] = useState<"home" | "lineage" | "kinship" | "branches" | "leaderboard" | "account" | "about">("home");
  // A section id for the About page to scroll to — set when a game page's
  // "How this works" link is clicked, cleared when About is opened from the nav.
  const [aboutFocus, setAboutFocus] = useState<string | null>(null);
  const openAbout = (section: string) => { setAboutFocus(section); setView("about"); };
  // Bumped once a finished game's server write resolves, so the post-game board
  // refetches and includes the row just submitted (instead of racing the write).
  const [boardReload, setBoardReload] = useState(0);
  // Same idea for the Kinship board after a grid result is submitted.
  const [kinBoardReload, setKinBoardReload] = useState(0);
  // Same idea for the Branches board after a result is submitted.
  const [branchBoardReload, setBranchBoardReload] = useState(0);
  // Which game's rankings the Leaderboard tab is showing ("combined" = all three,
  // normalised into one daily total).
  const [lbGame, setLbGame] = useState<"combined" | "lineage" | "kinship" | "branches">("combined");
  // Daily-winner celebration: on sign-in, fetch the player's recent winning days
  // and surface any not yet shown on this device (see newDailyWins for baseline).
  const [winNudge, setWinNudge] = useState<string[]>([]);
  const [hash, setHash] = useState(() => window.location.hash);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Record a finished Kinship board (ranked, once per date): local stat + streak
  // always; a signed-in player also gets a durable leaderboard row, then the
  // post-game board refetches to include it.
  const recordKinshipResult = useCallback(
    (r: GridComplete) => {
      // Picture peeks are folded into the mistakes total the score runs on, so the
      // client and the server (which only sees `mistakes`) stay in agreement.
      const scoreMistakes = Math.min(4, r.mistakes + kinshipRevealPenalty(r.reveals));
      recordKinship({ status: r.won ? "won" : "lost", mistakes: scoreMistakes, tier: r.tier });
      if (player.session) {
        void recordGridGame({ puzzleDate: r.date, won: r.won, mistakes: scoreMistakes }).then(() =>
          setKinBoardReload((c) => c + 1)
        );
      }
    },
    [recordKinship, player.session]
  );

  // Record a finished Branches board: local stat + streak always; a signed-in
  // player also gets a durable leaderboard row, then the post-game board refetches.
  const recordBranchesResult = useCallback(
    (r: BranchesComplete) => {
      recordBranches({ won: r.won, correct: r.correct, total: r.total, hinted: r.hinted, peeked: r.peeked, tier: r.tier });
      if (player.session) {
        void recordBranchesGame({
          puzzleDate: r.date, won: r.won, correct: r.correct, total: r.total, hinted: r.hinted, peeked: r.peeked,
        }).then(() => setBranchBoardReload((c) => c + 1));
      }
    },
    [recordBranches, player.session]
  );

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

  if (isAdminHash(hash)) return <ErrorBoundary label="Curator page"><AdminPanel tree={g.tree} /></ErrorBoundary>;

  const answer = g.tree.byId.get(g.answerId)!;
  const today = new Date().toISOString().slice(0, 10);

  const scopeLabel = SCOPE_PRESETS.find((s) => s.id === g.config.scopeRootId)?.label ?? "All life";
  const resLabel = RESOLUTION_PRESETS.find((r) => r.winWithin === g.config.winWithin)?.label ?? "";

  const eyebrow =
    view === "home" ? "Daily games on the tree of life" :
    view === "kinship" ? `Kinship · №${dailyNumber(today)}` :
    view === "branches" ? `Branches · №${dailyNumber(today)}` :
    view === "leaderboard" ? "Leaderboard" :
    view === "account" ? "Your account" :
    view === "about" ? "About Grebe" :
    daily ? `Lineage · №${dailyNumber(today)}` : "Lineage · free play";

  const subtitle =
    view === "home"
      ? "Daily puzzles on the tree of life."
      : view === "kinship"
      ? "Sort sixteen species into the four clades they belong to."
      : view === "branches"
      ? "Rebuild a slice of the tree: place each species on its correct branch."
      : view === "lineage"
      ? "Guess the organism. Every miss tells you where you branched apart."
      : "Daily puzzles on the tree of life.";

  const play = (
    <>
      <GameHeader
        game="lineage"
        tier={daily ? g.daily.tier : undefined}
        dayName={daily ? g.daily.dayName : undefined}
        difficulty={daily ? g.daily.difficulty : undefined}
        meta={daily ? undefined : "Free play"}
        onHowItWorks={() => openAbout("about-lineage")}
        blurb="Guess the organism. Every miss tells you where you branched apart."
      />
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

      {daily && (
        <p className="lineage-setup">
          <span className="lineage-setup-line">
            Tree rooted at <b>{scopeLabel.replace(/\s+only$/i, "")}</b> · a win counts at{" "}
            <b>{resLabel.toLowerCase()}</b> · assist <b>{g.assist ? "on" : "off"}</b>
          </span>
          <span className="lineage-setup-note">
            Scope is where the tree starts, and a win is how close your guess must land.
            {g.assist ? " Assist limits your guesses to the best branch you've reached so far." : ""}
          </span>
        </p>
      )}

      {!daily && (
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
          hidden species, so closer guesses branch off <em>lower down</em>. Not sure of a species?
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
          {daily && <p className="daily-lock">✓ You’ve played today’s Lineage. Come back tomorrow for a new puzzle.</p>}
          {/* Show where you landed among everyone right after a daily. */}
          {daily && player.configured && <LeaderboardPanel me={boardName} variant="today" canPreview={player.isAdmin} reloadKey={boardReload} streak={stats.daily.currentStreak} />}
          {daily && <LeaderboardNudge show={player.configured && !player.session} />}
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
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          title={theme === "dark" ? "Light mode" : "Dark mode"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <div className="masthead-text">
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="title">Grebe</h1>
          <div className="subtitle">{subtitle}</div>
        </div>
        <img className="masthead-logo" src={logoUrl} alt="" aria-hidden="true" />
      </header>

      <div className="beta-banner" role="note">
        <span className="beta-tag">Beta</span>
        <span>In testing. Scores and leaderboards may reset before the full launch.</span>
      </div>

      <nav className="topnav" role="tablist" aria-label="Sections">
        {(["home", "lineage", "kinship", "branches", "leaderboard", "account", "about"] as const).map((v) => {
          if (v === "account" && !player.configured) return null;
          const labels = { home: "Home", lineage: "Lineage", kinship: "Kinship", branches: "Branches", leaderboard: "Leaderboard", account: "Account", about: "About" };
          return (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`topnav-tab${view === v ? " is-on" : ""}`}
              onClick={() => { if (v === "about") setAboutFocus(null); setView(v); }}
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
              ? <>You topped the daily: <b>№{dailyNumber(winNudge[0])}</b> ({winNudge[0]}). Daily-winner badge earned.</>
              : <>You topped <b>{winNudge.length}</b> recent dailies. Daily-winner badge earned.</>}
          </span>
          <button className="winbanner-x" onClick={() => setWinNudge([])} aria-label="Dismiss">×</button>
        </div>
      )}

      {view === "home" && <HomePanel onPlay={(v) => setView(v)} />}
      {view === "lineage" && <div className="gameview" data-game="lineage">{play}</div>}
      {view === "kinship" && (
        <div className="gameview" data-game="kinship">
          <GridGame
            tree={g.tree}
            streak={stats.kinship.currentStreak}
            onComplete={recordKinshipResult}
            me={boardName}
            configured={player.configured}
            reloadKey={kinBoardReload}
            onHowItWorks={() => openAbout("about-kinship")}
          />
        </div>
      )}
      {view === "branches" && (
        <div className="gameview" data-game="branches">
          <BranchesGame
            tree={g.tree}
            onComplete={recordBranchesResult}
            onHowItWorks={() => openAbout("about-branches")}
            me={boardName}
            configured={player.configured}
            reloadKey={branchBoardReload}
            streak={stats.branches.currentStreak}
          />
        </div>
      )}
      {view === "leaderboard" && (
        <>
          <div className="lb-gametabs" role="tablist" aria-label="Leaderboard game">
            <button role="tab" aria-selected={lbGame === "combined"} className={`lb-seg${lbGame === "combined" ? " is-on" : ""}`} onClick={() => setLbGame("combined")}>🏆 Combined</button>
            <button role="tab" aria-selected={lbGame === "lineage"} className={`lb-seg${lbGame === "lineage" ? " is-on" : ""}`} onClick={() => setLbGame("lineage")}>🧬 Lineage</button>
            <button role="tab" aria-selected={lbGame === "kinship"} className={`lb-seg${lbGame === "kinship" ? " is-on" : ""}`} onClick={() => setLbGame("kinship")}>🧩 Kinship</button>
            <button role="tab" aria-selected={lbGame === "branches"} className={`lb-seg${lbGame === "branches" ? " is-on" : ""}`} onClick={() => setLbGame("branches")}>🌿 Branches</button>
          </div>
          {lbGame === "combined" ? (
            <CombinedLeaderboard me={boardName} />
          ) : lbGame === "lineage" ? (
            <>
              <LeaderboardPanel me={boardName} variant="today" canPreview={player.isAdmin} streak={stats.daily.currentStreak} />
              <LeaderboardPanel me={boardName} variant="config" canPreview={player.isAdmin} answerForDate={dailyAnswerOf} streak={stats.daily.currentStreak} />
            </>
          ) : lbGame === "kinship" ? (
            <>
              <Leaderboard game="kinship" label="Kinship" me={boardName} variant="today" streak={stats.kinship.currentStreak} note="Score rewards harder days and fewer mistakes. A clean board earns the full weight." />
              <Leaderboard game="kinship" label="Kinship" me={boardName} variant="config" streak={stats.kinship.currentStreak} note="Score rewards harder days and fewer mistakes. A clean board earns the full weight." />
            </>
          ) : (
            <>
              <Leaderboard game="branches" label="Branches" me={boardName} variant="today" streak={stats.branches.currentStreak} note="Score rewards harder days and correct placements. Hints and peeks trim it." />
              <Leaderboard game="branches" label="Branches" me={boardName} variant="config" streak={stats.branches.currentStreak} note="Score rewards harder days and correct placements. Hints and peeks trim it." />
            </>
          )}
        </>
      )}
      {view === "account" && <AccountPanel stats={stats} player={player} />}
      {view === "about" && <AboutPanel focus={aboutFocus} />}
    </div>
  );
}
