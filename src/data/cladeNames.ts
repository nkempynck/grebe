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

  // ---- finer clades, mainly for the grid game's group labels ----
  // (family/order level; the grid generator prefers a named clade, so naming the
  //  recognisable rank here surfaces it instead of an obscure parent clade)

  // mammals
  Caniformia: "Dog-like carnivores",
  Feliformia: "Cat-like carnivores",
  Mustelidae: "Weasels & otters",
  Phocidae: "True seals",
  Cervidae: "Deer",
  Bovidae: "Cattle & antelope",
  Caprinae: "Sheep & goats",
  Delphinidae: "Dolphins",
  Odontoceti: "Toothed whales",
  Mysticeti: "Baleen whales",
  Vespertilionidae: "Vesper bats",
  Sciuridae: "Squirrels",
  Muridae: "Old World rats & mice",
  Cricetidae: "Voles & hamsters",
  Leporidae: "Rabbits & hares",
  Lagomorpha: "Rabbits, hares & pikas",
  Lepus: "Hares",
  Soricidae: "Shrews",
  Eulipotyphla: "Shrews & moles",
  Diprotodontia: "Kangaroos & possums",
  Macropodidae: "Kangaroos & wallabies",
  Dasyuridae: "Carnivorous marsupials",
  Peramelemorphia: "Bandicoots",

  // birds
  Accipitridae: "Hawks & eagles",
  Falconidae: "Falcons",
  Picidae: "Woodpeckers",
  Scolopacidae: "Sandpipers",
  Ardeidae: "Herons & egrets",
  Columbiformes: "Pigeons & doves",
  Psittaciformes: "Parrots",
  Trochilidae: "Hummingbirds",
  Apodiformes: "Swifts & hummingbirds",
  Podicipedidae: "Grebes",
  Galliformes: "Gamebirds",
  Anserinae: "Swans & geese",
  Threskiornithidae: "Ibises & spoonbills",
  Phalacrocoracidae: "Cormorants",
  Cuculiformes: "Cuckoos",

  // reptiles & amphibians
  Iguania: "Iguanas & anoles",
  Phrynosomatidae: "Spiny lizards",
  Lacertidae: "Wall lizards",
  Scincidae: "Skinks",
  Gekkonidae: "Geckos",
  Anguimorpha: "Monitor lizards & allies",
  Viperidae: "Vipers",
  Crotalinae: "Pit vipers",
  Natrix: "Grass snakes",
  Nerodia: "Water snakes",
  Alligatoridae: "Alligators & caimans",
  Testudinidae: "Tortoises",
  Emydidae: "Pond turtles",
  Cheloniidae: "Sea turtles",
  Salamandridae: "Newts & fire salamanders",
  Plethodontidae: "Lungless salamanders",
  Bufonidae: "True toads",
  Ranidae: "True frogs",

  // fish
  Salmonidae: "Salmon & trout",
  Siluriformes: "Catfish",
  Ictaluridae: "North American catfish",
  Batoidea: "Skates & rays",
  Myliobatiformes: "Stingrays",
  Lamniformes: "Mackerel sharks",
  Gadiformes: "Cod & hake",
  Anguillidae: "Freshwater eels",
  Pleuronectidae: "Righteye flounders",
  Percidae: "Perches",
  Sciaenidae: "Drums & croakers",
  Centrarchiformes: "Sunfishes",
  Labriformes: "Wrasses & parrotfish",
  Embiotocidae: "Surfperches",
  Muraenidae: "Moray eels",
  Characiformes: "Tetras & allies",

  // insects & other arthropods
  Anisoptera: "Dragonflies",
  Zygoptera: "Damselflies",
  Coccinellidae: "Ladybirds",
  Syrphidae: "Hoverflies",
  Culicidae: "Mosquitoes",
  Vespidae: "Hornets & wasps",
  Halictidae: "Sweat bees",
  Pentatomidae: "Shield bugs",
  Coreoidea: "Leaf-footed bugs",
  Caelifera: "Grasshoppers",
  Tettigoniidae: "Katydids",
  Scarabaeoidea: "Scarab & stag beetles",
  Adephaga: "Ground & tiger beetles",
  Pieridae: "Whites & sulphurs",
  Trichoptera: "Caddisflies",
  Euphausiacea: "Krill",
  Isopoda: "Woodlice & isopods",
  Amphipoda: "Amphipods",
  Ixodida: "Ticks",
  Opiliones: "Harvestmen",
  Eriophyidae: "Gall mites",

  // molluscs
  Octopoda: "Octopuses",
  Loliginidae: "Inshore squid",
  Ommastrephidae: "Flying squid",
  Nudibranchia: "Sea slugs",
  Haliotidae: "Abalones",
  Helicidae: "Land snails",
  Neogastropoda: "Whelks",
  Pteriomorphia: "Scallops, oysters & mussels",

  // plants
  Pinaceae: "Pines, firs & spruces",
  Pinus: "Pines",
  Cupressaceae: "Cypresses",
  Juniperus: "Junipers",
  Fagales: "Beeches & oaks",
  Caryophyllaceae: "Pinks & campions",
  Polygonaceae: "Docks & knotweeds",
  Ranunculaceae: "Buttercups",
  Brassicaceae: "Cabbages & mustards",
  Apiaceae: "Carrots & parsleys",
  Rubiaceae: "Bedstraws",
  Caprifoliaceae: "Honeysuckles",
  Arecaceae: "Palms",
  Onagraceae: "Willowherbs",
  Geranium: "Cranesbills",
  Equisetum: "Horsetails",
  Saliceae: "Willows & poplars",

  // fungi & corals
  Cantharellales: "Chanterelles",
  Actiniaria: "Sea anemones",
  Scleractinia: "Stony corals",
  Octocorallia: "Soft corals",

  // GBIF-vernacular corrections — the derived name was factually wrong or badly
  // scoped (found via scripts/name-review.tsv). These override the baked name.
  Herpestidae: "Mongooses", // GBIF said "Civets" (a different family)
  Haemulidae: "Grunts", // GBIF said "Bonnetmouths"
  Lutjanidae: "Snappers", // GBIF said "Fusiliers"
  Setophaga: "Wood warblers", // GBIF said "Redstarts" (misleads — these are warblers)
  Anatidae: "Ducks, geese & swans", // GBIF said "Dabbling Ducks" (too narrow)
  Amanita: "Amanitas", // GBIF said "Amanita Sect. Lepidella"
  Equus: "Horses", // GBIF said "Cavalo" (Portuguese)
  Craniata: "Craniates", // GBIF said "Craniate Brachiopods"
  Gryllidae: "Crickets", // GBIF said "Blast" (garbage)
  Gavia: "Loons", // GBIF said "Indet. Diver" (placeholder)
  Planorbidae: "Ramshorn snails", // GBIF said "Indet. Ramshorn"
  Rhinolophus: "Horseshoe bats", // GBIF said "Horseshoe Bat species"
  Nyctalus: "Noctule bats", // GBIF said "Nyctalus Bat species"
  Equidae: "Horses, zebras & asses", // GBIF said "Asses" (too narrow)
  Varanus: "Monitor lizards", // GBIF said "Leguaans" (regional)
  Gammarus: "Scuds", // GBIF said "Malacostracans" (whole-class name on a genus)

  // Genus-board labels (injected genus nodes) — clean up the group names players
  // see on the new within-clade boards (cats / ducks / whales).
  Panthera: "Big cats", // was sci-only
  Felis: "Small cats", // GBIF said just "Cat"
  Lynx: "Lynxes", // GBIF said "Bobcats" (only one of them is a bobcat)
  Leopardus: "Spotted cats", // GBIF said "American Small Cats"
  Cygnus: "Swans", // was sci-only
  Aythya: "Diving ducks", // GBIF said "Scaups, Pochards"
  Anas: "Dabbling ducks", // GBIF said "Mallards, Pintails"
  Phocoenidae: "Porpoises", // GBIF said "Mereswine" (archaic)
};
