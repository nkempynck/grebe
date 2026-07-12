import { useState } from "react";
import type { Tree } from "../core";
import { dailyNumber } from "../core";
import { useGridGame } from "../hooks/useGridGame";
import { resolveDailyRules } from "../data/dailySchedule";
import type { GridGroup } from "../core";

/** Group-level → share square. Level 0 is the broadest/most obvious group, level
 *  3 the trickiest — a fixed difficulty scale (yellow → green → blue → purple)
 *  matching the colour classes in CSS, like Connections. */
const LEVEL_SQUARE = ["🟨", "🟩", "🟦", "🟪"];

function GroupBar({ tree, group, dimmed }: { tree: Tree; group: GridGroup; dimmed?: boolean }) {
  const names = group.memberIds.map((id) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id);
  return (
    <div className={`grid-solved lvl-${group.level}${dimmed ? " is-dim" : ""}`}>
      <div className="grid-solved-label">
        {group.label}
        {group.sciLabel && group.sciLabel !== group.label && <span className="grid-solved-sci"> · {group.sciLabel}</span>}
      </div>
      <div className="grid-solved-members">{names.join(" · ")}</div>
    </div>
  );
}

export function GridGame({ tree }: { tree: Tree }) {
  const g = useGridGame(tree);
  const [copied, setCopied] = useState(false);

  if (!g.board) return <p className="empty">No grid puzzle available today.</p>;

  const over = g.status !== "playing";
  const rules = resolveDailyRules(g.date);
  const pips = "●".repeat(g.tier) + "○".repeat(Math.max(0, 7 - g.tier));
  const day = new Date(`${g.date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const nameOf = (id: string) => tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;

  // Unsolved groups, revealed only after a loss (so the answer is always shown).
  const solvedIds = new Set(g.solvedGroups.map((x) => x.cladeId));
  const unsolved = g.board.groups.filter((x) => !solvedIds.has(x.cladeId));

  // Share: the classic coloured-square grid, one row per guess.
  const shareText = (() => {
    const head = `🧬 Grebe Grid · #${dailyNumber(g.date)} · ${g.date} (${day})`;
    const rows = g.attempts.map((r) => r.map((l) => LEVEL_SQUARE[l]).join("")).join("\n");
    const verdict =
      g.status === "won"
        ? `Solved ${g.attempts.length ? `in ${g.attempts.length}` : ""} · ${g.mistakes} mistake${g.mistakes === 1 ? "" : "s"}`
        : `Missed it · ${g.solvedGroups.length}/4 groups`;
    return `${head}\n${pips}\n${rows}\n${verdict}`;
  })();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="grid-game">
      <div className="grid-head">
        <span className="grid-eyebrow">Grid №{dailyNumber(g.date)}</span>
        <span className="grid-diff">
          <span className="dr-dots" aria-hidden="true">{pips}</span>
          {rules.dayName} · {rules.difficulty}
        </span>
      </div>

      {!over && g.attempts.length === 0 && g.solvedGroups.length === 0 && (
        <p className="empty">
          Sixteen species, four hidden groups of four. Each group is a clade —
          related organisms that belong together. Pick four you think share a group,
          then guess. {g.mistakesLeft} wrong guesses allowed.
        </p>
      )}

      {/* Solved groups — plus, after a loss, the ones never found (dimmed). Always
          ordered by difficulty level so the colours read as a scale, like
          Connections (easiest/yellow at top, trickiest/purple at the bottom). */}
      {[
        ...g.solvedGroups.map((grp) => ({ grp, dimmed: false })),
        ...(g.status === "lost" ? unsolved.map((grp) => ({ grp, dimmed: true })) : []),
      ]
        .sort((a, b) => a.grp.level - b.grp.level)
        .map(({ grp, dimmed }) => (
          <GroupBar key={grp.cladeId} tree={tree} group={grp} dimmed={dimmed} />
        ))}

      {/* The live board. */}
      {!over && (
        <>
          <div className="grid-board" role="group" aria-label="Species tiles">
            {g.remaining.map((id) => {
              const on = g.selected.includes(id);
              return (
                <button
                  key={id}
                  className={`grid-tile${on ? " is-sel" : ""}`}
                  aria-pressed={on}
                  onClick={() => g.toggle(id)}
                >
                  {nameOf(id)}
                </button>
              );
            })}
          </div>

          <div className="grid-mistakes" aria-label={`${g.mistakesLeft} guesses left`}>
            <span className="grid-mistakes-lbl">Mistakes left</span>
            <span className="grid-dots">
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i} className={`grid-dot${i < g.mistakes ? " is-used" : ""}`} aria-hidden="true" />
              ))}
            </span>
          </div>

          {g.feedback && <div className="grid-feedback" role="status">{g.feedback}</div>}

          <div className="grid-controls">
            <button className="linkbtn" onClick={g.shuffle}>Shuffle</button>
            <button className="linkbtn" onClick={g.deselectAll} disabled={g.selected.length === 0}>
              Deselect all
            </button>
            <button
              className="grid-submit"
              onClick={g.submit}
              disabled={g.selected.length !== 4}
            >
              Guess
            </button>
          </div>
        </>
      )}

      {/* Result + share. */}
      {over && (
        <div className="grid-result">
          <div className="grid-verdict">
            {g.status === "won"
              ? `Solved with ${g.mistakes} mistake${g.mistakes === 1 ? "" : "s"}`
              : `Out of guesses — found ${g.solvedGroups.length}/4`}
          </div>
          <div className="share">
            <div className="share-head">🧬 Grebe Grid <span>· №{dailyNumber(g.date)} · {g.date} ({day})</span></div>
            <div className="grid-share-rows">
              {g.attempts.map((r, i) => (
                <div key={i} className="grid-share-row">{r.map((l) => LEVEL_SQUARE[l]).join("")}</div>
              ))}
            </div>
            <button className="share-btn" onClick={copy}>{copied ? "Copied ✓" : "Copy result"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
