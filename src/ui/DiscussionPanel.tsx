import { useCallback, useEffect, useState } from "react";
import { todayKey } from "../core/daily";
import {
  fetchComments,
  postComment,
  deleteComment,
  voteComment,
  fetchCommentCount,
  toThreads,
  type BoardKey,
  type Comment,
  type CommentSort,
  type Vote,
} from "../data/discussion";

/** ONE component for every board. It takes an opaque board key and a date and
 *  knows nothing about which game it is sitting under, so all three games (and any
 *  future one) mount the same thing with a different `board` prop. */
interface Props {
  /** Board key, e.g. "lineage". Matches what the server expects. */
  board: BoardKey;
  /** The puzzle date this board belongs to (YYYY-MM-DD). */
  date: string;
  /** Whether a backend exists at all (Supabase configured). */
  configured: boolean;
  /** Whether the viewer is signed in. Writing needs an account. */
  signedIn: boolean;
  /** Whether the viewer has finished this puzzle. For signed-out players this is
   *  the ONLY gate there can be (the server has no record of their play), so it is
   *  a soft lock by design, matching the leaderboard. */
  played: boolean;
  /** Human label for the board, used in the empty state. */
  label?: string;
  /** A standing board rather than a day's: no rollover, no completion gate, always writable.
   *  The server decides this too (is_open_board), so this only stops the UI offering or
   *  withholding things the server would then contradict. */
  permanent?: boolean;
  /** Heading over the board. */
  title?: string;
}

const MAX = 1000;
/** Threads shown before the board collapses behind a "show all". Chosen over a
 *  fixed-height scroll box: a nested scroller is awkward on a phone and hides the
 *  page's own end, whereas a busy day should simply not push the rest of the page
 *  off screen until asked. The server caps a board at 200 rows regardless. */
const VISIBLE_THREADS = 5;
/** Below this, an unfinished puzzle shows no nudge at all. One comment reads as an
 *  empty room, and there's no point advertising a conversation that isn't there. */
const MIN_TEASER = 2;

/** Compact relative time. A daily board only ever shows one day, but a permanent one outlives
 *  it, so this carries on into days and weeks rather than reporting "400h ago". */
