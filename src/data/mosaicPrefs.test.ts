import { describe, it, expect } from "vitest";
import { sanitisePrefs, mosaicPrefsAreDefault } from "./mosaicPrefs";

// These come out of localStorage, which is to say out of whatever an older build wrote and
// whatever anyone has typed into devtools. A mechanic of "blurr" reaches the ladder lookup as an
// undefined rung width.
describe("mosaic prefs", () => {
  it("defaults to the shipping mechanic", () => {
    const p = sanitisePrefs(undefined);
    expect(p).toEqual({ mechanic: "shuffle" });
    expect(mosaicPrefsAreDefault(p)).toBe(true);
  });

  it("keeps a stored choice", () => {
    expect(sanitisePrefs({ mechanic: "blur" })).toEqual({ mechanic: "blur" });
  });

  // A beta player's browser still holds `tier` and `regionScheme`. The weekday sets the
  // difficulty for everyone now, and the table shows both maps at once, so reading either field
  // again would resurrect a setting with nothing on screen to explain it.
  it("drops beta settings rather than carrying them into the daily", () => {
    expect(sanitisePrefs({ tier: 6, regionScheme: "realm", mechanic: "blur" }))
      .toEqual({ mechanic: "blur" });
  });

  it("rejects an unknown mechanic", () => {
    expect(sanitisePrefs({ mechanic: "blurr" }).mechanic).toBe("shuffle");
  });

  it("ignores a key it does not know", () => {
    expect(sanitisePrefs({ somethingElse: 1, mechanic: "blur" })).toEqual({ mechanic: "blur" });
  });
});
