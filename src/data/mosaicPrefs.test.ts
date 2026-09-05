import { describe, it, expect } from "vitest";
import { sanitisePrefs, mosaicPrefsAreDefault } from "./mosaicPrefs";

// These come out of localStorage, which is to say out of whatever an older build wrote and
// whatever anyone has typed into devtools. A mechanic of "blurr" reaches the ladder lookup as an
// undefined rung width.
describe("mosaic prefs", () => {
  it("defaults to the shipping mechanic and continents", () => {
    const p = sanitisePrefs(undefined);
    expect(p).toEqual({ mechanic: "shuffle", regionScheme: "continent" });
    expect(mosaicPrefsAreDefault(p)).toBe(true);
  });

  it("keeps a stored choice", () => {
    expect(sanitisePrefs({ mechanic: "blur", regionScheme: "realm" }))
      .toEqual({ mechanic: "blur", regionScheme: "realm" });
  });

  // A beta player's browser still holds `tier`, and Mosaic is a daily now: the weekday sets the
  // difficulty for everyone. Reading that field again would force whatever tier they last
  // picked, with nothing on screen to explain why their week looked wrong.
  it("drops a beta difficulty rather than carrying it into the daily", () => {
    expect(sanitisePrefs({ tier: 6, mechanic: "blur", regionScheme: "realm" }))
      .toEqual({ mechanic: "blur", regionScheme: "realm" });
  });

  it("rejects an unknown mechanic or region scheme", () => {
    const p = sanitisePrefs({ mechanic: "blurr", regionScheme: "countries" });
    expect(p.mechanic).toBe("shuffle");
    expect(p.regionScheme).toBe("continent");
  });

  it("falls back per field, so one bad key does not discard the rest", () => {
    expect(sanitisePrefs({ regionScheme: "realm", mechanic: "nonsense" }))
      .toEqual({ mechanic: "shuffle", regionScheme: "realm" });
  });
});
