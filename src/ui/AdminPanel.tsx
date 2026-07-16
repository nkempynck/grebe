import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Tree } from "../core";
import { dailyAnswerId, displayName, leavesUnder, randomAnswerId } from "../core";
import { todayKey, dailyNumber } from "../core/daily";
import { RESOLUTION_PRESETS, SCOPE_PRESETS } from "../data/presets";
import { dailyRules, resolveDailyRules, dailyAnswerFor } from "../data/dailySchedule";
import { gridBoardFor } from "../data/gridDaily";
import { branchesBoardFor } from "../data/branchesDaily";
import { clearDailyProgress } from "../data/dailyProgress";
import { clearGridProgress } from "../data/gridProgress";
import { clearBranchesProgress } from "../data/branchesProgress";
import { GridGame } from "./GridGame";
import { BranchesGame } from "./BranchesGame";
import { ErrorBoundary } from "./ErrorBoundary";
import { useGame } from "../hooks/useGame";
import { asEmail, fromEmail } from "../hooks/usePlayer";
import { SettingsPanel } from "./SettingsPanel";
import { GuessInput } from "./GuessInput";
import { Cladogram } from "./Cladogram";
import { ResultCard } from "./ResultCard";
import {
  DAILY_PLAN,
  DRAFT_KEY,
  deleteRemoteDay,
  fetchRemotePlan,
  saveRemoteDay,
  type DailyPlan,
  type DayPlan,
} from "../data/dailyPlan";
import { isSupabaseConfigured, supabase } from "../data/supabase";
import {
  fetchPinnedIndex,
  fetchPinnedPuzzle,
  computePuzzle,
  repinFuture,
  currentVersions,
  GAMES,
  type Game,
  type PinnedDay,
  type RepinProgress,
  type LineagePuzzle,
  type KinshipPuzzle,
  type BranchesPuzzle,
} from "../data/pinnedPuzzles";
import { Turnstile, captchaEnabled } from "./Turnstile";

function loadLocalDraft(): DailyPlan {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw) as DailyPlan;
  } catch {
    /* ignore */
  }
  return { ...DAILY_PLAN };
}

/** Drop empty day-entries so the exported/persisted JSON only holds real overrides. */
function cleanPlan(plan: DailyPlan): DailyPlan {
  const out: DailyPlan = {};
  for (const [date, p] of Object.entries(plan)) {
    if (!isEmptyDay(p)) out[date] = pickFields(p);
  }
  return out;
}
function pickFields(p: DayPlan): DayPlan {
  const e: DayPlan = {};
  if (p.scopeRootId !== undefined) e.scopeRootId = p.scopeRootId;
  if (p.winWithin !== undefined) e.winWithin = p.winWithin;
  if (p.assist !== undefined) e.assist = p.assist;
  if (p.answerId !== undefined) e.answerId = p.answerId;
  if (p.note) e.note = p.note;
  return e;
}
function isEmptyDay(p: DayPlan): boolean {
  return (
    p.scopeRootId === undefined &&
    p.winWithin === undefined &&
    p.assist === undefined &&
    p.answerId === undefined &&
    !p.note
  );
}

const scopeLabel = (id: string) =>
  (SCOPE_PRESETS.find((s) => s.id === id)?.label ?? id).replace(/\s+only$/i, "");
const resLabel = (n: number) => RESOLUTION_PRESETS.find((r) => r.winWithin === n)?.label ?? `±${n}`;

// Each backend SQL file exposes a *_schema_check() RPC; the dashboard calls all of
// them so one glance confirms every file applied. A missing RPC = that file was
// never run.
const SCHEMA_CHECKS = [
  { rpc: "schema_check", label: "Core", file: "schema.sql" },
  { rpc: "grid_schema_check", label: "Kinship", file: "kinship.sql" },
  { rpc: "branches_schema_check", label: "Branches", file: "branches.sql" },
  { rpc: "puzzles_schema_check", label: "Puzzles", file: "puzzles.sql" },
  { rpc: "names_schema_check", label: "Names", file: "names.sql" },
  { rpc: "badges_schema_check", label: "Badges", file: "badges.sql" },
  { rpc: "streaks_schema_check", label: "Streaks", file: "streaks.sql" },
  { rpc: "taxon_index_schema_check", label: "Guess index", file: "taxon_index.sql" },
];

interface FileCheck {
  label: string;
  file: string;
  // [key, value] pairs from the check's jsonb: booleans are pass/fail, numbers are
  // metadata (e.g. a row count) shown as a detail. null → RPC unavailable.
  rows: Array<[string, boolean | number]> | null;
  error: string | null;
}

// `spoiler` holds a detail that would give away today's puzzle (e.g. the Lineage
// answer); it stays hidden behind a "reveal" click so opening the admin page
// doesn't spoil the daily.
interface Check { label: string; ok: boolean; detail?: string; spoiler?: string; }

