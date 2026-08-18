import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "./hooks/useGame";
import { loadRichTree } from "./data/loadTaxonomy";
import { informedPar, type Tree } from "./core";
import { groupOf, boardGroupOf } from "./data/clades";
import { useStats } from "./hooks/useStats";
import { useFieldStats } from "./hooks/useFieldStats";
import { usePlayer } from "./hooks/usePlayer";
import { recordGame, recordGridGame, recordBranchesGame, fetchGameBadges, fetchOverallBadges, type GameId } from "./data/games";
import { enqueuePendingSubmit, loadPendingSubmits, clearPendingSubmits } from "./data/pendingSubmits";
import { catchUpCounts, countPlay } from "./data/playCount";
import { newDailyWins, type WinSource } from "./data/badges";
import { todayKey, dailyNumber, dailyLabel, isPreLaunch } from "./core/daily";
import { dailyAnswerFor, resolveDailyRules } from "./data/dailySchedule";
import { loadStore } from "./data/stats";
import { loadDailyProgress } from "./data/dailyProgress";
import { loadGridProgress } from "./data/gridProgress";
import { loadBranchesProgress } from "./data/branchesProgress";
import { branchesBoardFor } from "./data/branchesDaily";
import { branchesAllowance, hintCost, KINSHIP_FREE_REVEALS, LINEAGE_MAX_HINTS } from "./data/score";
import { branchesTally } from "./hooks/useBranchesGame";
import { primePinnedPuzzles, pinnedPuzzleCached, fetchPinnedPuzzle, branchesBoard as rebuildBranchesBoard } from "./data/pinnedPuzzles";
import { SettingsPanel } from "./ui/SettingsPanel";
import { GuessInput } from "./ui/GuessInput";
import { ResultCard } from "./ui/ResultCard";
import { Cladogram } from "./ui/Cladogram";
import { ShareCard } from "./ui/ShareCard";
import { LeaderboardNudge } from "./ui/LeaderboardNudge";
import { LeaderboardPanel } from "./ui/LeaderboardPanel";
import { DiscussionPanel } from "./ui/DiscussionPanel";
import { ReplyBell } from "./ui/ReplyBell";
import { AccountPanel } from "./ui/AccountPanel";
import { StatsTabs } from "./ui/StatsTabs";
// PROTOTYPE — a nav tab on this branch only, so it can be played. No stats, no leaderboard,
// no pinned puzzle, no persistence: none of those answer whether the game is any fun.
import { MosaicGame } from "./ui/MosaicGame";
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

/** The discussion-board announcement stops showing on this date (exclusive). A
 *  plain YYYY-MM-DD compare against todayKey(), which is the 09:00-Brussels day,
 *  so the banner disappears at a rollover rather than mid-session. Shipped
 *  2026-08-03; nothing to remove afterwards. */
const DISCUSSION_BANNER_UNTIL = "2026-08-11";

/** Lineage scoring change, Wed through Fri. Bounded at BOTH ends, and FROM is the
 *  rollover the SQL patch runs at, not the day the client ships: the prices aren't
 *  real until then, so a build that goes out early stays silent by itself rather
 *  than relying on the deploy being timed correctly. */
const SCORING_BANNER_FROM = "2026-08-05";
const SCORING_BANNER_UNTIL = "2026-08-08";

/** The top-level sections, in nav order. Also the allowlist for the remembered view
 *  below, so a stored value from an older build can't select a section that's gone. */
const VIEWS = ["home", "lineage", "kinship", "branches", "mosaic", "leaderboard", "stats", "account", "about"] as const;
type View = (typeof VIEWS)[number];
const VIEW_KEY = "grebe.view";

/** The games, in the order the sub-nav lists them. Still real top-level views, so a session
 *  that remembered "kinship" from an older build still opens Kinship. */
const GAME_VIEWS = ["lineage", "kinship", "branches", "mosaic"] as const;
type GameView = (typeof GAME_VIEWS)[number];
const GAME_KEY = "grebe.game";
const isGameView = (v: View): v is GameView => (GAME_VIEWS as readonly string[]).includes(v);

/** What the top row shows. "games" is a nav section, not a view: selecting it opens a game. */
const SECTIONS = ["home", "games", "leaderboard", "stats", "account", "about"] as const;

const GAME_ICONS: Record<GameView, string> = {
  lineage: "🧬", kinship: "🧩", branches: "🌿", mosaic: "🖼",
};

const SECTION_LABELS: Record<(typeof SECTIONS)[number] | GameView, string> = {
  home: "Home", games: "Games", leaderboard: "Leaderboard", stats: "Stats",
  account: "Account", about: "About",
  lineage: "Lineage", kinship: "Kinship", branches: "Branches", mosaic: "Mosaic",
};

const WIN_GAME_LABEL: Record<GameId, string> = { lineage: "Lineage", kinship: "Kinship", branches: "Branches" };

/** The celebration line for one source's newly-seen wins. Topping the combined
 *  board beats topping any single game, so it says so in its own words (and gets
 *  the 🏆 and the brighter banner); the three games share one wording, named. */
