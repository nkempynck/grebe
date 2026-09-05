import { describe, expect, it } from "vitest";
import { looksNonPhoto } from "./wikipedia";

const THUMB = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/";
const FULL = "https://upload.wikimedia.org/wikipedia/commons/a/a1/";

describe("looksNonPhoto", () => {
  it("rejects a vector Wikipedia has rasterised to a PNG", () => {
    // Both of these reached real boards. The name ends .png, so the .svg tail test never
    // fired, and in the second the rasterised ".svg" pushed "size" off the end of the name
    // where the tail rule was looking for it.
    expect(looksNonPhoto(`${THUMB}Chiasmocleis_ventrimaculata_map-fr.svg/1280px-Chiasmocleis_ventrimaculata_map-fr.svg.png`)).toBe(true);
    expect(looksNonPhoto(`${THUMB}South_Asian_river_dolphin_size_comparison.svg/960px-South_Asian_river_dolphin_size_comparison.svg.png`)).toBe(true);
  });

  it("still rejects a plain SVG, and a missing url", () => {
    expect(looksNonPhoto(`${FULL}Some_cladogram.svg`)).toBe(true);
    expect(looksNonPhoto(undefined)).toBe(true);
  });

  it("keeps the query string from breaking the test", () => {
    // Wikipedia appends utm_* params; stripping them is what makes the extension readable.
    expect(looksNonPhoto(`${THUMB}Foo_map-fr.svg/1280px-Foo_map-fr.svg.png?utm_source=en.wikipedia.org`)).toBe(true);
  });

  it("rejects maps, charts and food by name", () => {
    expect(looksNonPhoto(`${FULL}Dendrolagus_mayri_map.png`)).toBe(true);
    expect(looksNonPhoto(`${FULL}Panthera_leo_distribution.png`)).toBe(true);
    expect(looksNonPhoto(`${FULL}Blue_grenadier_fillet_sandwich.jpg`)).toBe(true);
  });

  it("keeps the photographs the word rules were tuned not to eat", () => {
    // Every one of these was a real casualty of an earlier substring rule.
    expect(looksNonPhoto(`${FULL}Northern_Map_Turtle.jpg`)).toBe(false);
    expect(looksNonPhoto(`${FULL}Turkey_vulture_(Cathartes_aura).jpg`)).toBe(false);
    expect(looksNonPhoto(`${FULL}Podiceps_cristatus_chick.jpg`)).toBe(false);
    expect(looksNonPhoto(`${FULL}Orange_Walk_beetle.jpg`)).toBe(false);
    // A GIF is a raster format and every one in the set is a real subject image.
    expect(looksNonPhoto(`${FULL}Tubifex_tubifex.gif`)).toBe(false);
  });
});