function StatusRow({ label, ok, detail, spoiler, revealed, onReveal }: Check & { revealed?: boolean; onReveal?: () => void }) {
  return (
    <li className={ok ? "is-ok" : "is-bad"}>
      {ok ? "✓" : "✗"} <b>{label}</b>
      {detail && <span className="sys-detail"> — {detail}</span>}
      {spoiler && ok && (revealed
        ? <span className="sys-detail"> — {spoiler}</span>
        : <> — <button className="linkbtn" onClick={onReveal}>reveal</button></>)}
    </li>
  );
}

/** One-glance "is everything OK?" dashboard: runtime config, the three game
 *  engines building today's board locally, and every backend schema file. */
function SystemHealth({ tree }: { tree: Tree }) {
  const live = isSupabaseConfigured;
  const [schema, setSchema] = useState<FileCheck[] | null>(null);
  const [loading, setLoading] = useState(live);
  // Today's answer stays hidden until clicked, so the dashboard doesn't spoil it.
  const [reveal, setReveal] = useState(false);

  const runSchema = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    const sb = supabase; // capture the non-null client for the async closures below
    setLoading(true);
    const out = await Promise.all(
      SCHEMA_CHECKS.map(async (c): Promise<FileCheck> => {
        const { data, error } = await sb.rpc(c.rpc);
        if (error || !data) return { label: c.label, file: c.file, rows: null, error: error?.message ?? "no response" };
        return { label: c.label, file: c.file, rows: Object.entries(data as Record<string, boolean | number>), error: null };
      })
    );
    setSchema(out);
    setLoading(false);
  }, []);
  useEffect(() => { if (live) void runSchema(); }, [runSchema, live]);

  const today = todayKey();
  // Runtime + engine checks, recomputed locally from the loaded tree (no network).
  const runtime: Check[] = [
    { label: "Backend configured", ok: live, detail: live ? "Supabase connected" : "local-only build" },
    { label: "Taxonomy loaded", ok: tree.byId.size > 0, detail: `${tree.byId.size} nodes` },
  ];
  const engines = useMemo<Check[]>(() => {
    const ans = dailyAnswerFor(tree, today);
    const node = ans ? tree.byId.get(ans) : null;
    const grid = gridBoardFor(tree, today);
    const br = branchesBoardFor(tree, today);
    return [
      { label: "Lineage answer resolves", ok: !!node, detail: node ? undefined : "no answer", spoiler: node ? displayName(node) : undefined },
      { label: "Kinship board builds", ok: !!grid && grid.groups.length === 4, detail: grid ? `${grid.groups.length} groups · ${grid.tiles.length} tiles` : "null" },
      { label: "Branches board builds", ok: !!br && br.slotIds.length >= 4, detail: br ? `${br.slotIds.length} slots` : "null" },
    ];
  }, [tree, today]);

  // Only boolean `false` marks a file bad; numeric entries (row counts) are metadata.
  const schemaBad = (schema ?? []).filter((r) => r.rows === null || r.rows.some(([, v]) => v === false));
  // A missing backend on a local-only build isn't a failure to flag.
  const runtimeBad = [...runtime, ...engines].filter((c) => !c.ok && (c.label !== "Backend configured" || live));
  const allOk = !loading && runtimeBad.length === 0 && (!live || schemaBad.length === 0);
  const issues = runtimeBad.length + (live ? schemaBad.length : 0);

  return (
    <div className={`admin-schema${allOk ? " is-ok" : loading ? "" : " is-bad"}`}>
      <div className="admin-schema-head">
        <span className="admin-schema-ttl">
          {loading ? "Running checks…" : allOk ? "✓ All systems go" : `⚠ ${issues} check${issues === 1 ? "" : "s"} need attention`}
        </span>
        {live && <button className="linkbtn" onClick={() => void runSchema()} disabled={loading}>Re-check</button>}
      </div>

      <div className="sys-groups">
        <div className="sys-group">
          <div className="sys-group-ttl">Runtime</div>
          <ul className="admin-schema-list">{runtime.map((c) => <StatusRow key={c.label} {...c} />)}</ul>
        </div>
        <div className="sys-group">
          <div className="sys-group-ttl">Game engines · today</div>
          <ul className="admin-schema-list">{engines.map((c) => <StatusRow key={c.label} {...c} revealed={reveal} onReveal={() => setReveal(true)} />)}</ul>
        </div>
        <div className="sys-group">
          <div className="sys-group-ttl">Backend schema</div>
          <ul className="admin-schema-list">
            {!live ? (
              <li className="is-muted">Local-only build — no backend to check.</li>
            ) : schema === null ? (
              <li className="is-muted">Checking…</li>
            ) : (
              schema.map((r) => {
                if (r.rows === null) return <li key={r.file} className="is-bad">✗ <b>{r.label}</b> — <code>{r.file}</code> not applied ({r.error})</li>;
                const bad = r.rows.filter(([, v]) => v === false).map(([k]) => k);
                const meta = r.rows.filter(([, v]) => typeof v === "number").map(([k, v]) => `${v} ${k}`).join(" · ");
                return bad.length === 0
                  ? <li key={r.file} className="is-ok">✓ <b>{r.label}</b> <code>{r.file}</code>{meta && <span className="sys-detail"> — {meta}</span>}</li>
                  : <li key={r.file} className="is-bad">✗ <b>{r.label}</b> — missing: {bad.join(", ")}</li>;
              })
            )}
          </ul>
        </div>
      </div>
      {live && schemaBad.length > 0 && (
        <p className="admin-schema-hint">Run the flagged file(s) in the Supabase SQL editor (safe to re-run), then re-check.</p>
      )}
    </div>
  );
}

