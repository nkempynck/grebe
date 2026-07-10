/** Friendly, plural common names for the major clades, so players can guess a
 *  GROUP ("snakes", "cats", "beetles") to scout the tree instead of only exact
 *  species. Keyed by the clade's scientific name as it appears in taxonomy.json.
 *  Applied at load (see loadTaxonomy). Clades not listed here are still guessable
 *  by their scientific name; these just get a nicer label + autocomplete entry.
 *  Unknown keys are harmless no-ops. */
export const CLADE_COMMON: Record<string, string> = {
  // broad groups
  Metazoa: "Animals",
  Vertebrata: "Vertebrates",
  Chordata: "Chordates",
  Tetrapoda: "Tetrapods",
  Amniota: "Amniotes",
  Arthropoda: "Arthropods",
  Mollusca: "Molluscs",
  Insecta: "Insects",
  Fungi: "Fungi",

  // vertebrates
  Mammalia: "Mammals",
  Aves: "Birds",
  Sauropsida: "Reptiles",
  Reptilia: "Reptiles",
  Squamata: "Lizards & snakes",
  Serpentes: "Snakes",
  Testudines: "Turtles",
  Crocodylia: "Crocodiles",
  Amphibia: "Amphibians",
  Anura: "Frogs",
  Caudata: "Salamanders",
  Actinopterygii: "Ray-finned fish",
  Chondrichthyes: "Cartilaginous fish",
  Elasmobranchii: "Sharks & rays",
  Selachii: "Sharks",

  // mammals
  Primates: "Primates",
  Carnivora: "Carnivorans",
  Felidae: "Cats",
  Canidae: "Dogs",
  Ursidae: "Bears",
  Chiroptera: "Bats",
  Rodentia: "Rodents",
  Cetacea: "Whales & dolphins",
  Artiodactyla: "Even-toed hoofed mammals",
  Perissodactyla: "Odd-toed hoofed mammals",
  Proboscidea: "Elephants",
  Metatheria: "Marsupials",
  Marsupialia: "Marsupials",

  // birds
  Passeriformes: "Perching birds",
  Anseriformes: "Waterfowl",
  Accipitriformes: "Birds of prey",
  Strigiformes: "Owls",

  // insects & other invertebrates
  Coleoptera: "Beetles",
  Lepidoptera: "Butterflies & moths",
  Hymenoptera: "Bees, wasps & ants",
  Diptera: "Flies",
  Odonata: "Dragonflies & damselflies",
  Orthoptera: "Grasshoppers & crickets",
  Hemiptera: "True bugs",
  Arachnida: "Arachnids",
  Araneae: "Spiders",
  Cephalopoda: "Octopuses & squid",
  Gastropoda: "Snails & slugs",
  Bivalvia: "Clams & mussels",
  Malacostraca: "Crustaceans",
  Decapoda: "Crabs, shrimp & lobsters",
  Anthozoa: "Corals & anemones",

  // plants & fungi
  Magnoliopsida: "Flowering plants (dicots)",
  Liliopsida: "Flowering plants (monocots)",
  Pinopsida: "Conifers",
  Polypodiopsida: "Ferns",
  Poaceae: "Grasses",
  Fabaceae: "Legumes",
  Asteraceae: "Daisies & sunflowers",
  Rosaceae: "Roses & allies",
  Orchidaceae: "Orchids",
  Agaricomycetes: "Mushrooms",
};
