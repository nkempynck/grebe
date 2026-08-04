import { describe, it, expect } from "vitest";
import { boardSpoilers, isFullyRedacted, namesTell, redactSpoilers, stem, tellingWords } from "./redact";
import type { TaxonNode } from "./types";

const sp = (common: string, sciName: string): TaxonNode =>
  ({ id: common, common, sciName, rank: "species", parentId: null }) as TaxonNode;

/** The reptile board from a reported leak: three snakes, one whiptail, one chameleon. */
const REPTILES = [
  sp("Western whiptail", "Aspidoscelis tigris"),
  sp("Corn snake", "Pantherophis guttatus"),
  sp("Milk snake", "Lampropeltis triangulum"),
  sp("Western hognose snake", "Heterodon nasicus"),
  sp("Panther chameleon", "Furcifer pardalis"),
];

/** The beetle board from a reported leak. */
const BEETLES = [
  sp("European chafer", "Amphimallon majale"),
  sp("Eastern Hercules Beetle", "Dynastes tityus"),
  sp("Asian long-horned beetle", "Anoplophora glabripennis"),
  sp("Colorado potato beetle", "Leptinotarsa decemlineata"),
];

/** How the card renders it: hidden runs become blocks, everything else stays. */
const shown = (text: string, species: TaxonNode[], spare?: Set<string>) =>
  redactSpoilers(text, boardSpoilers(species, spare)).map((s) => (s.hidden ? "[#]" : s.text)).join("");

/** The hoverfly board from a reported leak: the Syrphidae summary wrote "hover flies". */
const FLIES = [
  sp("Marmalade hoverfly", "Episyrphus balteatus"),
  sp("Housefly", "Musca domestica"),
  sp("Western honey bee", "Apis mellifera"),
];

describe("stem", () => {
  it("folds regular plurals onto the singular", () => {
    for (const [a, b] of [["beetle", "beetles"], ["fly", "flies"], ["fox", "foxes"], ["snake", "snakes"]]) {
      expect(stem(a)).toBe(stem(b));
    }
  });
  it("folds a participle onto its bare noun", () => {
    for (const [a, b] of [["horned", "horn"], ["spotted", "spots"], ["striped", "stripe"], ["banded", "bands"]]) {
      expect(stem(a)).toBe(stem(b));
    }
  });
  it("leaves short words alone", () => {
    expect(stem("leo")).toBe("leo");
    expect(stem("Bos")).toBe("bos");
  });
});

describe("boardSpoilers", () => {
  it("counts a word as telling only when one species on the board has it", () => {
    const [whiptail, corn] = boardSpoilers(REPTILES);
    expect([...whiptail.telling]).toEqual([stem("whiptail")]); // "western" is shared with the hognose
    expect([...corn.telling]).toEqual([stem("corn")]); // "snake" is shared with two others
  });
});

describe("tellingWords / namesTell", () => {
  const telling = tellingWords(REPTILES);

  it("flags a clade whose common name carries a telling word", () => {
    // The label would hand the tile over, so Branches shows the Latin instead.
    expect(namesTell("Chameleons", telling)).toBe(true);
    expect(namesTell("Whiptail lizards", telling)).toBe(true);
  });

  it("leaves a clade whose common name only shares a word with several tiles", () => {
    expect(namesTell("Colubrid snakes", telling)).toBe(false);
    expect(namesTell("Lizards", telling)).toBe(false);
  });

  it("spares a word that pads hundreds of names, in prose only", () => {
    const board = [sp("Common raven", "Corvus corax"), sp("Black drongo", "Dicrurus macrocercus")];
    const spare = new Set([stem("common")]);
    // Ordinary English in an article, so no block…
    expect(shown("It is common across Eurasia.", board, spare)).toBe("It is common across Eurasia.");
    // …but the full name and the other telling words still go.
    expect(shown("The common raven is a large corvid.", board, spare)).toBe("The [#] is a large corvid.");
    // A label is not prose: it sits beside the tray, so nothing is spared there.
    expect(namesTell("Common ravens", tellingWords(board))).toBe(true);
  });

  it("treats the reported Tursiops board the same way", () => {
    const cetaceans = [
      sp("Common bottlenose dolphin", "Tursiops truncatus"),
      sp("Irrawaddy dolphin", "Orcaella brevirostris"),
      sp("Amazon river dolphin", "Inia geoffrensis"),
      sp("Narwhal", "Monodon monoceros"),
      sp("Vaquita", "Phocoena sinus"),
    ];
    const words = tellingWords(cetaceans);
    expect(namesTell("Bottlenose Dolphin", words)).toBe(true); // "bottlenose" singles it out
    expect(words.has(stem("dolphin"))).toBe(false); // shared by three tiles
  });
});