function ago(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// Ownership comes from the server's is_mine flag rather than a display-name
// comparison, so it stays correct if a player renames themselves mid-day.
export function DiscussionPanel({
  board, date, configured, signedIn, played, label = "this puzzle",
  permanent = false, title = "Discussion",
}: Props) {
  // A board is READABLE for two days but WRITEABLE for one: yesterday's is closed.
  // The server enforces that in post_comment/vote_comment, so this only stops the UI
  // offering actions that would be refused — the same mistake as showing Reply on a
  // comment that could never accept one.
  //
  // A permanent board has no such day. Its date is a sentinel, so the comparison below would
  // call it closed forever.
  const writable = permanent || date === todayKey();
  const [sort, setSort] = useState<CommentSort>("top");
  const [rows, setRows] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // One shared error line for whichever write was last attempted. The server's
  // messages are already player-facing, so they're shown verbatim.
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // No editing, deliberately: a posted comment is final, and delete-and-repost
  // covers the typo case without a mutable-history problem to reason about.
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [showAll, setShowAll] = useState(false);
  // Comment count for the not-yet-finished nudge. Only fetched in that state, so a
  // finished board (which already has every row) never asks for it.
  const [teaser, setTeaser] = useState(0);

  const load = useCallback(async () => {
    const r = await fetchComments(board, date, sort);
    if (r.ok) {
      setRows(r.value);
      setLoadError(null);
    } else {
      setRows([]);
      setLoadError(r.error);
    }
  }, [board, date, sort]);

  useEffect(() => {
    if (!configured || played) return;
    let live = true;
    void fetchCommentCount(board, date).then((n) => { if (live) setTeaser(n ?? 0); });
    return () => { live = false; };
  }, [board, date, configured, played]);

  useEffect(() => {
    if (!configured || !played) return;
    let live = true;
    setRows(null);
    void fetchComments(board, date, sort).then((r) => {
      if (!live) return;
      if (r.ok) { setRows(r.value); setLoadError(null); }
      else { setRows([]); setLoadError(r.error); }
    });
    return () => { live = false; };
  }, [board, date, sort, configured, played]);

  // Not finished yet: no board (it would spoil the puzzle), just a one-line nudge —
  // and only when there is actually a conversation to come back for. A COUNT is not
  // a spoiler, which is why comment_counts() is ungated; the comments themselves
  // stay behind the completion gate.
  if (!configured) return null;
  if (!played) {
    // Nothing to offer on a closed board you never played: the puzzle is gone, so
    // "finish it to read them" would be an instruction you can't follow.
    if (!writable || teaser < MIN_TEASER) return null;
    return (
      <p className="disc-teaser">
        💬 {teaser} comments on today’s puzzle. Finish it to read them.
      </p>
    );
  }

  async function submitRoot() {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    setActionError(null);
    const r = await postComment(board, date, null, body);
    setBusy(false);
    if (!r.ok) { setActionError(r.error); return; }
    setDraft("");
    await load();
  }

  /** `clickedId` is the comment the box is sitting under, which is not necessarily
   *  what we post to: replying to a reply attaches to that thread's root, since
   *  there is only one level. The server enforces the same thing, so this only
   *  keeps the client's optimism honest. */
  async function submitReply(clickedId: number) {
    const body = replyDraft.trim();
    if (!body || busy) return;
    const clicked = (rows ?? []).find((r) => r.id === clickedId);
    const parentId = clicked ? clicked.parentId ?? clicked.id : clickedId;
    setBusy(true);
    setActionError(null);
    const r = await postComment(board, date, parentId, body);
    setBusy(false);
    if (!r.ok) { setActionError(r.error); return; }
    setReplyDraft("");
    setReplyTo(null);
    await load();
  }

  async function remove(id: number) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    const r = await deleteComment(id);
    setBusy(false);
    if (!r.ok) { setActionError(r.error); return; }
    await load();
  }

  /** Optimistic vote: adjust the row immediately, roll back if the server refuses.
   *  Clicking the active arrow again clears the vote (server takes 0). */
  async function vote(c: Comment, dir: 1 | -1) {
    if (busy || !signedIn) return;
    const next: Vote = c.myVote === dir ? 0 : dir;
    const before = rows;
    setRows((cur) =>
      (cur ?? []).map((r) => {
        if (r.id !== c.id) return r;
        const upDelta = (next === 1 ? 1 : 0) - (r.myVote === 1 ? 1 : 0);
        const downDelta = (next === -1 ? 1 : 0) - (r.myVote === -1 ? 1 : 0);
        return {
          ...r,
          myVote: next,
          up: r.up + upDelta,
          down: r.down + downDelta,
          score: r.score + upDelta - downDelta,
        };
      }),
    );
    setActionError(null);
    const r = await voteComment(c.id, next);
    if (!r.ok) {
      setRows(before);
      setActionError(r.error);
      return;
    }
    // Trust the server's returned score over the local guess.
    setRows((cur) => (cur ?? []).map((x) => (x.id === c.id ? { ...x, score: r.value } : x)));
  }

  const threads = rows ? toThreads(rows) : [];
  const shownThreads = showAll ? threads : threads.slice(0, VISIBLE_THREADS);
  // Tombstones aren't comments, so they don't count toward what's hidden.
  const hiddenCount = threads
    .slice(shownThreads.length)
    .reduce((n, t) => n + (t.root.isRemoved ? 0 : 1) + t.replies.length, 0);

  function renderBody(c: Comment) {
    if (c.isRemoved) return <p className="disc-body is-gone">Comment removed.</p>;
    return <p className="disc-body">{c.body}</p>;
  }

  function renderComment(c: Comment, isReply: boolean) {
    return (
      <div className={`disc-item${isReply ? " is-reply" : ""}${c.isMine ? " is-mine" : ""}`} key={c.id}>
        <div className="disc-votes">
          <button
            className={`disc-vote${c.myVote === 1 ? " is-on" : ""}`}
            onClick={() => void vote(c, 1)}
            disabled={!signedIn || !writable || c.isMine || c.isRemoved}
            aria-label="Upvote"
            title={c.isMine ? "You can’t vote on your own comment" : "Upvote"}
          >▲</button>
          <span className="disc-score">{c.score}</span>
          <button
            className={`disc-vote${c.myVote === -1 ? " is-on" : ""}`}
            onClick={() => void vote(c, -1)}
            disabled={!signedIn || !writable || c.isMine || c.isRemoved}
            aria-label="Downvote"
            title={c.isMine ? "You can’t vote on your own comment" : "Downvote"}
          >▼</button>
        </div>
        <div className="disc-main">
          <div className="disc-meta">
            <span className="disc-name">{c.displayName ?? "—"}</span>
            {c.isMine && <span className="lb-youtag">you</span>}
            <span className="disc-time">{ago(c.createdAt)}</span>
          </div>
          {renderBody(c)}
          {!c.isRemoved && (
            <div className="disc-actions">
              {signedIn && writable && (
                <button
                  className="disc-link"
                  onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyDraft(""); }}
                >
                  {replyTo === c.id ? "Cancel" : "Reply"}
                </button>
              )}
              {c.isMine && (
                <button className="disc-link" onClick={() => void remove(c.id)}>Delete</button>
              )}
            </div>
          )}
          {replyTo === c.id && (
            <div className="disc-compose is-inline">
              <textarea
                className="disc-input"
                value={replyDraft}
                maxLength={MAX}
                rows={3}
                placeholder="Reply…"
                onChange={(e) => setReplyDraft(e.target.value)}
              />
              <div className="disc-compose-foot">
                <span className="disc-count">{replyDraft.length}/{MAX}</span>
                <button className="disc-btn is-primary" disabled={busy || !replyDraft.trim()} onClick={() => void submitReply(c.id)}>
                  Reply
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="disc">
      <div className="disc-head">
        <div className="stats-sub">{title}</div>
        <div className="lb-segs">
          {(["top", "new"] as CommentSort[]).map((s) => (
            <button key={s} className={`lb-seg${sort === s ? " is-on" : ""}`} onClick={() => { setSort(s); setShowAll(false); }}>
              {s === "top" ? "Top" : "New"}
            </button>
          ))}
        </div>
      </div>

      {!writable ? (
        <p className="lb-nudge">This board is closed. You can still read it today.</p>
      ) : signedIn ? (
        <div className="disc-compose">
          <textarea
            className="disc-input"
            value={draft}
            maxLength={MAX}
            rows={3}
            placeholder={permanent ? `How is ${label} playing?` : `Talk about ${label}…`}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="disc-compose-foot">
            <span className="disc-count">{draft.length}/{MAX}</span>
            <button className="disc-btn is-primary" disabled={busy || !draft.trim()} onClick={() => void submitRoot()}>
              Post
            </button>
          </div>
        </div>
      ) : (
        <p className="lb-nudge">
          {permanent
            ? "Sign in to leave feedback. You do not need to finish a board first."
            : "Play with an account to join the discussion."}
        </p>
      )}

      {actionError && <p className="disc-error">{actionError}</p>}

      {rows === null ? (
        <p className="stats-empty">Loading…</p>
      ) : loadError ? (
        <p className="stats-empty">{loadError}</p>
      ) : threads.length === 0 ? (
        <p className="stats-empty">No comments yet. Be the first.</p>
      ) : (
        <>
          <div className="disc-list">
            {shownThreads.map(({ root, replies }) => (
              <div className="disc-thread" key={root.id}>
                {renderComment(root, false)}
                {replies.map((r) => renderComment(r, true))}
              </div>
            ))}
          </div>
          {hiddenCount > 0 && (
            <button className="disc-btn disc-more" onClick={() => setShowAll(true)}>
              Show {hiddenCount} more comment{hiddenCount === 1 ? "" : "s"}
            </button>
          )}
          {showAll && threads.length > VISIBLE_THREADS && (
            <button className="disc-btn disc-more" onClick={() => setShowAll(false)}>
              Show fewer
            </button>
          )}
        </>
      )}

      <p className="lb-note">
        {permanent
          ? "This board is permanent: it stays here rather than closing at the end of the day, so feedback keeps accumulating."
          : writable
          ? "Posting closes when the day rolls over. The board stays readable for one more day."
          : "Closed for posting. It stops being shown after today."}
      </p>
    </div>
  );
}