function winBannerText(source: WinSource, dates: string[]) {
  if (source === "overall") {
    return dates.length === 1 ? (
      <>You topped the combined board across all three games: <b>№{dailyNumber(dates[0])}</b> ({dates[0]}). Overall champion badge earned.</>
    ) : (
      <>You topped <b>{dates.length}</b> recent combined boards, across all three games. Overall champion badge earned.</>
    );
  }
  const label = WIN_GAME_LABEL[source];
  return dates.length === 1 ? (
    <>You topped the <b>{label}</b> daily: <b>№{dailyNumber(dates[0])}</b> ({dates[0]}). Daily-winner badge earned.</>
  ) : (
    <>You topped <b>{dates.length}</b> recent <b>{label}</b> dailies. Daily-winner badge earned.</>
  );
}

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
  // Kinship/Branches clade groups for days played before the group was tagged on the
  // entry (see stats.ts cladeScores). Both read the day's PINNED board: those boards
  // are generated from the rich tree, which the stats page doesn't load, but a board's
  // GROUP CLADES (families, genera) sit in the base tree, and boardGroupOf takes the
  // first id this tree knows. A day with no pin cached, or one built entirely of ids
  // the base tree lacks, resolves to null and stays out of the bars.
  const kinshipGroupOf = useCallback(
    (dateKey: string): string | null => {
      const pin = pinnedPuzzleCached("kinship", dateKey);
      if (!tree || !pin) return null;
      return boardGroupOf(tree, [...pin.groups.map((g) => g.cladeId), ...pin.tiles]);
    },
    [tree, pinEpoch]
  );
  const branchesGroupOf = useCallback(
    (dateKey: string): string | null => {
      const pin = pinnedPuzzleCached("branches", dateKey);
      if (!tree || !pin) return null;
      return boardGroupOf(tree, [pin.rootId, ...pin.groupIds, ...pin.leafIds]);
    },
    [tree, pinEpoch]
  );
  const groupResolvers = useMemo(
    () => ({ lineage: dailyGroupOf, kinship: kinshipGroupOf, branches: branchesGroupOf }),
    [dailyGroupOf, kinshipGroupOf, branchesGroupOf]
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
  const { stats, store, record, recordKinship, recordBranches } = useStats(userId, groupResolvers);
  // How this player scored against the field on the days they scored (public
  // per-day averages; null when there is no backend or field.sql has not run).
  const field = useFieldStats(store, groupResolvers);

  // Whether this device has played each of today's games (signed in or not) —
  // today's leaderboards are hidden until the viewer has played that game.
  const dayKey = todayKey();
  // Yesterday, for the discussion read window (boards stay readable one day on).
  const prevDayKey = new Date(Date.parse(`${dayKey}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const playedTodayLineage = stats.daily.playedDates.includes(dayKey);
  const playedTodayKinship = stats.kinship.playedDates.includes(dayKey);
  const playedTodayBranches = stats.branches.playedDates.includes(dayKey);
  const playedTodayAny = playedTodayLineage || playedTodayKinship || playedTodayBranches;
  // The combined board is earned by playing ANY of a day's three puzzles, so its
  // discussion unlocks on the union of the three played-date lists — matching what
  // has_played() allows for the 'combined' key on the server.
  const playedDatesAny = useMemo(
    () => [...new Set([...stats.daily.playedDates, ...stats.kinship.playedDates, ...stats.branches.playedDates])],
    [stats.daily.playedDates, stats.kinship.playedDates, stats.branches.playedDates]
  );

  // Prime the frozen pins for the past dates these lookups touch — the player's
  // local Lineage history, plus a recent window for the admin leaderboard preview.
  // Kinship and Branches are primed over the days this player actually played, which
  // is all their clade resolvers read (no 120-day window: nothing else looks those up).
  useEffect(() => {
    if (!tree) return;
    const saved = loadStore();
    const dates = new Set<string>(Object.keys(saved.history));
    const t = Date.parse(`${todayKey()}T00:00:00Z`);
    for (let i = 1; i <= 120; i++) dates.add(new Date(t - i * 86_400_000).toISOString().slice(0, 10));
    let live = true;
    const bump = (added: boolean) => { if (live && added) setPinEpoch((v) => v + 1); };
    primePinnedPuzzles("lineage", [...dates]).then(bump);
    primePinnedPuzzles("kinship", Object.keys(saved.kinship)).then(bump);
    primePinnedPuzzles("branches", Object.keys(saved.branches)).then(bump);
    return () => { live = false; };
  }, [tree, stats]);
  // Remembered for THIS TAB only (sessionStorage), so the reload that versionCheck
  // performs after a deploy puts the player back in the game they were in rather than
  // bouncing them to Home. A manual reload restores too; opening the site in a new tab
  // still starts at Home, which is why this isn't localStorage. Unknown or absent
  // value falls back to Home, so a renamed view can't strand anyone on a blank screen.

  // The discussion for whichever day a "By day" board is showing, so a reply from
  // last night is reachable the next morning. Bounded to the server's two-day read
  // window; older days get nothing rather than an error. Per game, keyed off that
  // game's own played-dates so the client lock matches what the server will allow.
  const discussionFor = useCallback(
    (game: "lineage" | "kinship" | "branches" | "combined", playedDates: string[]) =>
      (date: string) => {
        if (date > dayKey || date < prevDayKey) return null;
        return (
          <DiscussionPanel
            board={game}
            date={date}
            configured={player.configured}
            signedIn={!!player.session}
            played={playedDates.includes(date)}
            label={date === dayKey ? "today’s puzzle" : "that day’s puzzle"}
          />
        );
      },
    [dayKey, prevDayKey, player.configured, player.session]
  );

  const [view, setView] = useState<View>(() => {
    try {
      const saved = sessionStorage.getItem(VIEW_KEY);
      if (saved && (VIEWS as readonly string[]).includes(saved)) return saved as View;
    } catch {
      /* private mode */
    }
    return "home";
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(VIEW_KEY, view);
    } catch {
      /* private mode */
    }
  }, [view]);

  /** Which game the Games tab reopens. Remembered so leaving for the leaderboard and coming
   *  back does not dump you on a different game than the one you were mid-way through. */
  const [lastGame, setLastGame] = useState<GameView>(() => {
    try {
      const saved = sessionStorage.getItem(GAME_KEY);
      if (saved && (GAME_VIEWS as readonly string[]).includes(saved)) return saved as GameView;
    } catch {
      /* private mode */
    }
    return "lineage";
  });
  useEffect(() => {
    if (!isGameView(view)) return;
    setLastGame(view);
    try {
      sessionStorage.setItem(GAME_KEY, view);
    } catch {
      /* private mode */
    }
  }, [view]);
  // Kinship/Branches generate boards from the RICH tree (base + a quality-filtered
  // augment). It's lazy-loaded the first time either tab opens — a separate chunk —
  // so the initial page and Lineage never download it. Falls back to the base tree
  // if the chunk fails, so the games still work (just without the extra variety).
  const [richTree, setRichTree] = useState<Tree | null>(null);
  useEffect(() => {
    if ((view === "kinship" || view === "branches") && !richTree) {
      loadRichTree().then(setRichTree).catch(() => setRichTree(g.tree));
    }
  }, [view, richTree, g.tree]);

  // Recover a completed daily that's missing from stats — chiefly one finished while
  // SIGNED OUT whose local stat a prior (pre-fix) sign-in overwrote with the cloud store
  // before merging it. The per-game PROGRESS caches survive that (they're what still show
  // the game as "played"), so rebuild the missing stat from them. The record* helpers are
  // idempotent (apply* only add a missing date) and push to the cloud when signed in, so a
  // normal restore is a no-op and the recovered day persists across devices. Guarded on
  // playedDates so it fires only for a genuinely absent day.
  useEffect(() => {
    const t = todayKey();
    const tier = resolveDailyRules(t).tier;
    const lp = loadDailyProgress();
    if (tree && lp && lp.date === t && lp.status !== "playing" && !stats.daily.playedDates.includes(t)) {
      record("daily", groupOf(tree, lp.answerId), {
        status: lp.status === "won" ? "won" : "gaveup",
        guesses: lp.guessIds.length,
        hints: lp.hintIds.length,
        tier,
      });
    }
    const kp = loadGridProgress();
    if (kp && kp.date === t && kp.status !== "playing" && !stats.kinship.playedDates.includes(t)) {
      // paidReveals is tracked live (the free budget is order-dependent), so take the
      // saved count rather than letting the entry fall back to the legacy estimate.
      recordKinship({
        status: kp.status === "won" ? "won" : "lost",
        mistakes: kp.mistakes,
        tier,
        reveals: kp.revealed?.length ?? 0,
        paidReveals: kp.paidReveals ?? Math.max(0, (kp.revealed?.length ?? 0) - (KINSHIP_FREE_REVEALS + kp.solved.length)),
      });
    }
    // Branches needs the board to score placements, and the PINNED board is what was
    // played whenever it differs from the freshly generated one (useBranchesGame does
    // the same), so the pin has to be resolved before the slots can be graded.
    let live = true;
    const bp = loadBranchesProgress();
    if (richTree && bp && bp.date === t && bp.status === "done" && !stats.branches.playedDates.includes(t)) {
      void fetchPinnedPuzzle("branches", t).then((p) => {
        if (!live) return;
        const board = (p ? rebuildBranchesBoard(t, p) : null) ?? branchesBoardFor(richTree, t);
        if (!board) return;
        // Score it exactly as the live game does: help is charged per correct slot,
        // and full-article reads carry the same half point as a peek.
        const r = branchesTally(board, bp.placements, bp.hints, bp.peeked ?? [], bp.reads ?? []);
        const mistakes = bp.mistakes ?? 0;
        // A win is every slot placed AND within the day's mistake budget.
        const won = r.correct === r.total && mistakes <= branchesAllowance(board.tier);
        // The board is in hand here, so tag its clade group too (the rich tree resolves
        // every id); an untagged entry would still fall back to the date resolver.
        const group = boardGroupOf(richTree, [board.rootId, ...board.groupIds, ...board.leafIds]) ?? undefined;
        recordBranches({ won, ...r, mistakes, tier: board.tier, group });
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, richTree, stats.daily.playedDates, stats.kinship.playedDates, stats.branches.playedDates, record, recordKinship, recordBranches]);
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
  // for every game AND the combined board, and surface any not yet shown on this
  // device (see newDailyWins for the per-source baseline). One banner per source,
  // so a day that swept two games says so twice.
  const [winNudge, setWinNudge] = useState<{ source: WinSource; dates: string[] }[]>([]);
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
      // Wrong guesses and reveals are scored separately (reveals are gentler than a
      // whole mistake), so both are reported; the server scores on both.
      const mistakes = Math.min(4, r.mistakes);
      recordKinship({ status: r.won ? "won" : "lost", mistakes, tier: r.tier, reveals: r.reveals, paidReveals: r.paidReveals, group: r.group ?? undefined });
      void countPlay("kinship", r.date, r.won); // anonymous count; Kinship is daily-only
      const args = { puzzleDate: r.date, won: r.won, mistakes, reveals: r.reveals, paidReveals: r.paidReveals };
      if (player.session) {
        // On failure (transient network / RPC hiccup) queue it so the next load
        // retries — the submit is idempotent, so a signed-in board never silently
        // drops a result.
        void recordGridGame(args).then((ok) => {
          if (ok) setKinBoardReload((c) => c + 1);
          else if (player.configured) enqueuePendingSubmit({ game: "kinship", args });
        });
      } else if (player.configured) {
        // Signed out: stash for the leaderboard, replayed when they sign in.
        enqueuePendingSubmit({ game: "kinship", args });
      }
    },
    [recordKinship, player.session, player.configured]
  );

  // Record a finished Branches board: local stat + streak always; a signed-in
  // player also gets a durable leaderboard row, then the post-game board refetches.
  const recordBranchesResult = useCallback(
    (r: BranchesComplete) => {
      recordBranches({ won: r.won, correct: r.correct, total: r.total, hinted: r.hinted, peeked: r.peeked, mistakes: r.mistakes, tier: r.tier, group: r.group ?? undefined });
      void countPlay("branches", r.date, r.won); // anonymous count; Branches is daily-only
      const args = { puzzleDate: r.date, won: r.won, correct: r.correct, total: r.total, hinted: r.hinted, peeked: r.peeked, mistakes: r.mistakes };
      if (player.session) {
        void recordBranchesGame(args).then((ok) => {
          if (ok) setBranchBoardReload((c) => c + 1);
          else if (player.configured) enqueuePendingSubmit({ game: "branches", args });
        });
      } else if (player.configured) {
        // Signed out: stash for the leaderboard, replayed when they sign in.
        enqueuePendingSubmit({ game: "branches", args });
      }
    },
    [recordBranches, player.session, player.configured]
  );

  const daily = g.mode === "daily";
  const roundOver = g.status !== "playing";
  // A hint is irreversible and costs real points, so on the daily the button arms
  // first and quotes the price, and only the second press spends it. Free play
  // isn't scored, so there it stays a single press. Disarms itself whenever the
  // board moves under it (a guess landed, the round ended, the mode switched), so
  // the quoted number can never be stale by the time it's confirmed.
  const [hintArmed, setHintArmed] = useState(false);
  useEffect(() => { setHintArmed(false); }, [g.guesses.length, g.hintIds.length, roundOver, g.mode]);
  // The name shown/highlighted on the leaderboard (edited display name, else login).
  const boardName = player.displayName ?? player.username;
  // Browsing past boards (and every window that isn't today) is for signed-in
  // players. Gated on the session, not on boardName, which can be null for an
  // account that has yet to pick a display name.
  const canBrowseBoards = !!player.session;

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
    // Which round this is filed as comes from g.roundMode, NOT g.mode. On the commit
    // where the mode flips, g.mode has already changed while the guesses, answer and
    // status in hand are still the round the player just finished, so keying off
    // g.mode filed a won FREE round as today's daily: a cloud row holding the
    // free-play guesses, which submit_game then makes permanent (its insert is
    // `on conflict do nothing`, so the real daily could never land), and which the
    // daily then restored and re-scored against its own answer. Reported twice:
    // 2026-08-03 and 2026-08-05. g.roundMode still names the finished round here, so
    // its key matches recordedKey and nothing is written. The same guard covers the
    // reverse flip, which used to file a finished daily again as a free-play stat.
    const mode = g.roundMode;
    if (!mode) return;
    // A restored (already-played) daily is already recorded — don't count it again.
    if (mode === "daily" && g.dailyLocked) return;
    const key = `${mode}:${g.answerId}:${g.status}`;
    if (recordedKey.current === key) return;
    recordedKey.current = key;
    const group = groupOf(g.tree, g.answerId);
    record(mode, group, {
      status: g.status === "won" ? "won" : "gaveup",
      guesses: g.guesses.length,
      hints: g.hintIds.length,
      tier: g.daily.tier,
    });
    // Only DAILY games get a durable cloud row (free play is tracked in stats
    // only). Descriptive detail (answer, assist, resolution, par) rides along but
    // never affects scoring. On resolve, bump boardReload to refetch the board.
    if (mode === "daily") {
      // Anonymous play count (no identifier of any kind, see data/playCount.ts).
      // Inside the daily gate on purpose: free-play rounds aren't counted.
      void countPlay("lineage", todayKey(), g.status === "won");
      const args = {
        userId: player.session?.user.id ?? "",
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
      };
      if (player.session) {
        void recordGame(args).then((ok) => {
          if (ok) setBoardReload((c) => c + 1);
          else if (player.configured) enqueuePendingSubmit({ game: "lineage", args });
        });
      } else if (player.configured) {
        // Signed out: stash for the leaderboard, replayed when they sign in.
        enqueuePendingSubmit({ game: "lineage", args });
      }
    }
  }, [roundOver, g.dailyLocked, g.roundMode, g.tree, g.answerId, g.status, g.guesses, g.hintIds, g.daily.tier, g.config.scopeRootId, g.config.winWithin, g.assist, par, player.session, player.configured, record]);

  useEffect(() => {
    if (!player.session) { setWinNudge([]); return; }
    let live = true;
    void (async () => {
      // All four sources at once: each of the three games, plus the combined board.
      const [overall, lineage, kinship, branches] = await Promise.all([
        fetchOverallBadges(),
        fetchGameBadges("lineage"),
        fetchGameBadges("kinship"),
        fetchGameBadges("branches"),
      ]);
      if (!live) return;
      const fetched: [WinSource, { win_dates?: string[] } | null][] =
        [["overall", overall], ["lineage", lineage], ["kinship", kinship], ["branches", branches]];
      const fresh = fetched
        // A null result is a failed/missing RPC, not "no wins" — skip it, or
        // newDailyWins would baseline that source as empty (see its doc comment).
        .filter(([, b]) => b !== null)
        .map(([source, b]) => ({ source, dates: newDailyWins(source, b!.win_dates ?? []) }))
        .filter((n) => n.dates.length > 0);
      if (fresh.length) setWinNudge(fresh);
    })();
    return () => { live = false; };
  }, [player.session]);

  // Count today's finishes this device missed at the time (a tab on a pre-counter
  // bundle, a failed call, offline). Once per load; already-counted days are a no-op.
  useEffect(() => { void catchUpCounts(todayKey()); }, []);

  // Carry over signed-out play: on sign-in, replay any dailies finished before the
  // player had an account onto the leaderboard. The submit RPCs are idempotent
  // (daily-once index) and reject future dates, so a replay is always safe; then
  // the boards refetch to include the newly-landed rows.
  useEffect(() => {
    if (!player.session) return;
    const pending = loadPendingSubmits();
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const p of pending) {
        if (cancelled) return;
        if (p.game === "lineage") await recordGame(p.args);
        else if (p.game === "kinship") await recordGridGame(p.args);
        else await recordBranchesGame(p.args);
      }
      if (cancelled) return;
      clearPendingSubmits();
      setBoardReload((c) => c + 1);
      setKinBoardReload((c) => c + 1);
      setBranchBoardReload((c) => c + 1);
    })();
    return () => { cancelled = true; };
  }, [player.session]);

  if (g.error && !g.tree) {
    return <div className="wrap"><p className="empty">Couldn't load the tree: {g.error}</p></div>;
  }
  if (!g.tree || !g.answerId) {
    return <div className="wrap"><p className="empty">Growing the tree of life…</p></div>;
  }

  if (isAdminHash(hash)) return <ErrorBoundary label="Curator page"><AdminPanel tree={g.tree} /></ErrorBoundary>;

  const answer = g.tree.byId.get(g.answerId)!;
  // The active daily date — the 09:00 Europe/Brussels rollover, NOT the UTC calendar
  // day. Using new Date().toISOString() here flips at 00:00 UTC (02:00 Brussels), so
  // the eyebrow №, banners, and share card jumped a day ~7h before the board actually
  // rolled. todayKey() keeps them in lockstep with the game hook and grebe_today().
  const today = todayKey();

  const scopeLabel = SCOPE_PRESETS.find((s) => s.id === g.config.scopeRootId)?.label ?? "All life";
  const resLabel = RESOLUTION_PRESETS.find((r) => r.winWithin === g.config.winWithin)?.label ?? "";

  const eyebrow =
    view === "home" ? "Daily games on the tree of life" :
    view === "kinship" ? `Kinship · ${dailyLabel(today)}` :
    view === "branches" ? `Branches · ${dailyLabel(today)}` :
    view === "leaderboard" ? "Leaderboard" :
    view === "stats" ? "Your stats" :
    view === "account" ? "Your account" :
    view === "about" ? "About Grebe" :
    daily ? `Lineage · ${dailyLabel(today)}` : "Lineage · free play";

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

      {/* Scoring change, Wed through Fri. Lives inside Lineage rather than with the
          site-wide banners because it only concerns this game. Date-bounded, so it
          removes itself. Leads with the hint price since that's the half that costs
          players something; the guess half follows so it isn't half a story. */}
      {today >= SCORING_BANNER_FROM && today < SCORING_BANNER_UNTIL && (
        <div className="beta-banner" role="note">
          <span className="beta-tag">Scoring</span>
          <span>
            <b>Hints now cost more</b>: 20% of the day’s points for the first and 30% for the
            second, two per board. They used to cost less than a wrong guess, despite always
            revealing more. Your opening guess is now the cheapest on the board instead of the
            most expensive, since it’s the one you make blind.
          </span>
        </div>
      )}

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
          onRandomize={g.randomizeSettings}
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
            difficulty={daily ? g.daily.difficulty : null}
            streak={daily ? stats.daily.currentStreak : null}
          />
          {daily && <p className="daily-lock">✓ You’ve played today’s Lineage. Come back tomorrow for a new puzzle.</p>}
          {/* Show where you landed among everyone right after a daily. */}
          {daily && player.configured && <LeaderboardPanel me={boardName} variant="today" canPreview={player.isAdmin} reloadKey={boardReload} streak={stats.daily.currentStreak} />}
          {daily && <LeaderboardNudge show={player.configured && !player.session} />}
        </>
      )}

      {/* Optional explainer: what the "not in set" suggestions are. Collapsed by
          default so it never gets in the way. */}
      {!roundOver && (
        <details className="oos-help">
          <summary>What’s “not in set”?</summary>
          <div className="oos-help-body">
            <div className="oos-help-row">
              <span className="oos-dot is-in" aria-hidden="true" />
              <p><b>In the set.</b> One of the possible hidden species. Guess it to try to win.</p>
            </div>
            <div className="oos-help-row">
              <span className="oos-dot is-out" aria-hidden="true" />
              <p>
                <span className="gs-tag gs-oos-tag">not in set</span>
                Any other organism or clade. It can’t be today’s answer, but guessing it grafts it
                onto the tree so you can see where it sits and how close it lands — handy for scouting.{" "}
                <b>It still counts as a guess.</b>
              </p>
            </div>
          </div>
        </details>
      )}

      {/* Guess bar sits at the bottom, under the tree, and sticks to the viewport
          so it stays reachable as the tree grows above it. */}
      <div className="playbar">
        {/* Gone once the round is over, rather than sitting there disabled: there
            is nothing left to guess, and it strands an inert box under the
            result, share and discussion blocks. */}
        {!roundOver && (
          <GuessInput
            tree={g.tree}
            config={g.config}
            disabled={roundOver}
            onSubmit={g.submit}
            onOutOfSetGuess={g.submitGraft}
            focusCladeId={g.assist ? g.focusCladeId : null}
            guesses={g.guesses}
          />
        )}
        <div className="errline">{g.error}</div>

        {/* The price, shown only once the button is armed, so it's an answer to
            "what will this cost me" rather than a number sitting there all game.
            "Still in play" is the best case — winning on your very next guess — so
            it drops as you guess, which is the honest figure to weigh a hint
            against. Daily only: free play isn't scored, so there's nothing to
            quote and the button never arms. */}
        {daily && !roundOver && g.canHint && hintArmed && (() => {
          const { now, cost } = hintCost(g.daily.tier, g.guesses.length, g.hintIds.length);
          return (
            <div className="hintcost" role="status">
              {now > 0
                ? <>Hint {g.hintIds.length + 1} of {LINEAGE_MAX_HINTS} costs <b>{cost}</b> of the <b>{now}</b> points still in play.</>
                : <>Today’s board is already worth 0 points.</>}
            </div>
          );
        })()}

        <div className="subactions">
          {!roundOver && (
            <button
              className={`linkbtn${hintArmed ? " is-armed" : ""}`}
              onClick={() => {
                if (!daily || hintArmed) { g.revealHint(); setHintArmed(false); }
                else setHintArmed(true);
              }}
              disabled={!g.canHint}
            >
              {g.hintState === "exhausted"
                ? "Nothing left to reveal"
                : !g.canHint
                  ? "No hint left"
                  : hintArmed
                    ? "Confirm hint"
                    : "Hint: reveal next branch"}
            </button>
          )}
          {!roundOver && hintArmed && (
            <button className="linkbtn" onClick={() => setHintArmed(false)}>Cancel</button>
          )}
          {!roundOver && <button className="linkbtn" onClick={g.giveUp}>Give up & reveal</button>}
          {!daily && <button className="linkbtn" onClick={g.newRandom}>New random specimen</button>}
        </div>
      </div>

      {/* One reusable board per surface: same component, different key. Mounted
          during play too, not just after: while unfinished it shows nothing but a
          one-line nudge, and only when the board already has a conversation. */}
      {daily && (
        <DiscussionPanel
          board="lineage"
          date={today}
          configured={player.configured}
          signedIn={!!player.session}
          played={roundOver}
          label="today’s Lineage"
        />
      )}
    </>
  );

  return (
    <div className="wrap">
      <header className="masthead">
        {/* Both corner controls in one stack, so the bell doesn't have to find its
            own spot in a masthead whose right side is already logo + toggle. */}
        <div className="masthead-tools">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <ReplyBell signedIn={!!player.session} configured={player.configured} reloadKey={boardReload} />
        </div>
        <div className="masthead-text">
          <div className="eyebrow">{eyebrow}</div>
          <h1 className="title">Grebe</h1>
          <div className="subtitle">{subtitle}</div>
        </div>
        <img className="masthead-logo" src={logoUrl} alt="" aria-hidden="true" />
      </header>

      {/* Pre-launch: announce the launch date + the reset. Auto-hides at the
          epoch (isPreLaunch flips false on 2026-07-22), so no post-launch cleanup. */}
      {isPreLaunch(today) && (
        <div className="beta-banner" role="note">
          <span className="beta-tag">Launching Wed</span>
          <span>
            Grebe goes live <b>Wednesday, July 22</b>. Everything’s open to try now —
            all scores, stats and leaderboards <b>reset at launch</b>.
          </span>
        </div>
      )}

      {/* Just-launched: invite bug reports for the first two weeks, then auto-hides
          (dailyNumber is 1 on launch day), so no post-launch cleanup. */}
      {!isPreLaunch(today) && dailyNumber(today) <= 14 && (
        <div className="beta-banner" role="note">
          <span className="beta-tag">Just launched</span>
          <span>
            Grebe just launched, so you may still run into bugs. Reports are welcome on{" "}
            <a href="https://github.com/nkempynck/grebe/issues" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            .
          </span>
        </div>
      )}

      {/* Discussion boards, announced for the first week. Date-bounded like the two
          banners above, so it removes itself and there's no cleanup to remember. */}
      {today < DISCUSSION_BANNER_UNTIL && (
        <div className="beta-banner" role="note">
          <span className="beta-tag">New</span>
          <span>
            Every daily puzzle now has a <b>discussion board</b>, for discussion (obviously), feedback, potentially
            some banter, and maybe some laughs. Finish the day’s puzzle to read it;
            posting needs an account. Each board is for that puzzle only and closes when the
            day rolls over.
          </span>
        </div>
      )}

      {/* The games sit behind ONE tab. Four of them in the top row alongside Leaderboard,
          Stats, Account and About made an eight-tab bar that wrapped on a phone and buried
          everything that is not a game. "Games" is selected whenever any game is open and
          returns you to the one you were last playing; the row underneath switches between
          them. */}
      <nav className="topnav" role="tablist" aria-label="Sections">
        {SECTIONS.map((s) => {
          if (s === "account" && !player.configured) return null;
          const on = s === "games" ? isGameView(view) : view === s;
          return (
            <button
              key={s}
              role="tab"
              aria-selected={on}
              className={`topnav-tab${on ? " is-on" : ""}`}
              onClick={() => {
                if (s === "about") setAboutFocus(null);
                setView(s === "games" ? lastGame : s);
              }}
            >
              {SECTION_LABELS[s]}
            </button>
          );
        })}
      </nav>

      {isGameView(view) && (
        <nav className="gamenav" role="tablist" aria-label="Games">
          {GAME_VIEWS.map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={`gamenav-tab${view === v ? " is-on" : ""}`}
              data-game={v}
              onClick={() => setView(v)}
            >
              <span className="gamenav-ico" aria-hidden="true">{GAME_ICONS[v]}</span>
              {SECTION_LABELS[v]}
            </button>
          ))}
        </nav>
      )}

      {winNudge.map(({ source, dates }) => (
        <div className={`winbanner${source === "overall" ? " is-overall" : ""}`} role="status" key={source}>
          <span className="winbanner-ico" aria-hidden="true">{source === "overall" ? "🏆" : "👑"}</span>
          <span className="winbanner-txt">{winBannerText(source, dates)}</span>
          <button
            className="winbanner-x"
            onClick={() => setWinNudge((n) => n.filter((x) => x.source !== source))}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}

      {view === "home" && <HomePanel onPlay={(v) => setView(v)} />}
      {view === "lineage" && <div className="gameview" data-game="lineage">{play}</div>}
      {view === "kinship" && (
        <div className="gameview" data-game="kinship">
          {richTree ? (
            <GridGame
              tree={richTree}
              streak={stats.kinship.currentStreak}
              onComplete={recordKinshipResult}
              me={boardName}
              userId={userId}
              configured={player.configured}
              reloadKey={kinBoardReload}
              onHowItWorks={() => openAbout("about-kinship")}
            />
          ) : (
            <p className="empty">Growing the tree of life…</p>
          )}
        </div>
      )}
      {view === "mosaic" && (
        <div className="gameview" data-game="mosaic">
          {/* Base tree, not the rich one: Mosaic's pool is fame-filtered species that have a
              usable photograph, and the augment's leaves have neither. */}
          <MosaicGame tree={g.tree} onHowItWorks={() => openAbout("about-mosaic")} />
        </div>
      )}
      {view === "branches" && (
        <div className="gameview" data-game="branches">
          {richTree ? (
            <BranchesGame
              tree={richTree}
              onComplete={recordBranchesResult}
              onHowItWorks={() => openAbout("about-branches")}
              me={boardName}
              userId={userId}
              configured={player.configured}
              reloadKey={branchBoardReload}
              streak={stats.branches.currentStreak}
            />
          ) : (
            <p className="empty">Growing the tree of life…</p>
          )}
        </div>
      )}
      {/* Leaderboards are account-only, all of them. A signed-out visitor used to get
          today's board with the filterable panel replaced by a nudge, which meant the
          tab half-worked: scores could be seen but never joined, and the discussion
          boards mounted under them belong to people with names. The TAB stays in the
          nav on purpose — hiding it would make leaderboards undiscoverable, which is
          the opposite of what an account is being offered for. */}
      {view === "leaderboard" && !canBrowseBoards && (
        <div className="lb-locked">
          <div className="lb-locked-icon" aria-hidden="true">🏆</div>
          <h2 className="lb-locked-title">Leaderboards need an account</h2>
          <p className="lb-locked-body">
            Scores, streaks and past days are tied to your account. Puzzles you have already
            finished are added to the board when you sign in.
          </p>
          {player.configured && (
            <button className="disc-btn is-primary lb-locked-cta" onClick={() => setView("account")}>
              Create an account or sign in
            </button>
          )}
        </div>
      )}
      {view === "leaderboard" && canBrowseBoards && (
        <>
          <div className="lb-gametabs" role="tablist" aria-label="Leaderboard game">
            <button role="tab" aria-selected={lbGame === "combined"} className={`lb-seg${lbGame === "combined" ? " is-on" : ""}`} onClick={() => setLbGame("combined")}>🏆 Combined</button>
            <button role="tab" aria-selected={lbGame === "lineage"} className={`lb-seg${lbGame === "lineage" ? " is-on" : ""}`} onClick={() => setLbGame("lineage")}>🧬 Lineage</button>
            <button role="tab" aria-selected={lbGame === "kinship"} className={`lb-seg${lbGame === "kinship" ? " is-on" : ""}`} onClick={() => setLbGame("kinship")}>🧩 Kinship</button>
            <button role="tab" aria-selected={lbGame === "branches"} className={`lb-seg${lbGame === "branches" ? " is-on" : ""}`} onClick={() => setLbGame("branches")}>🌿 Branches</button>
          </div>
          {/* Two boards per game: today's, and the filterable one (past days, weeks,
              months, all time). Both are signed-in only now, so neither is guarded here;
              today's board still obeys the play wall above it.

              The DISCUSSION hangs off the filterable board only, at the bottom, and only
              when that board is showing a single day. Under the fixed today board it was
              a second copy of the same conversation, and it gave the day's discussion no
              way to be reached the morning after — which is the whole point of the
              server's two-day read window. Set the period to Day and step back instead. */}
          {lbGame === "combined" ? (
            <>
              <CombinedLeaderboard me={boardName} variant="today" playedToday={playedTodayAny} renderForDate={discussionFor("combined", playedDatesAny)} />
              <CombinedLeaderboard me={boardName} variant="config" playedToday={playedTodayAny} renderForDate={discussionFor("combined", playedDatesAny)} />
            </>
          ) : lbGame === "lineage" ? (
            <>
              <LeaderboardPanel me={boardName} variant="today" canPreview={player.isAdmin} streak={stats.daily.currentStreak} playedToday={playedTodayLineage} />
              <LeaderboardPanel me={boardName} variant="config" canPreview={player.isAdmin} answerForDate={dailyAnswerOf} streak={stats.daily.currentStreak} playedToday={playedTodayLineage} renderForDate={discussionFor("lineage", stats.daily.playedDates)} />
            </>
          ) : lbGame === "kinship" ? (
            <>
              <Leaderboard game="kinship" label="Kinship" me={boardName} variant="today" streak={stats.kinship.currentStreak} playedToday={playedTodayKinship} note="Score rewards harder days and fewer mistakes. A clean board earns the full weight." />
              <Leaderboard game="kinship" label="Kinship" me={boardName} variant="config" streak={stats.kinship.currentStreak} playedToday={playedTodayKinship} note="Score rewards harder days and fewer mistakes. A clean board earns the full weight." renderForDate={discussionFor("kinship", stats.kinship.playedDates)} />
            </>
          ) : (
            <>
              <Leaderboard game="branches" label="Branches" me={boardName} variant="today" streak={stats.branches.currentStreak} playedToday={playedTodayBranches} note="Score rewards harder days and correct placements. Hints and peeks trim it." />
              <Leaderboard game="branches" label="Branches" me={boardName} variant="config" streak={stats.branches.currentStreak} playedToday={playedTodayBranches} note="Score rewards harder days and correct placements. Hints and peeks trim it." renderForDate={discussionFor("branches", stats.branches.playedDates)} />
            </>
          )}
        </>
      )}
      {view === "stats" && <StatsTabs stats={stats} field={field} player={player} />}
      {view === "account" && <AccountPanel player={player} />}
      {view === "about" && <AboutPanel focus={aboutFocus} />}
    </div>
  );
}
