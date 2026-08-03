import { describe, it, expect, vi, beforeEach } from "vitest";

// The module talks to Supabase; stub the client so these tests exercise the
// client-side contract (row mapping, thread grouping, how a server refusal is
// surfaced) without a network. The gates themselves are enforced in SQL and are
// not what this file is testing.
const rpc = vi.fn();
vi.mock("./supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

// Values come through a dynamic import so the vi.mock above is in place first;
// the type comes through a type-only import, which is erased at runtime.
import type { Comment } from "./discussion";
const { toThreads, fetchComments, postComment, voteComment, fetchCommentCount } =
  await import("./discussion");

/** Minimal comment, overridable per test. */
function c(over: Partial<Comment> & { id: number }): Comment {
  return {
    parentId: null,
    displayName: "someone",
    body: "hi",
    up: 0,
    down: 0,
    score: 0,
    myVote: 0,
    replyCount: 0,
    createdAt: "2026-08-03T10:00:00Z",
    isMine: false,
    isRemoved: false,
    ...over,
  } as Comment;
}

beforeEach(() => rpc.mockReset());

describe("toThreads", () => {
  it("keeps the server's root ordering rather than re-sorting", () => {
    // The server decides 'top' vs 'new'; the client must not second-guess it.
    const t = toThreads([c({ id: 5, score: 1 }), c({ id: 2, score: 99 }), c({ id: 9, score: 50 })]);
    expect(t.map((x) => x.root.id)).toEqual([5, 2, 9]);
  });

  it("attaches replies to their parent, in the order given", () => {
    const t = toThreads([
      c({ id: 1 }),
      c({ id: 11, parentId: 1 }),
      c({ id: 12, parentId: 1 }),
      c({ id: 2 }),
    ]);
    expect(t).toHaveLength(2);
    expect(t[0].replies.map((r) => r.id)).toEqual([11, 12]);
    expect(t[1].replies).toEqual([]);
  });

  it("drops an orphaned reply instead of throwing", () => {
    // Can happen if a parent falls out of the window the server returned.
    const t = toThreads([c({ id: 1 }), c({ id: 99, parentId: 404 })]);
    expect(t).toHaveLength(1);
    expect(t[0].replies).toEqual([]);
  });

  it("returns nothing for an empty board", () => {
    expect(toThreads([])).toEqual([]);
  });
});

describe("fetchComments", () => {
  it("maps snake_case rows and normalises a stray my_vote", () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: 7, parent_id: null, display_name: "kestrel", body: "nice one",
          up: 3, down: 1, score: 2, my_vote: 7, reply_count: 1,
          created_at: "2026-08-03T09:00:00Z", is_mine: true, is_removed: false,
        },
      ],
      error: null,
    });
    return fetchComments("lineage", "2026-08-03").then((r) => {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const row = r.value[0];
      expect(row.displayName).toBe("kestrel");
      expect(row.replyCount).toBe(1);
      expect(row.isMine).toBe(true);
      // Anything that isn't 1 or -1 has to collapse to "no vote", or the arrows
      // would render in an impossible state.
      expect(row.myVote).toBe(0);
    });
  });

  it("passes the board through as p_game and never hardcodes a game", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await fetchComments("some-future-game", "2026-08-03", "new");
    expect(rpc).toHaveBeenCalledWith("puzzle_comments", {
      p_game: "some-future-game",
      p_date: "2026-08-03",
      p_sort: "new",
      p_limit: 200,
    });
  });

  it("surfaces a server refusal verbatim", async () => {
    // These messages are the ONLY explanation a player gets, so they must not be
    // swallowed or rewritten (unlike the best-effort recorders in games.ts).
    rpc.mockResolvedValue({ data: null, error: { message: "Finish today's puzzle to read the discussion." } });
    const r = await fetchComments("lineage", "2026-08-03");
    expect(r).toEqual({ ok: false, error: "Finish today's puzzle to read the discussion." });
  });

  it("treats an unexpected client failure as a refusal, not a crash", async () => {
    // Drives the catch branch WITHOUT throwing inside the mock: Vitest reports an
    // error raised in a mock implementation as a test error in its own right, even
    // when the code under test catches it. A null payload makes the destructure
    // throw inside the try instead, which is the same branch.
    rpc.mockResolvedValue(null);
    const r = await fetchComments("lineage", "2026-08-03");
    expect(r.ok).toBe(false);
  });
});

describe("postComment", () => {
  it("sends a null parent for a top-level comment and returns the new id", async () => {
    rpc.mockResolvedValue({ data: 42, error: null });
    const r = await postComment("kinship", "2026-08-03", null, "  padded  ");
    expect(r).toEqual({ ok: true, value: 42 });
    expect(rpc).toHaveBeenCalledWith("post_comment", {
      p_game: "kinship", p_date: "2026-08-03", p_parent_id: null, p_body: "  padded  ",
    });
  });

  it("surfaces the length and screening refusals as-is", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "That comment isn't allowed." } });
    const r = await postComment("lineage", "2026-08-03", null, "nope");
    expect(r).toEqual({ ok: false, error: "That comment isn't allowed." });
  });
});

describe("voteComment", () => {
  it("returns the server's recomputed score, not a local guess", async () => {
    rpc.mockResolvedValue({ data: -2, error: null });
    const r = await voteComment(3, -1);
    expect(r).toEqual({ ok: true, value: -2 });
  });

  it("reports the self-vote refusal", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "You can't vote on your own comment." } });
    const r = await voteComment(3, 1);
    expect(r.ok).toBe(false);
  });
});

describe("fetchCommentCount", () => {
  it("swallows failure, because the count is decoration", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await fetchCommentCount("lineage", "2026-08-03")).toBeNull();
  });

  it("returns the number when the server gives one", async () => {
    rpc.mockResolvedValue({ data: 12, error: null });
    expect(await fetchCommentCount("lineage", "2026-08-03")).toBe(12);
  });
});
