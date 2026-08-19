import { useState } from "react";
import type { GameConfig, GuessResult } from "../core";
import { lineageShare } from "./share";

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

export function ShareCard({ config, guesses, status, hintCount, date, mode, tier, difficulty, streak }: Props) {
  const [copied, setCopied] = useState(false);

  // Grid, verdict and copied text all come from lineageShare (see share.ts, next
  // to Branches' own builder), so the reveal can offer the identical result rather
  // than a second implementation of it that has to be kept in step by hand.
  const { label, scope, res, row, verdict, hintLine, score, showStreak, text } =
    lineageShare({ config, guesses, status, hintCount, date, mode, tier, difficulty, streak });

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
