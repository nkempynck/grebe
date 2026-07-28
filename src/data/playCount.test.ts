import { describe, it, expect, beforeEach, vi } from "vitest";

// The counter talks to Supabase; stub the client so the test exercises the
// once-per-day logic (the whole point of the module, since the server has no
// identifier to dedupe on) without a network.
const rpc = vi.fn();
vi.mock("./supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

// Tests run in node, where localStorage doesn't exist.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

const { countPlay } = await import("./playCount");

describe("countPlay", () => {
  beforeEach(() => {
    store.clear();
    rpc.mockReset();
    rpc.mockResolvedValue({ error: null });
  });

  it("sends the game, date and result, and nothing else", async () => {
    await countPlay("lineage", "2026-07-28", true);
    expect(rpc).toHaveBeenCalledWith("bump_play", { p_game: "lineage", p_date: "2026-07-28", p_won: true });
  });

  it("counts a given game+date only once per device", async () => {
    expect(await countPlay("lineage", "2026-07-28", true)).toBe(true);
    expect(await countPlay("lineage", "2026-07-28", true)).toBe(false); // reload
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("counts each game and each day separately", async () => {
    await countPlay("lineage", "2026-07-28", true);
    await countPlay("kinship", "2026-07-28", false);
    await countPlay("lineage", "2026-07-29", false);
    expect(rpc).toHaveBeenCalledTimes(3);
  });

  it("retries on a later visit when the server didn't accept it", async () => {
    rpc.mockResolvedValue({ error: { message: "plays.sql not run" } });
    expect(await countPlay("branches", "2026-07-28", true)).toBe(false);
    rpc.mockResolvedValue({ error: null });
    expect(await countPlay("branches", "2026-07-28", true)).toBe(true);
  });

  it("never throws when the call blows up", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    await expect(countPlay("lineage", "2026-07-28", true)).resolves.toBe(false);
  });
});