/** Lineage sandbox: a free-play instance (never the real daily, never persisted)
 *  with the scope/resolution/assist levers, reroll, and autosolve. */
function LineageBench({ tree }: { tree: Tree }) {
  // "free" from the start so this instance never reads or writes daily progress.
  const g = useGame(null, "free");
  const over = g.status !== "playing";
  const answer = g.answerId ? tree.byId.get(g.answerId) : null;
  if (!g.answerId || !answer) return <p className="empty">Drawing a specimen…</p>;
  return (
    <>
      <div className="playtest" role="region" aria-label="Playtest controls">
        <span className="playtest-tag">Test bench</span>
        <button className="playtest-btn" onClick={g.newRandom}>🎲 New specimen</button>
        <button className="playtest-btn" onClick={() => g.submit(answer.sciName)} disabled={over}>✓ Autosolve</button>
        <button className="playtest-btn" onClick={g.giveUp} disabled={over}>Reveal answer</button>
        <span className="playtest-note">Not recorded</span>
      </div>
      <SettingsPanel config={g.config} onScope={g.setScope} onWinWithin={g.setWinWithin} assist={g.assist} onAssist={g.setAssist} />
      {g.guesses.length === 0 && g.hintIds.length === 0 && !over ? (
        <p className="empty">Guess a species, or a group like <em>owls</em> to scout. Autosolve jumps to the win.</p>
      ) : (
        <Cladogram tree={tree} scopeRootId={g.config.scopeRootId} results={g.guesses} answerId={g.answerId} hintIds={g.hintIds} revealed={over} />
      )}
      {over && <ResultCard tree={tree} answer={answer} won={g.status === "won"} guessCount={g.guesses.length} streak={null} par={null} />}
      <div className="playbar">
        <GuessInput tree={tree} config={g.config} disabled={over} onSubmit={g.submit} onOutOfSetGuess={g.submitGraft} focusCladeId={g.assist ? g.focusCladeId : null} guesses={g.guesses} />
        <div className="errline">{g.error}</div>
        <div className="subactions">
          {!over && <button className="linkbtn" onClick={g.revealHint} disabled={!g.canHint}>Hint: reveal next branch</button>}
          {!over && <button className="linkbtn" onClick={g.newRandom}>New random specimen</button>}
        </div>
      </div>
    </>
  );
}

/** Play the daily games right here for testing: force a difficulty, deal fresh
 *  boards, autosolve. Nothing played here is recorded to stats or the leaderboard,
 *  so the real dailies and standings stay untouched. */
function TestBench({ tree }: { tree: Tree }) {
  const [game, setGame] = useState<"lineage" | "kinship" | "branches">("kinship");
  const [cleared, setCleared] = useState(false);
  const resetToday = () => {
    clearDailyProgress();
    clearGridProgress();
    clearBranchesProgress();
    setCleared(true);
    setTimeout(() => setCleared(false), 2200);
  };
  return (
    <div className="admin-testbench">
      <div className="admin-testbench-head">
        <div>
          <div className="admin-testbench-ttl">Test bench</div>
          <p className="admin-testbench-hint">
            Play any game here as much as you want: set difficulty (or scope / resolution /
            assist for Lineage), deal fresh boards, or autosolve to jump to the end state.
            Nothing here is recorded.
          </p>
        </div>
        <button className="linkbtn" onClick={resetToday}>
          {cleared ? "cleared ✓ — reload the site" : "Reset today’s saved progress"}
        </button>
      </div>
      <div className="admin-testbench-tabs" role="tablist" aria-label="Test which game">
        <button role="tab" aria-selected={game === "lineage"} className={`lb-seg${game === "lineage" ? " is-on" : ""}`} onClick={() => setGame("lineage")}>🧬 Lineage</button>
        <button role="tab" aria-selected={game === "kinship"} className={`lb-seg${game === "kinship" ? " is-on" : ""}`} onClick={() => setGame("kinship")}>🧩 Kinship</button>
        <button role="tab" aria-selected={game === "branches"} className={`lb-seg${game === "branches" ? " is-on" : ""}`} onClick={() => setGame("branches")}>🌿 Branches</button>
      </div>
      <ErrorBoundary key={game} label={`${game} test bench`}>
        <div className="gameview admin-testbench-stage" data-game={game}>
          {game === "lineage" ? <LineageBench tree={tree} /> : game === "kinship" ? <GridGame tree={tree} sandbox /> : <BranchesGame tree={tree} sandbox />}
        </div>
      </ErrorBoundary>
    </div>
  );
}