describe("redactSpoilers", () => {
  it("hides the word that singles a species out, not the words around it", () => {
    expect(shown("Aspidoscelis is a genus of whiptail lizards in the family Teiidae.", REPTILES))
      .toBe("Aspidoscelis is a genus of [#] lizards in the family Teiidae.");
    // "horn" goes with it: the tray holds a long-horned beetle, and participles fold
    // onto their bare noun, so this line cannot name a horn beetle either.
    expect(shown("Other common names include Hercules beetles, unicorn beetles or horn beetles.", BEETLES))
      .toBe("Other common names include [#] beetles, unicorn beetles or [#] beetles.");
  });

  it("leaves a word shared by several species on the board", () => {
    expect(shown("Colubridae is a family of snakes found worldwide.", REPTILES))
      .toBe("Colubridae is a family of snakes found worldwide.");
    expect(shown("Dynastinae or rhinoceros beetles are a subfamily of the scarab beetle family.", BEETLES))
      .toBe("Dynastinae or rhinoceros beetles are a subfamily of the scarab beetle family.");
  });

  it("hides a whole name in one block, plural included", () => {
    const board = [sp("Narwhal", "Monodon monoceros"), sp("Beluga whale", "Delphinapterus leucas")];
    expect(shown("The narwhal and the beluga whale are Monodontidae.", board))
      .toBe("The [#] and the [#] are Monodontidae.");
    expect(shown("Corn snakes are docile.", REPTILES)).toBe("[#] are docile.");
  });

  it("hides the binomial and its abbreviation but never the bare genus", () => {
    const board = [sp("Lion", "Panthera leo")];
    expect(shown("Panthera leo was described in 1758; P. leo is social.", board))
      .toBe("[#] was described in 1758; [#] is social.");
    expect(shown("Panthera is a genus of cats.", board)).toBe("Panthera is a genus of cats.");
  });

  it("merges neighbouring telling words into one block", () => {
    // Not the full name (no "beetle"), so this is two telling words in a row.
    expect(shown("Colorado potato pests are a costly problem.", BEETLES))
      .toBe("[#] pests are a costly problem.");
  });

  it("ignores the bare 's' of a possessive name", () => {
    // Three tiles carry "whale", so only "beaked" singles a species out here.
    const board = [
      sp("Cuvier's beaked whale", "Ziphius cavirostris"),
      sp("False killer whale", "Pseudorca crassidens"),
      sp("Beluga whale", "Delphinapterus leucas"),
      sp("Vaquita", "Phocoena sinus"),
    ];
    expect(shown("Baird's beaked whales were hunted off Japan.", board))
      .toBe("Baird's [#] whales were hunted off Japan.");
    // The possessive still counts inside the whole name.
    expect(shown("Cuvier's beaked whale dives deep.", board)).toBe("[#] dives deep.");
  });

  it("only matches whole words", () => {
    expect(shown("The dandelion and the lionfish are unrelated.", [sp("Lion", "Panthera leo")]))
      .toBe("The dandelion and the lionfish are unrelated.");
  });

  it("hides a telling word even where it is the article's own subject", () => {
    // The card for this clade is titled by its Latin name precisely because
    // "chameleon" gives a tile away (see namesTell), so the prose hides it too.
    expect(shown("Chameleons are a family of lizards; the panther chameleon is one.", REPTILES))
      .toBe("[#] are a family of lizards; the [#] is one.");
  });

  it("does not blank a one-word name shared with another species on the board", () => {
    // "Cat" alone can't be hidden without blacking out every "cats" on the page,
    // and it settles nothing while Wild cat is also in the tray. The two-word name
    // is still an exact hit.
    const board = [sp("Cat", "Felis catus"), sp("Wild cat", "Felis silvestris")];
    expect(shown("Cats are small carnivores; wild cats hunt alone.", board))
      .toBe("Cats are small carnivores; [#] hunt alone.");
  });

  it("hides a name the article respells with a space", () => {
    // The reported leak: Syrphidae read "Hoverflies, also called hover flies", and the
    // two-word spelling walked straight past a word-for-word match.
    expect(shown("Hoverflies, also called hover flies, are a large family of flies.", FLIES))
      .toBe("[#], also called [#], are a large family of flies.");
    // …and the other way round, an article running a two-word name together.
    expect(shown("Houseflies and house flies are the same insect.", FLIES))
      .toBe("[#] and [#] are the same insect.");
  });

  it("hides a hyphenated name the article writes as a compound", () => {
    // The reported leak: "longhorn beetles" over a tray holding the Asian long-horned
    // beetle. "long" singles a tile out on its own, so it goes wherever it appears.
    expect(shown("Cerambycidae, the longhorn beetles, have very long antennae.", BEETLES))
      .toBe("Cerambycidae, the [#] beetles, have very [#] antennae.");
    // A clade label is the same giveaway, so Branches shows the Latin for this genus.
    expect(namesTell("Milkweed Longhorns", tellingWords(BEETLES))).toBe(true);
  });

  it("passes the text through when there is nothing to hide", () => {
    const text = "Felidae is a family of mammals.";
    expect(redactSpoilers(text, [])).toEqual([{ text, hidden: false }]);
    expect(shown(text, REPTILES)).toBe(text);
  });

  it("hides overlapping matches once, longest first", () => {
    expect(shown("The Eastern Hercules Beetle is large.", BEETLES)).toBe("The [#] is large.");
  });

  it("flags a summary that redaction left unreadable", () => {
    const board = [sp("Narwhal", "Monodon monoceros")];
    expect(isFullyRedacted(redactSpoilers("Monodontidae includes the narwhal.", boardSpoilers(board)))).toBe(false);
    expect(isFullyRedacted(redactSpoilers("Narwhal.", boardSpoilers(board)))).toBe(true);
  });
});
