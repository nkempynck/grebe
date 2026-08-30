import { describe, it, expect } from "vitest";
import { sanitisePrefs, mosaicPrefsAreDefault } from "./mosaicPrefs";

// These come out of localStorage, which is to say out of whatever an older build wrote and
// whatever anyone has typed into devtools. A tier of 99 reaches mosaicAids; a mechanic of
// "blurr" reaches the ladder lookup as an undefined rung width.
describe("mosaic prefs", () => {
  it("defaults to the weekday ramp and the shipping mechanic", () => {
    const p = sanitisePrefs(undefined);
    expect(p).toEqual({ tier: 0, mechanic: "shuffle", regionScheme: "continent" });
    expect(mosaicPrefsAreDefault(p)).toBe(true);
  });

  it("keeps a stored choice", () => {
    expect(sanitisePrefs({ tier: 6, mechanic: "blur", regionScheme: "realm" }))
      .toEqual({ tier: 6, mechanic: "blur", regionScheme: "realm" });
  });

  it("clamps a tier rather than passing it on", () => {
    expect(sanitisePrefs({ tier: 99 }).tier).toBe(7);
    expect(sanitisePrefs({ tier: -4 }).tier).toBe(0);
    expect(sanitisePrefs({ tier: 3.6 }).tier).toBe(4);
    expect(sanitisePrefs({ tier: "brutal" }).tier).toBe(0);
  });

  it("rejects an unknown mechanic or region scheme", () => {
    const p = sanitisePrefs({ mechanic: "blurr", regionScheme: "countries" });
    expect(p.mechanic).toBe("shuffle");
    expect(p.regionScheme).toBe("continent");
  });

  it("falls back per field, so one bad key does not discard the rest", () => {
    expect(sanitisePrefs({ tier: 5, mechanic: "nonsense" }))
      .toEqual({ tier: 5, mechanic: "shuffle", regionScheme: "continent" });
  });
});
