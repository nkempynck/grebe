import { useState } from "react";
import type { GameConfig, GuessResult } from "../core";
import { dailyNumber } from "../core";
import { RESOLUTION_PRESETS, SCOPE_PRESETS } from "../data/presets";
import { gamePoints } from "../data/score";

interface Props {
  config: GameConfig;
  guesses: GuessResult[]; // newest-first (as stored)
  status: "won" | "gaveup";
  hintCount: number;
  date: string;
  mode: "daily" | "free";
  /** The day's difficulty tier — only set for daily, drives the shared score. */
  tier?: number | null;
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

export function ShareCard({ config, guesses, status, hintCount, date, mode, tier, streak }: Props) {
  const [copied, setCopied] = useState(false);

  const chrono = [...guesses].reverse();
  const row = chrono.map(square).join("") || "—";
  const scope = SCOPE_PRESETS.find((s) => s.id === config.scopeRootId)?.label ?? "All life";
  const res = RESOLUTION_PRESETS.find((r) => r.winWithin === config.winWithin)?.label ?? "";
  const n = guesses.length;
  const verdict = status === "won" ? `Solved in ${n}` : `Gave up · ${n} ${n === 1 ? "guess" : "guesses"}`;
  const hintLine = hintCount > 0 ? ` · ${hintCount} hint${hintCount === 1 ? "" : "s"}` : "";
  // Difficulty shown as filled/empty pips (matches the in-game daily indicator).
  const dots = mode === "daily" && tier != null ? "●".repeat(tier) + "○".repeat(Math.max(0, 7 - tier)) : null;
  // Weekday of the daily, for a friendlier header line.
  const day = mode === "daily" ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }) : null;
  // Daily games earn a leaderboard score; show it (and share it).
  const score = mode === "daily" && tier != null ? gamePoints(status === "won", tier, n, hintCount) : null;
  const scoreLine = score != null ? ` · ${score} pts` : "";
  // Streak (daily wins only) — shared as a fire badge.
  const showStreak = mode === "daily" && status === "won" && streak != null && streak > 0;
  const streakLine = showStreak ? ` · 🔥${streak}` : "";

  const head = mode === "daily" ? `🧬 Grebe · #${dailyNumber(date)} · ${date}${day ? ` (${day})` : ""}` : "🧬 Grebe · free play";
  const sub = [scope, res, dots].filter(Boolean).join(" · ");
  const text = `${head}\n${sub}\n${row}\n${verdict}${hintLine}${scoreLine}${streakLine}`;

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
        🧬 Grebe <span>· {mode === "daily" ? `#${dailyNumber(date)} · ${date}${day ? ` (${day})` : ""}` : "free play"}</span>
      </div>
      <div className="share-sub">
        {scope} · {res}
        {dots && <span className="share-dots"> · {dots}</span>}
      </div>
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