const GAME_META: Record<Game, { icon: string; label: string }> = {
  lineage: { icon: "🧬", label: "Lineage" },
  kinship: { icon: "🧩", label: "Kinship" },
  branches: { icon: "🌿", label: "Branches" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

type PinCellState = "blank" | "past" | "empty" | "partial" | "stale" | "full";

/** What one day serves for all three games — reads the FROZEN pin (what players
 *  will actually see), falling back to the freshly computed puzzle for unpinned
 *  dates. Admin-only, so it's fine that it reveals answers. */
function DayInspector({ tree, date, versions, onClose }: { tree: Tree; date: string; versions?: Partial<Record<Game, number>>; onClose: () => void }) {
  const cur = useMemo(() => currentVersions(), []);
  const [data, setData] = useState<{ lineage: LineagePuzzle | null; kinship: KinshipPuzzle | null; branches: BranchesPuzzle | null } | null>(null);
  const [source, setSource] = useState<Record<Game, "pinned" | "preview">>({ lineage: "preview", kinship: "preview", branches: "preview" });

  useEffect(() => {
    let alive = true;
    setData(null);
    (async () => {
      const [l, k, b] = await Promise.all([
        fetchPinnedPuzzle("lineage", date),
        fetchPinnedPuzzle("kinship", date),
        fetchPinnedPuzzle("branches", date),
      ]);
      if (!alive) return;
      setSource({ lineage: l ? "pinned" : "preview", kinship: k ? "pinned" : "preview", branches: b ? "pinned" : "preview" });
      setData({
        lineage: l ?? computePuzzle("lineage", tree, date),
        kinship: k ?? computePuzzle("kinship", tree, date),
        branches: b ?? computePuzzle("branches", tree, date),
      });
    })();
    return () => { alive = false; };
  }, [tree, date]);

  const nm = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const tier = data?.lineage?.tier ?? data?.kinship?.tier ?? data?.branches?.tier ?? null;

  const tag = (g: Game) => {
    const v = versions?.[g];
    const stale = v != null && v < cur[g];
    return (
      <span className={`admin-day-tag${source[g] === "pinned" ? (stale ? " is-stale" : " is-pinned") : " is-preview"}`}>
        {source[g] === "pinned" ? `pinned v${v ?? "?"}${stale ? " · stale" : ""}` : "preview (unpinned)"}
      </span>
    );
  };

  return (
    <div className="admin-day">
      <div className="admin-day-head">
        <span>№{dailyNumber(date)} · {date} · {weekday}{tier != null && <> · tier {tier}</>}</span>
        <button className="stats-close" onClick={onClose} aria-label="Close day">×</button>
      </div>
      {!data ? (
        <p className="admin-testbench-hint">Loading…</p>
      ) : (
        <div className="admin-day-games">
          <div className="admin-day-game">
            <div className="admin-day-gttl">🧬 Lineage {tag("lineage")}</div>
            {data.lineage ? (
              <div className="admin-day-body">
                <b>{nm(data.lineage.answerId)}</b>
                <span className="admin-day-meta">
                  {scopeLabel(data.lineage.scopeRootId)} · {resLabel(data.lineage.winWithin)} · {data.lineage.assist ? "assist on" : "no assist"}
                </span>
              </div>
            ) : <div className="admin-day-body is-none">no puzzle</div>}
          </div>

          <div className="admin-day-game">
            <div className="admin-day-gttl">🧩 Kinship {tag("kinship")}</div>
            {data.kinship ? (
              <div className="admin-day-body">
                {data.kinship.groups.map((grp) => (
                  <div key={grp.cladeId} className="admin-day-group">
                    <span className={`admin-day-glbl lvl-${grp.level}`}>{nm(grp.cladeId)}</span>
                    <span className="admin-day-members">{grp.memberIds.map(nm).join(" · ")}</span>
                  </div>
                ))}
              </div>
            ) : <div className="admin-day-body is-none">no puzzle</div>}
          </div>

          <div className="admin-day-game">
            <div className="admin-day-gttl">🌿 Branches {tag("branches")}</div>
            {data.branches ? (
              <div className="admin-day-body">
                <span className="admin-day-meta">Region: {nm(data.branches.rootId)} · {data.branches.slotIds.length} to place · {data.branches.anchorIds.length} prefilled</span>
                {data.branches.groupIds.map((gid, i) => {
                  const slot = data.branches!.slotIds[i];
                  return (
                    <div key={gid} className="admin-day-group">
                      <span className="admin-day-glbl">{nm(gid)}</span>
                      <span className="admin-day-members">place <b>{slot ? nm(slot) : "—"}</b></span>
                    </div>
                  );
                })}
                {data.branches.anchorIds.length > 0 && (
                  <span className="admin-day-meta">Prefilled in tree: {data.branches.anchorIds.map(nm).join(" · ")}</span>
                )}
              </div>
            ) : <div className="admin-day-body is-none">no puzzle</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Pin manager: a coverage calendar of every future daily (which games are pinned,
 *  and whether at the current generator version) plus a bulk re-pin over a chosen
 *  horizon. Re-pin only ever writes FUTURE dates through pin_puzzle() — the past is
 *  frozen server-side — so it's the safe in-app equivalent of `npm run pin`. */
function PinManager({ tree }: { tree: Tree }) {
  const live = isSupabaseConfigured;
  const today = todayKey();
  const cur = useMemo(() => currentVersions(), []);
  const [index, setIndex] = useState<PinnedDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(730);
  const [games, setGames] = useState<Game[]>([...GAMES]);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState<RepinProgress | null>(null);
  const [result, setResult] = useState<RepinProgress | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!live) return;
    setLoading(true);
    setIndex(await fetchPinnedIndex());
    setLoading(false);
  }, [live]);
  useEffect(() => { load(); }, [load]);

  const byDate = useMemo(() => {
    const m = new Map<string, PinnedDay>();
    for (const d of index ?? []) m.set(d.date, d);
    return m;
  }, [index]);

  // Coverage stats over FUTURE pinned days (the only re-pinnable ones).
  const stats = useMemo(() => {
    const stale: Record<Game, number> = { lineage: 0, kinship: 0, branches: 0 };
    const missing: Record<Game, number> = { lineage: 0, kinship: 0, branches: 0 };
    let future = 0;
    let lastDate = "";
    for (const d of index ?? []) {
      if (d.date <= today) continue;
      future++;
      lastDate = d.date;
      for (const g of GAMES) {
        const v = d.versions[g];
        if (v == null) missing[g]++;
        else if (v < cur[g]) stale[g]++;
      }
    }
    return { future, stale, missing, lastDate };
  }, [index, today, cur]);

  const cellState = useCallback((date: string): PinCellState => {
    if (date <= today) return "past";
    const d = byDate.get(date);
    const pinned = GAMES.filter((g) => d?.versions[g] != null);
    if (pinned.length === 0) return "empty";
    if (pinned.length < GAMES.length) return "partial";
    return GAMES.some((g) => (d!.versions[g] ?? 0) < cur[g]) ? "stale" : "full";
  }, [byDate, today, cur]);

  // Month rows spanning today → the horizon end, each a strip of day cells.
  const months = useMemo(() => {
    const end = new Date(`${today}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + days);
    const out: { y: number; m: number }[] = [];
    const start = new Date(`${today}T00:00:00Z`);
    for (let y = start.getUTCFullYear(), m = start.getUTCMonth(); ;) {
      out.push({ y, m });
      if (y === end.getUTCFullYear() && m === end.getUTCMonth()) break;
      if (++m > 11) { m = 0; y++; }
      if (out.length > 60) break; // safety
    }
    return out;
  }, [today, days]);

  const toggleGame = (g: Game) =>
    setGames((sel) => {
      const next = sel.includes(g) ? sel.filter((x) => x !== g) : [...sel, g];
      return GAMES.filter((x) => next.includes(x)); // keep canonical order
    });

  const run = async () => {
    if (!games.length) return;
    const who = games.length === GAMES.length ? "all three games" : games.map((g) => GAME_META[g].label).join(", ");
    if (!window.confirm(
      `Re-pin ${who} for the next ${days} days with the CURRENT logic?\n\n` +
        `Only future (unplayed) dates are written — today and the past stay frozen. ` +
        `Safe to re-run if interrupted.`
    )) return;
    setRunning(true);
    setResult(null);
    setProg({ done: 0, total: 0, failed: 0 });
    const res = await repinFuture(tree, { days, games, onProgress: setProg });
    setResult(res);
    setRunning(false);
    await load();
  };

  const verTip = (date: string) => {
    const d = byDate.get(date);
    return `${date}\n` + GAMES.map((g) => `${GAME_META[g].icon} v${d?.versions[g] ?? "–"}`).join("  ");
  };

  return (
    <div className="admin-pins">
      <div className="admin-pins-head">
        <div className="admin-testbench-ttl">Pinned puzzles</div>
        <button className="linkbtn" onClick={load} disabled={loading || !live}>{loading ? "loading…" : "Refresh"}</button>
      </div>
      {!live ? (
        <p className="admin-testbench-hint">Backend not configured — nothing to pin.</p>
      ) : (
        <>
          <p className="admin-testbench-hint">
            Generators now at {GAMES.map((g) => `${GAME_META[g].icon} v${cur[g]}`).join(" · ")}. A future day
            shown amber is pinned at an older version and would still serve the old board until re-pinned.
          </p>

          <div className="admin-pins-stats">
            <span><b>{stats.future}</b> future days pinned{stats.lastDate && <> · through {stats.lastDate}</>}</span>
            {GAMES.map((g) => {
              const bad = stats.stale[g] + stats.missing[g];
              return (
                <span key={g} className={bad ? "is-warn" : "is-ok"}>
                  {GAME_META[g].icon} {bad ? `${stats.stale[g]} stale${stats.missing[g] ? `, ${stats.missing[g]} missing` : ""}` : "all current"}
                </span>
              );
            })}
          </div>

          <div className="admin-pins-cal">
            {months.map(({ y, m }) => {
              const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
              return (
                <div className="pin-cal-row" key={`${y}-${m}`}>
                  <span className="pin-cal-mlbl">{MONTHS[m]} ’{String(y).slice(2)}</span>
                  <div className="pin-cal-days">
                    {Array.from({ length: 31 }, (_, i) => {
                      const day = i + 1;
                      if (day > dim) return <span key={i} className="pin-cell is-blank" />;
                      const date = `${y}-${pad2(m + 1)}-${pad2(day)}`;
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`pin-cell is-${cellState(date)}${selected === date ? " is-sel" : ""}`}
                          title={verTip(date)}
                          aria-label={`${date} puzzles`}
                          onClick={() => setSelected((s) => (s === date ? null : date))}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="admin-pins-legend">
            <span><i className="pin-cell is-full" /> current</span>
            <span><i className="pin-cell is-stale" /> stale (old version)</span>
            <span><i className="pin-cell is-partial" /> partial</span>
            <span><i className="pin-cell is-empty" /> unpinned</span>
            <span><i className="pin-cell is-past" /> frozen (today/past)</span>
            <span className="admin-pins-legend-hint">· click any day to inspect its puzzles</span>
          </div>

          {selected && (
            <DayInspector tree={tree} date={selected} versions={byDate.get(selected)?.versions} onClose={() => setSelected(null)} />
          )}

          <div className="admin-pins-controls">
            <label className="admin-pins-days">
              Horizon
              <input type="number" min={1} max={1460} value={days} disabled={running}
                onChange={(e) => setDays(Math.max(1, Math.min(1460, Number(e.target.value) || 1)))} />
              days
            </label>
            <div className="admin-pins-games">
              {GAMES.map((g) => (
                <label key={g} className={`admin-pins-gtog${games.includes(g) ? " is-on" : ""}`}>
                  <input type="checkbox" checked={games.includes(g)} disabled={running} onChange={() => toggleGame(g)} />
                  {GAME_META[g].icon} {GAME_META[g].label}
                </label>
              ))}
            </div>
            <button className="admin-rand" onClick={run} disabled={running || !games.length}>
              {running ? "Re-pinning…" : "Re-pin future"}
            </button>
          </div>

          {running && prog && (
            <div className="admin-pins-prog">
              <div className="admin-pins-bar"><span style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></div>
              <span>{prog.done} / {prog.total}{prog.failed ? ` · ${prog.failed} failed` : ""}</span>
            </div>
          )}
          {!running && result && (
            <p className={`admin-pins-done${result.failed ? " is-warn" : ""}`}>
              {result.failed
                ? `Wrote ${result.done - result.failed}/${result.total}, ${result.failed} failed — re-run to retry the rest.`
                : `✓ Re-pinned ${result.done} rows.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function AdminPanel({ tree }: { tree: Tree }) {
  const live = isSupabaseConfigured;

  // ---- Auth (only relevant when Supabase is configured) ----
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!live);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    // Never hang on "Checking sign-in…": resolve authReady whether getSession
    // succeeds, fails, or stalls (timeout), then fall through to the login form
    // or the panel. onAuthStateChange also flips it (fires an INITIAL_SESSION).
    let settled = false;
    const ready = () => { if (!settled) { settled = true; setAuthReady(true); } };
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => {})
      .finally(ready);
    const t = setTimeout(ready, 3000);
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); ready(); });
    return () => { clearTimeout(t); sub.subscription.unsubscribe(); };
  }, []);

  const signIn = async () => {
    if (!supabase || !name.trim() || !password) return;
    if (captchaEnabled && !captchaToken) { setAuthMsg("Please complete the CAPTCHA."); return; }
    // Same name→identifier mapping as player sign-in, so the curator logs in with
    // a plain name (no email anywhere).
    const { error } = await supabase.auth.signInWithPassword({
      email: asEmail(name),
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    setAuthMsg(error ? error.message : null);
    // Token is single-use — reset the widget whether or not sign-in succeeded.
    setCaptchaToken(null);
    setCaptchaKey((k) => k + 1);
    if (!error) setPassword("");
  };

  // ---- Draft / plan being edited ----
  const [tab, setTab] = useState<"health" | "play" | "pins" | "schedule">("health");
  const [draft, setDraft] = useState<DailyPlan>(live ? {} : loadLocalDraft);
  const [date, setDate] = useState(todayKey());
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);
  // The scheduled species is hidden until clicked, so opening the page (which
  // defaults to today) doesn't spoil the daily. Re-hides when the date changes.
  const [showAnswer, setShowAnswer] = useState(false);

  // When live, seed the editor from the remote plan (reading is public).
  useEffect(() => {
    if (live) fetchRemotePlan().then(setDraft).catch(() => {});
  }, [live]);

  const persistDay = async (d: string, p: DayPlan) => {
    if (!live) return;
    const { error } = isEmptyDay(p) ? await deleteRemoteDay(d) : await saveRemoteDay(d, pickFields(p));
    setSaveErr(error);
  };

  // Patch the current date's override. `persist=false` updates only the local
  // draft (used for per-keystroke fields like the note; persisted on blur).
  const patch = (fields: Partial<DayPlan>, persist = true) => {
    const cur: DayPlan = { ...draft[date] };
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) delete (cur as Record<string, unknown>)[k];
      else (cur as Record<string, unknown>)[k] = v;
    }
    const next = { ...draft, [date]: cur };
    setDraft(next);
    if (live) {
      if (persist) void persistDay(date, cur);
    } else {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(cleanPlan(next)));
      } catch {
        /* ignore */
      }
    }
  };

  const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const randomizeSetup = () =>
    patch({
      scopeRootId: rand(SCOPE_PRESETS).id,
      winWithin: rand(RESOLUTION_PRESETS).winWithin,
      assist: Math.random() < 0.5,
      answerId: undefined,
    });
  const randomizeSpecies = () => patch({ answerId: randomAnswerId(tree, merged.config.scopeRootId) });

  const auto = useMemo(() => dailyRules(date), [date]);
  const merged = useMemo(() => resolveDailyRules(date, draft), [date, draft]);
  const dayOverride = draft[date] ?? {};

  const scopeLeaves = useMemo(
    () => leavesUnder(tree, merged.config.scopeRootId),
    [tree, merged.config.scopeRootId]
  );
  const pinned = merged.answerId && tree.byId.has(merged.answerId) ? merged.answerId : null;
  const pinnedInScope = pinned ? scopeLeaves.includes(pinned) : true;
  const answerId = pinned ?? dailyAnswerId(tree, merged.config.scopeRootId, date);
  const answerNode = tree.byId.get(answerId);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const out = [];
    for (const id of scopeLeaves) {
      const n = tree.byId.get(id);
      if (n && displayName(n).toLowerCase().includes(needle)) out.push(n);
      if (out.length >= 30) break;
    }
    return out;
  }, [q, scopeLeaves, tree]);

  const exportJson = JSON.stringify(cleanPlan(draft), null, 2);
  const overrideDates = Object.keys(cleanPlan(draft)).sort();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore */
    }
  };

  const Header = (
    <header className="masthead">
      <div className="eyebrow">Curator · behind the scenes</div>
      <h1 className="title">Grebe</h1>
      <div className="subtitle">
        Pick or override the daily puzzle. Suggestions come from the auto-schedule; anything you set
        here wins. <a href="#">← back to game</a>
      </div>
    </header>
  );

  // ---- Login gate (live mode, not signed in) ----
  if (live && authReady && !session) {
    return (
      <div className="wrap admin">
        {Header}
        <div className="admin-login">
          <div className="admin-login-lab">Sign in to edit puzzles</div>
          <p>Only you can change the live daily. Enter your admin name and password.</p>
          <div className="admin-login-fields">
            <input
              type="text"
              autoComplete="username"
              placeholder="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
            <input
              type="password"
              autoComplete="current-password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && signIn()}
            />
            <Turnstile key={captchaKey} onToken={setCaptchaToken} />
            <button className="admin-rand" disabled={captchaEnabled && !captchaToken} onClick={signIn}>Sign in</button>
          </div>
          {authMsg && <p className="admin-authmsg is-err">{authMsg}</p>}
        </div>
      </div>
    );
  }
  if (live && !authReady) {
    return <div className="wrap admin">{Header}<p className="empty">Checking sign-in…</p></div>;
  }

  return (
    <div className="wrap admin">
      {Header}

      <div className="admin-statusbar">
        {live ? (
          <>
            <span className="admin-live">● Live</span>
            <span>Changes publish instantly for everyone.</span>
            {session && (
              <button className="linkbtn" onClick={() => supabase?.auth.signOut()}>
                Sign out ({fromEmail(session.user.email)})
              </button>
            )}
          </>
        ) : (
          <span className="admin-local">◌ Local draft — not published (see export below).</span>
        )}
        {saveErr && <span className="admin-saveerr">Save failed: {saveErr}</span>}
      </div>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        <button role="tab" aria-selected={tab === "health"} className={`admin-tab${tab === "health" ? " is-on" : ""}`} onClick={() => setTab("health")}>🩺 Health</button>
        <button role="tab" aria-selected={tab === "play"} className={`admin-tab${tab === "play" ? " is-on" : ""}`} onClick={() => setTab("play")}>🎮 Test bench</button>
        <button role="tab" aria-selected={tab === "pins"} className={`admin-tab${tab === "pins" ? " is-on" : ""}`} onClick={() => setTab("pins")}>📌 Pins</button>
        <button role="tab" aria-selected={tab === "schedule"} className={`admin-tab${tab === "schedule" ? " is-on" : ""}`} onClick={() => setTab("schedule")}>🗓 Schedule</button>
      </div>

      {tab === "health" && <ErrorBoundary label="System health"><SystemHealth tree={tree} /></ErrorBoundary>}

      {tab === "play" && <ErrorBoundary label="Test bench"><TestBench tree={tree} /></ErrorBoundary>}

      {tab === "pins" && <ErrorBoundary label="Pinned puzzles"><PinManager tree={tree} /></ErrorBoundary>}

      {tab === "schedule" && (
      <ErrorBoundary label="Schedule editor">
      <div className="admin-datebar">
        <label htmlFor="admin-date">Date</label>
        <input
          id="admin-date"
          type="date"
          value={date}
          onChange={(e) => { if (e.target.value) { setDate(e.target.value); setShowAnswer(false); } }}
        />
        <span className="admin-daytag">
          #{dailyNumber(date)} · {auto.dayName} · tier {auto.tier} {merged.overridden && <b>· overridden</b>}
        </span>
      </div>

      <div className="admin-preview">
        <div className="admin-preview-lab">This day plays</div>
        <div className="admin-preview-answer">
          {answerNode
            ? (showAnswer
                ? displayName(answerNode)
                : <button className="linkbtn" onClick={() => setShowAnswer(true)}>reveal species</button>)
            : "—"}
          {pinned ? <span className="tag">pinned</span> : <span className="tag auto">auto-pick</span>}
        </div>
        <div className="admin-preview-cfg">
          {scopeLabel(merged.config.scopeRootId)} · {resLabel(merged.config.winWithin)} ·{" "}
          {merged.assist ? "assist on" : "no assist"}
        </div>
        {!pinnedInScope && (
          <div className="admin-warn">⚠ Pinned species is outside the current scope — it won't sit on the tree. Change scope or re-pin.</div>
        )}
      </div>

      <div className="admin-tools">
        <button className="admin-rand" onClick={randomizeSetup}>🎲 Randomize setup</button>
        <button className="admin-rand" onClick={randomizeSpecies}>🎲 Random species</button>
        {!isEmptyDay(dayOverride) && (
          <button
            className="linkbtn"
            onClick={() => patch({ scopeRootId: undefined, winWithin: undefined, assist: undefined, answerId: undefined, note: undefined })}
          >
            Reset day to auto
          </button>
        )}
      </div>

      <div className="admin-grid">
        <div className="admin-field">
          <label>Scope</label>
          <select
            value={dayOverride.scopeRootId ?? ""}
            onChange={(e) => patch({ scopeRootId: e.target.value || undefined })}
          >
            <option value="">Auto — {scopeLabel(auto.config.scopeRootId)}</option>
            {SCOPE_PRESETS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label>Resolution</label>
          <select
            value={dayOverride.winWithin ?? ""}
            onChange={(e) => patch({ winWithin: e.target.value === "" ? undefined : Number(e.target.value) })}
          >
            <option value="">Auto — {resLabel(auto.config.winWithin)}</option>
            {RESOLUTION_PRESETS.map((r) => (
              <option key={r.winWithin} value={r.winWithin}>{r.label}</option>
            ))}
          </select>
        </div>

        <div className="admin-field">
          <label>Difficulty (assist)</label>
          <select
            value={dayOverride.assist === undefined ? "" : dayOverride.assist ? "on" : "off"}
            onChange={(e) =>
              patch({ assist: e.target.value === "" ? undefined : e.target.value === "on" })
            }
          >
            <option value="">Auto — {auto.assist ? "assist on" : "no assist"}</option>
            <option value="off">Hard — no assist</option>
            <option value="on">Focused — assist on</option>
          </select>
        </div>
      </div>

      <div className="admin-field admin-species">
        <label>Pin a species (optional — otherwise the deterministic pick is used)</label>
        <div className="admin-species-row">
          <input
            type="text"
            placeholder="Search within scope by common or Latin name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="admin-rand" onClick={randomizeSpecies} title="Pin a random species in scope">🎲</button>
          {dayOverride.answerId && (
            <button className="linkbtn" onClick={() => patch({ answerId: undefined })}>
              Clear pin (use auto)
            </button>
          )}
        </div>
        {results.length > 0 && (
          <div className="admin-results">
            {results.map((n) => (
              <button
                key={n.id}
                className={`admin-result${dayOverride.answerId === n.id ? " is-on" : ""}`}
                onClick={() => {
                  patch({ answerId: n.id });
                  setQ("");
                }}
              >
                {displayName(n)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="admin-field">
        <label>Note (for you; ignored by the game)</label>
        <input
          type="text"
          value={dayOverride.note ?? ""}
          onChange={(e) => patch({ note: e.target.value || undefined }, false)}
          onBlur={() => live && void persistDay(date, draft[date] ?? {})}
        />
      </div>

      {overrideDates.length > 0 && (
        <div className="admin-list">
          <div className="admin-list-ttl">Scheduled overrides</div>
          {overrideDates.map((d) => (
            <button
              key={d}
              className={`admin-list-item${d === date ? " is-on" : ""}`}
              onClick={() => setDate(d)}
            >
              {d}
            </button>
          ))}
        </div>
      )}

      <div className="admin-export">
        <div className="admin-export-head">
          <span>{live ? "backup / portable copy" : "dailyPlan.json"}</span>
          <button className="share-btn" onClick={copy}>{copied ? "Copied ✓" : "Copy JSON"}</button>
        </div>
        <p className="admin-export-hint">
          {live ? (
            <>Edits are saved to Supabase and live immediately. This JSON is just a portable backup.</>
          ) : (
            <>Your edits apply to <em>your own</em> game (reload to see them). To publish for everyone,
              paste this into <code>src/data/dailyPlan.json</code> and redeploy.</>
          )}
        </p>
        <pre className="admin-export-json">{exportJson}</pre>
      </div>
      </ErrorBoundary>
      )}
    </div>
  );
}
