import { useState, type ReactNode } from "react";

type Game = "lineage" | "kinship" | "branches" | "mosaic";

interface Props {
  game: Game;
  /** The one-line verdict, in the game's own words. */
  verdict: ReactNode;
  /** Facts about the round, joined with " · ". Falsy entries are dropped. */
  stats: (string | false | null | undefined)[];
  /** An optional extra line under the stats (a close call, a rule that ended it). */
  note?: ReactNode;
  /** The share squares as they appear in the copied text, one string per row. */
  squares?: string[] | null;
  /** What "Copy result" puts on the clipboard. */
  shareText: string;
  /** The "played today" line, for a finished daily. */
  locked?: string | null;
}

/**
 * The end of every game: the verdict, one line of facts, the share squares and a copy button.
 * Shared by all four games so they read the same and can't drift apart. Each fact appears
 * once: the copied text carries the full header, the page does not repeat it in a card.
 */
export function ResultBlock({ game, verdict, stats, note, squares, shareText, locked }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable: no-op */
    }
  };
  // Mosaic's row builder answers "—" for a round with no guesses on this device; that is a
  // placeholder for the copied text, not something to show.
  const rows = (squares ?? []).filter((r) => r && r !== "—");
  return (
    <section className="rb" data-game={game}>
      <p className="rb-verdict">{verdict}</p>
      <p className="rb-stats">{stats.filter(Boolean).join(" · ")}</p>
      {note && <p className="rb-note">{note}</p>}
      {rows.length > 0 && (
        <div className="rb-squares" aria-label="Shareable result">
          {rows.map((r, i) => <div key={i}>{r}</div>)}
        </div>
      )}
      <button className="share-btn rb-copy" onClick={copy}>{copied ? "Copied ✓" : "Copy result"}</button>
      {locked && <p className="rb-lock">{locked}</p>}
    </section>
  );
}
