import { useCallback, useEffect, useState } from "react";
import { fetchReplyUpdates, markRepliesSeen, type ReplyUpdate } from "../data/discussion";
import { todayKey } from "../core/daily";

interface Props {
  /** Whether the viewer is signed in. Replies only exist for an account. */
  signedIn: boolean;
  /** Whether a backend is configured at all. */
  configured: boolean;
  /** Refetch when this changes (e.g. after posting), so the count stays honest. */
  reloadKey?: number;
}

const GAME_LABEL: Record<string, string> = {
  combined: "combined board",
  lineage: "Lineage",
  kinship: "Kinship",
  branches: "Branches",
};

/** Which day a reply landed on, in words: boards are readable for two days, so
 *  "today" and "yesterday" cover every case the server can return. */
function dayWord(date: string): string {
  return date === todayKey() ? "today’s" : "yesterday’s";
}

/**
 * Unseen replies to your own comments, as a quiet bell in the masthead.
 *
 * There is no notifications table behind this: the server derives it from the
 * comments themselves plus one "seen" timestamp. And there is no realtime — the
 * count refreshes when the app loads or something changes, which for a daily game
 * people return to anyway is enough, and avoids a socket for a board that lives a
 * day.
 *
 * Always present for a signed-in player, so it can be found before it has anything
 * to say — a control that only exists once it has news is one nobody learns about.
 * The COUNT is what appears and disappears.
 */
export function ReplyBell({ signedIn, configured, reloadKey = 0 }: Props) {
  const [updates, setUpdates] = useState<ReplyUpdate[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!configured || !signedIn) { setUpdates([]); return; }
    let live = true;
    void fetchReplyUpdates().then((rows) => { if (live) setUpdates(rows); });
    return () => { live = false; };
  }, [configured, signedIn, reloadKey]);

  // Opening the list is what marks it read: the player has now seen them, so the
  // rows stay on screen while the count clears.
  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen && updates.length > 0) void markRepliesSeen();
      return !wasOpen;
    });
  }, [updates.length]);

  if (!configured || !signedIn) return null;

  return (
    <div className="bell-wrap">
      <button
        className="bell"
        onClick={toggle}
        aria-label={
          updates.length === 0
            ? "No new replies to you"
            : `${updates.length} new ${updates.length === 1 ? "reply" : "replies"} to you`
        }
        title="Replies to your comments"
      >
        💬{updates.length > 0 && <span className="bell-count">{updates.length}</span>}
      </button>

      {open && (
        <div className="bell-panel" role="dialog" aria-label="Replies to your comments">
          <div className="bell-head">
            <span>Replies to you</span>
            <button className="stats-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          </div>
          {updates.length === 0 && (
            <p className="bell-empty">No new replies. When someone answers a comment of yours, it shows up here.</p>
          )}
          <ul className="bell-list">
            {updates.map((u) => (
              <li className="bell-item" key={u.commentId}>
                <div className="bell-item-meta">
                  <b>{u.displayName ?? "Someone"}</b> replied on {dayWord(u.date)}{" "}
                  {GAME_LABEL[u.board] ?? u.board}
                </div>
                {u.body && <p className="bell-item-body">{u.body}</p>}
              </li>
            ))}
          </ul>
          {updates.length > 0 && (
            <p className="bell-note">
              Open that day’s board from the leaderboard to read the whole thread.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
