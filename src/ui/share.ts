import type { GameConfig, GuessResult } from "../core";
import { dailyNumber } from "../core";
import { RESOLUTION_PRESETS, SCOPE_PRESETS } from "../data/presets";
import { gamePoints } from "../data/score";

/** The canonical public URL, dropped at the end of a shared result to invite
 *  others straight to the game. Hardcoded (not window.location.origin) so a result
 *  copied from localhost or a preview deploy still links to the real site. Update
 *  here if the domain changes. */
export const SITE_URL = "https://grebegames.com";

export function gameUrl(): string {
  return SITE_URL;
}

/** Lineage's shared result, built once and read by both the share card and the
 *  post-round reveal (which offers the same copy without scrolling to the card).
 *  Returns the display pieces as well as the final text, so the two can't drift
 *  into telling different stories about the same round.
 *
 *  Warmth → a cold-to-hot square. The answer itself is never encoded, only how
 *  close each guess landed, so the grid is safe to share. */
function square(r: GuessResult): string {
  if (r.isWin) return "🎯";
  const w = r.warmth;
  if (w < 0.2) return "⬜";
  if (w < 0.4) return "🟦";
  if (w < 0.6) return "🟨";
  if (w < 0.8) return "🟧";
  return "🟥";
}

export interface LineageShare {
  label: string; scope: string; res: string; row: string;
  verdict: string; hintLine: string; score: number | null;
  showStreak: boolean; text: string;
}

export function lineageShare(a: {
  config: GameConfig;
  guesses: GuessResult[]; // newest-first (as stored)
  status: "won" | "gaveup";
  hintCount: number;
  date: string;
  mode: "daily" | "free";
  tier?: number | null;
  difficulty?: string | null;
  streak?: number | null;
}): LineageShare {
  const chrono = [...a.guesses].reverse();
  const row = chrono.map(square).join("") || "—";
  const scope = SCOPE_PRESETS.find((s) => s.id === a.config.scopeRootId)?.label ?? "All life";
  const res = RESOLUTION_PRESETS.find((r) => r.winWithin === a.config.winWithin)?.label ?? "";
  const n = a.guesses.length;
  const verdict = a.status === "won" ? `Solved in ${n}` : `Gave up · ${n} ${n === 1 ? "guess" : "guesses"}`;
  const hintLine = a.hintCount > 0 ? ` · ${a.hintCount} hint${a.hintCount === 1 ? "" : "s"}` : "";
  // Daily games earn a leaderboard score; show it (and share it).
  const score = a.mode === "daily" && a.tier != null ? gamePoints(a.status === "won", a.tier, n, a.hintCount) : null;
  const scoreLine = score != null ? ` · ${score} pts` : "";
  // Streak (daily wins only) — shared as a fire badge.
  const showStreak = a.mode === "daily" && a.status === "won" && a.streak != null && a.streak > 0;
  const streakLine = showStreak ? ` · 🔥${a.streak}` : "";
  // Header shows the daily number + difficulty (no date), or "free play".
  const label = a.mode === "daily" ? `№${dailyNumber(a.date)}${a.difficulty ? ` · ${a.difficulty}` : ""}` : "free play";
  const head = `🧬 Grebe Lineage · ${label}`;
  const sub = [scope, res].filter(Boolean).join(" · ");
  return {
    label, scope, res, row, verdict, hintLine, score, showStreak,
    text: `${head}\n${sub}\n${row}\n${verdict}${hintLine}${scoreLine}${streakLine}\n${gameUrl()}`,
  };
}

/** Branches' shareable grid: ONE ROW PER SUBMIT, one square per slot in board
 *  order, so a board won after a mistake shows the row it went wrong on above the
 *  clean one. `attempts` holds a char per slot ("1" correct / "0" wrong) per
 *  submit; `square` renders a slot that came up correct (🟩, or 🟨/🟦 when help
 *  was used — help belongs to the slot, not the submit, so it shows from the row
 *  the slot first came up correct on). A wrong slot is always ⬛.
 *
 *  With no history — a board restored from the server (which keeps only summary
 *  stats), or one finished before attempts were recorded — it falls back to a
 *  single row of the final state, which is what the grid always used to show. */
export function branchesShareRows(
  slotIds: string[],
  attempts: string[],
  square: (slotId: string) => string
): string[] {
  if (attempts.length === 0) return [slotIds.map(square).join("")];
  return attempts.map((row) => slotIds.map((s, i) => (row[i] === "1" ? square(s) : "⬛")).join(""));
}
