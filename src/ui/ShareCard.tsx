import { useState } from "react";
import type { GameConfig, GuessResult } from "../core";
import { dailyNumber } from "../core";
import { RESOLUTION_PRESETS, SCOPE_PRESETS } from "../data/presets";
import { gamePoints } from "../data/score";
import { gameUrl } from "./share";

interface Props {
  config: GameConfig;
  guesses: GuessResult[]; // newest-first (as stored)
  status: "won" | "gaveup";
  hintCount: number;
  date: string;
  mode: "daily" | "free";
  /** The day's difficulty tier — only set for daily, drives the shared score. */
  tier?: number | null;
  /** The day's difficulty name (e.g. "Tricky"), shown in place of the date. */
  difficulty?: string | null;
  /** Current daily streak, shared on a daily win (null hides it). */
  streak?: number | null;
}

// Warmth → a cold-to-hot square. The answer itself is never encoded — only how
// close each guess landed, so the grid is safe to share.
function square(r: GuessResult): string {
  if (r.isWin) return "🎯";
  const w = r.warmth;
  if (w < 0.2) return "⬜";
  if (w < 0.4) return "🟦";
  if (w < 0.6) return "🟨";
  if (w < 0.8) return "🟧";
  return "🟥";
}

export function ShareCard({ config, guesses, status, hintCount, date, mode, tier, difficulty, streak }: Props) {
  const [copied, setCopied] = useState(false);

  const chrono = [...guesses].reverse();
  const row = chrono.map(square).join("") || "—";
  const scope = SCOPE_PRESETS.find((s) => s.id === config.scopeRootId)?.label ?? "All life";
  const res = RESOLUTION_PRESETS.find((r) => r.winWithin === config.winWithin)?.label ?? "";
  const n = guesses.length;
  const verdict = status === "won" ? `Solved in ${n}` : `Gave up · ${n} ${n === 1 ? "guess" : "guesses"}`;
  const hintLine = hintCount > 0 ? ` · ${hintCount} hint${hintCount === 1 ? "" : "s"}` : "";
  // Daily games earn a leaderboard score; show it (and share it).
  const score = mode === "daily" && tier != null ? gamePoints(status === "won", tier, n, hintCount) : null;
  const scoreLine = score != null ? ` · ${score} pts` : "";
  // Streak (daily wins only) — shared as a fire badge.
  const showStreak = mode === "daily" && status === "won" && streak != null && streak > 0;
  const streakLine = showStreak ? ` · 🔥${streak}` : "";

  // Header shows the daily number + difficulty (no date), or "free play".
  const label = mode === "daily" ? `№${dailyNumber(date)}${difficulty ? ` · ${difficulty}` : ""}` : "free play";
  const head = `🧬 Grebe Lineage · ${label}`;
  const sub = [scope, res].filter(Boolean).join(" · ");
  const text = `${head}\n${sub}\n${row}\n${verdict}${hintLine}${scoreLine}${streakLine}\n${gameUrl()}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <div className="share">
      <div className="share-head">
        🧬 Grebe Lineage <span>· {label}</span>
      </div>
      <div className="share-sub">{scope} · {res}</div>
      <div className="share-grid" aria-label={`convergence: ${row}`}>{row}</div>
      <div className="share-verdict">
        {verdict}{hintLine}
        {score != null && <span className="share-score"> · {score} pts</span>}
        {showStreak && <span className="share-streak"> · 🔥{streak}</span>}
      </div>
      <button className="share-btn" onClick={copy}>{copied ? "Copied ✓" : "Copy result"}</button>
    </div>
  );
}
