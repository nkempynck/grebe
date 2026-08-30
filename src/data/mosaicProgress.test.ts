import { describe, it, expect } from "vitest";
import {
  sanitiseProgress, usableProgress, MOSAIC_PROGRESS_V, SEEN_MEMORY, type MosaicProgress,
} from "./mosaicProgress";

const board = (over: Partial<MosaicProgress> = {}): MosaicProgress => ({
  v: MOSAIC_PROGRESS_V,
  answerId: "lion",
  shot: { src: "https://x/lion-1024.jpg", full: "https://x/lion.jpg", credit: null },
  guessIds: ["tiger", "wolf"],
  gaveUp: false,
  pathIds: ["carnivores"],
  tier: 1,
  seen: ["lion"],
  recentGroups: ["Mammals"],
  ...over,
});

// This is whatever an older build left in the browser, so every field is treated as hostile.
describe("mosaic progress, from storage", () => {
  it("keeps a well-formed board", () => {
    expect(sanitiseProgress(board())).toEqual(board());
  });

  it("discards a blob from an older shape rather than misreading it", () => {
    expect(sanitiseProgress({ ...board(), v: 0 })).toBeNull();
    expect(sanitiseProgress(undefined)).toBeNull();
    expect(sanitiseProgress("nonsense")).toBeNull();
  });

  it("refuses a board with no answer or no picture, which is not a board", () => {
    expect(sanitiseProgress({ ...board(), answerId: "" })).toBeNull();
    expect(sanitiseProgress({ ...board(), shot: undefined })).toBeNull();
    expect(sanitiseProgress({ ...board(), shot: { src: "", full: "x", credit: null } })).toBeNull();
  });

  it("falls back to the sized picture when the original is missing", () => {
    const p = sanitiseProgress({ ...board(), shot: { src: "a.jpg", credit: null } })!;
    expect(p.shot.full).toBe("a.jpg");
  });

  it("drops junk out of the id lists instead of failing the whole board", () => {
    const p = sanitiseProgress({ ...board(), guessIds: ["tiger", 7, null, "wolf"], pathIds: "no" })!;
    expect(p.guessIds).toEqual(["tiger", "wolf"]);
    expect(p.pathIds).toEqual([]);
  });

  it("caps the anti-repeat memory so the blob stays bounded", () => {
    const many = Array.from({ length: SEEN_MEMORY + 40 }, (_, i) => `s${i}`);
    const p = sanitiseProgress({ ...board(), seen: many })!;
    expect(p.seen).toHaveLength(SEEN_MEMORY);
    // The most RECENT are the ones worth keeping: the point is not re-dealing what you just saw.
    expect(p.seen[p.seen.length - 1]).toBe(many[many.length - 1]);
  });
});

describe("mosaic progress, against the world", () => {
  const opts = {
    tier: 1,
    canBeAnswer: (id: string) => id === "lion",
    knows: (id: string) => ["lion", "tiger", "carnivores"].includes(id),
  };

  it("resumes a board that is still playable", () => {
    expect(usableProgress(board(), opts)?.answerId).toBe("lion");
  });

  it("will not resume across a difficulty change", () => {
    // The obscurity floor moves with the tier, so the answer pool genuinely differs.
    expect(usableProgress(board({ tier: 6 }), opts)).toBeNull();
  });

  it("will not resume an answer the pool no longer holds", () => {
    // A taxonomy rebuild can drop a species, and the floor can rise over it.
    expect(usableProgress(board({ answerId: "dodo" }), opts)).toBeNull();
  });

  it("drops unknown guesses rather than the whole game", () => {
    // Losing a row off the table is a far smaller loss than losing the board you were mid-way
    // through, so an unrecognised guess is filtered, not fatal.
    const p = usableProgress(board(), opts)!;
    expect(p.guessIds).toEqual(["tiger"]);
    expect(p.pathIds).toEqual(["carnivores"]);
  });

  it("has nothing to say about an absent board", () => {
    expect(usableProgress(null, opts)).toBeNull();
  });
});
