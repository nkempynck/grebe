import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Tree } from "../core";
import { dailyAnswerId, displayName, leavesUnder, randomAnswerId } from "../core";
import { todayKey, dailyNumber } from "../core/daily";
import { RESOLUTION_PRESETS, SCOPE_PRESETS } from "../data/presets";
import { dailyRules, resolveDailyRules } from "../data/dailySchedule";
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

// Each backend SQL file exposes a *_schema_check() RPC; the panel calls all of
// them so one glance confirms every file applied. A missing RPC = that file was
// never run.
const SCHEMA_CHECKS = [
  { rpc: "schema_check", label: "Core", file: "schema.sql" },
  { rpc: "grid_schema_check", label: "Kinship", file: "kinship.sql" },
  { rpc: "puzzles_schema_check", label: "Puzzles", file: "puzzles.sql" },
  { rpc: "names_schema_check", label: "Names", file: "names.sql" },
  { rpc: "badges_schema_check", label: "Badges", file: "badges.sql" },
];

interface FileCheck {
  label: string;
  file: string;
  rows: Array<[string, boolean]> | null; // null → RPC unavailable (file not applied)
  error: string | null;
}

/** Live "is the schema up to date?" panel — calls every backend file's
 *  *_schema_check() RPC and flags any file that's missing or incomplete. */
function SchemaCheck() {
  const [results, setResults] = useState<FileCheck[] | null>(null);
  const [loading, setLoading] = useState(true);

  const run = useCallback(async () => {
    if (!supabase) return;
    const sb = supabase; // capture the non-null client for the async closures below
    setLoading(true);
    const out = await Promise.all(
      SCHEMA_CHECKS.map(async (c): Promise<FileCheck> => {
        const { data, error } = await sb.rpc(c.rpc);
        if (error || !data) return { label: c.label, file: c.file, rows: null, error: error?.message ?? "no response" };
        return { label: c.label, file: c.file, rows: Object.entries(data as Record<string, boolean>), error: null };
      })
    );
    setResults(out);
    setLoading(false);
  }, []);
  useEffect(() => { void run(); }, [run]);

  const failing = results?.filter((r) => r.rows === null || r.rows.some(([, ok]) => !ok)) ?? [];
  const allOk = results !== null && failing.length === 0;

  return (
    <div className={`admin-schema${allOk ? " is-ok" : results ? " is-bad" : ""}`}>
      <div className="admin-schema-head">
        <span className="admin-schema-ttl">
          {loading ? "Checking schema…"
            : allOk ? "✓ All schema files up to date"
            : `⚠ ${failing.length} schema file${failing.length === 1 ? "" : "s"} need attention`}
        </span>
        <button className="linkbtn" onClick={() => void run()} disabled={loading}>Re-check</button>
      </div>
      {results && !allOk && (
        <>
          <ul className="admin-schema-list">
            {results.map((r) => {
              if (r.rows === null) {
                return <li key={r.file} className="is-bad">✗ <b>{r.label}</b> — <code>{r.file}</code> not applied ({r.error})</li>;
              }
              const bad = r.rows.filter(([, ok]) => !ok).map(([k]) => k);
              return bad.length === 0
                ? <li key={r.file} className="is-ok">✓ <b>{r.label}</b> <code>{r.file}</code></li>
                : <li key={r.file} className="is-bad">✗ <b>{r.label}</b> — missing: {bad.join(", ")}</li>;
            })}
          </ul>
          <p className="admin-schema-hint">Run the flagged file(s) in the Supabase SQL editor (safe to re-run), then re-check.</p>
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = async () => {
    if (!supabase || !email.trim() || !password) return;
    if (captchaEnabled && !captchaToken) { setAuthMsg("Please complete the CAPTCHA."); return; }
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
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
  const [draft, setDraft] = useState<DailyPlan>(live ? {} : loadLocalDraft);
  const [date, setDate] = useState(todayKey());
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);

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
          <p>Only you can change the live daily. Enter your admin username and password.</p>
          <div className="admin-login-fields">
            <input
              type="text"
              autoComplete="username"
              placeholder="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
                Sign out ({session.user.email})
              </button>
            )}
          </>
        ) : (
          <span className="admin-local">◌ Local draft — not published (see export below).</span>
        )}
        {saveErr && <span className="admin-saveerr">Save failed: {saveErr}</span>}
      </div>

      {live && session && <SchemaCheck />}

      <div className="admin-datebar">
        <label htmlFor="admin-date">Date</label>
        <input
          id="admin-date"
          type="date"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <span className="admin-daytag">
          #{dailyNumber(date)} · {auto.dayName} · tier {auto.tier} {merged.overridden && <b>· overridden</b>}
        </span>
      </div>

      <div className="admin-preview">
        <div className="admin-preview-lab">This day plays</div>
        <div className="admin-preview-answer">
          {answerNode ? displayName(answerNode) : "—"}
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
    </div>
  );
}
