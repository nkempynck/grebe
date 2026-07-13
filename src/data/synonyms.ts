// Curated guess synonyms: an alternate name a player might type → the scientific
// name of the species it should resolve to. Kept as DATA so it can grow without
// touching the resolver. Entries whose target isn't in the current snapshot are
// simply ignored at load, so over-inclusion is harmless.
//
// Only needed where the alternate ISN'T already the species' common name in the
// data (those match exactly anyway). Names are matched case/diacritic/punctuation
// -insensitively, so only spelling variants of meaning need listing here.
//
// Broader coverage will eventually come from GBIF's full vernacular-name lists at
// taxonomy-build time; this hand list fills the well-known gaps until then.

export const SYNONYMS: Record<string, string> = {
  // Cetaceans
  orca: "Orcinus orca",
  "killer whale": "Orcinus orca",
  "sperm whale": "Physeter macrocephalus",
  // Big cats & felids
  puma: "Puma concolor",
  cougar: "Puma concolor",
  "mountain lion": "Puma concolor",
  catamount: "Puma concolor",
  panther: "Panthera pardus",
  "black panther": "Panthera pardus",
  jaguar: "Panthera onca",
  cheetah: "Acinonyx jubatus",
  // Canids
  wolf: "Canis lupus",
  "gray wolf": "Canis lupus",
  "grey wolf": "Canis lupus",
  "timber wolf": "Canis lupus",
  coyote: "Canis latrans",
  "red fox": "Vulpes vulpes",
  // Bears
  "grizzly bear": "Ursus arctos",
  grizzly: "Ursus arctos",
  "brown bear": "Ursus arctos",
  "polar bear": "Ursus maritimus",
  // Primates
  chimp: "Pan troglodytes",
  chimpanzee: "Pan troglodytes",
  human: "Homo sapiens",
  // Ungulates & others
  moose: "Alces alces",
  elk: "Cervus canadensis",
  reindeer: "Rangifer tarandus",
  caribou: "Rangifer tarandus",
  bison: "Bison bison",
  buffalo: "Bison bison",
  hippo: "Hippopotamus amphibius",
  rhino: "Rhinoceros unicornis",
  // Birds
  "bald eagle": "Haliaeetus leucocephalus",
  "peregrine falcon": "Falco peregrinus",
  mallard: "Anas platyrhynchos",
  "barn owl": "Tyto alba",
  robin: "Turdus migratorius",
  // Reptiles & amphibians
  "king cobra": "Ophiophagus hannah",
  "komodo dragon": "Varanus komodoensis",
  "bullfrog": "Lithobates catesbeianus",
  // Fish & sharks
  "great white shark": "Carcharodon carcharias",
  "great white": "Carcharodon carcharias",
  "whale shark": "Rhincodon typus",
  "clownfish": "Amphiprion ocellaris",
  "nemo": "Amphiprion ocellaris",
  // Inverts
  "monarch butterfly": "Danaus plexippus",
  "honey bee": "Apis mellifera",
  "honeybee": "Apis mellifera",
  tarantula: "Theraphosa blondi",
};
