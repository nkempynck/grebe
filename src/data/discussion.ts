import { supabase } from "./supabase";

// Client for the per-puzzle discussion boards (see supabase/discussions.sql).
//
// GENERIC ON PURPOSE. Nothing here names a game. A board is identified by an
// opaque `board` key plus the puzzle date, so all three games share this one
// module and a fourth needs no change to it. The RPCs call the same argument
// p_game; that is the only place the game-specific name survives.
//
// DIFFERENT ERROR CONVENTION FROM THE REST OF THIS FOLDER. The recorders in
// games.ts are best-effort: they swallow failures and return false, because a
// score that fails to sync is not the player's problem to solve. Comments are the
// opposite. Every refusal the server raises is written as player-facing text
// ("Comments are limited to 1000 characters", "Finish today's puzzle before
// joining the discussion"), and it is the only explanation the player will get,
// since the profanity refusal is deliberately generic. So these wrappers return a
// discriminated result and pass error.message straight through.

/** Opaque board key. Deliberately a plain string, not a union of game names, so
 *  adding a game needs no edit here. */
export type BoardKey = string;
export type CommentSort = "top" | "new";
export type Vote = -1 | 0 | 1;

export interface Comment {
  id: number;
  parentId: number | null;
  /** null when the comment was removed (the server withholds it). */
  displayName: string | null;
  /** null when removed; the client renders a tombstone instead. */
  body: string | null;
  up: number;
  down: number;
  score: number;
  myVote: Vote;
  replyCount: number;
  createdAt: string;
  isMine: boolean;
  isRemoved: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Shape returned by puzzle_comments(); never includes user_id by design. */
interface CommentRow {
  id: number;
  parent_id: number | null;
  display_name: string | null;
  body: string | null;
  up: number;
  down: number;
  score: number;
  my_vote: number;
  reply_count: number;
  created_at: string;
  is_mine: boolean;
  is_removed: boolean;
}

function toComment(r: CommentRow): Comment {
  return {
    id: r.id,
    parentId: r.parent_id,
    displayName: r.display_name,
    body: r.body,
    up: r.up ?? 0,
    down: r.down ?? 0,
    score: r.score ?? 0,
    myVote: (r.my_vote === 1 ? 1 : r.my_vote === -1 ? -1 : 0) as Vote,
    replyCount: r.reply_count ?? 0,
    createdAt: r.created_at,
    isMine: !!r.is_mine,
    isRemoved: !!r.is_removed,
  };
}

const NO_BACKEND = "The discussion needs a connection.";

function failed(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : NO_BACKEND };
}

/** One board's comments, flat and pre-ordered (each root followed by its replies).
 *  The server gates this: a signed-in caller must have finished the puzzle, and
 *  the date must be today. A refusal arrives as a readable message. */
export async function fetchComments(
  board: BoardKey,
  date: string,
  sort: CommentSort = "top",
): Promise<Result<Comment[]>> {
  if (!supabase) return { ok: false, error: NO_BACKEND };
  try {
    const { data, error } = await supabase.rpc("puzzle_comments", {
      p_game: board,
      p_date: date,
      p_sort: sort,
      p_limit: 200,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: ((data ?? []) as CommentRow[]).map(toComment) };
  } catch (e) {
    return failed(e);
  }
}

/** Post to a board, or reply when parentId is set. Returns the new id. */
export async function postComment(
  board: BoardKey,
  date: string,
  parentId: number | null,
  body: string,
): Promise<Result<number>> {
  if (!supabase) return { ok: false, error: NO_BACKEND };
  try {
    const { data, error } = await supabase.rpc("post_comment", {
      p_game: board,
      p_date: date,
      p_parent_id: parentId,
      p_body: body,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: data as number };
  } catch (e) {
    return failed(e);
  }
}

// There is deliberately no editComment: a posted comment is final. Delete and
// repost covers a typo, and it keeps voting honest (nobody can rewrite a comment
// after it has been upvoted).

/** Author-only soft delete. The row survives so its replies keep their shape. */
export async function deleteComment(id: number): Promise<Result<true>> {
  if (!supabase) return { ok: false, error: NO_BACKEND };
  try {
    const { error } = await supabase.rpc("delete_comment", { p_id: id });
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: true };
  } catch (e) {
    return failed(e);
  }
}

/** 1 up, -1 down, 0 clears. Returns the comment's new score. */
export async function voteComment(id: number, value: Vote): Promise<Result<number>> {
  if (!supabase) return { ok: false, error: NO_BACKEND };
  try {
    const { data, error } = await supabase.rpc("vote_comment", { p_id: id, p_value: value });
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: data as number };
  } catch (e) {
    return failed(e);
  }
}

/** Live comment count. Ungated (a count is not a spoiler), so it works before the
 *  board itself is readable and can label the affordance. Best-effort: the count
 *  is decoration, so this one DOES swallow failures, like games.ts. */
export async function fetchCommentCount(board: BoardKey, date: string): Promise<number | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("comment_counts", { p_game: board, p_date: date });
    if (error) return null;
    return typeof data === "number" ? data : null;
  } catch {
    return null;
  }
}

/** One unseen reply to something the caller wrote. */
export interface ReplyUpdate {
  commentId: number;
  parentId: number | null;
  board: BoardKey;
  date: string;
  displayName: string | null;
  body: string | null;
  createdAt: string;
  /** Arrived since the player last opened the list. Drives the count; the row is
   *  listed either way, so a reply you glanced at is still reachable afterwards. */
  isNew: boolean;
}

/** Recent replies to your own comments, newest first, each flagged `isNew` when it
 *  arrived since you last opened the list. Bounded server-side by the same two-day
 *  read window as the boards, so it can never point at a board you're no longer
 *  allowed to open. Best-effort: an unavailable badge is not worth an error state. */
export async function fetchReplyUpdates(): Promise<ReplyUpdate[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase.rpc("my_reply_updates");
    if (error || !data) return [];
    return (data as Array<{
      comment_id: number; parent_id: number | null; game: string; puzzle_date: string;
      display_name: string | null; body: string | null; created_at: string; is_new: boolean;
    }>).map((r) => ({
      commentId: r.comment_id,
      parentId: r.parent_id,
      board: r.game,
      date: r.puzzle_date,
      displayName: r.display_name,
      body: r.body,
      createdAt: r.created_at,
      isNew: r.is_new,
    }));
  } catch {
    return [];
  }
}

/** Stamp the "seen" cursor, so what was just read stops counting as new. */
export async function markRepliesSeen(): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.rpc("mark_replies_seen");
  } catch {
    /* best-effort: the worst case is the badge reappearing next load */
  }
}

/** Group the flat server list into threads, preserving the server's ordering. The
 *  server already returns each root followed by its replies; this makes the shape
 *  explicit for rendering, and tolerates an orphaned reply. */
export function toThreads(list: Comment[]): { root: Comment; replies: Comment[] }[] {
  const byId = new Map<number, { root: Comment; replies: Comment[] }>();
  const order: number[] = [];
  for (const c of list) {
    if (c.parentId === null) {
      byId.set(c.id, { root: c, replies: [] });
      order.push(c.id);
    }
  }
  for (const c of list) {
    if (c.parentId !== null) byId.get(c.parentId)?.replies.push(c);
  }
  return order.map((id) => byId.get(id)!).filter(Boolean);
}
