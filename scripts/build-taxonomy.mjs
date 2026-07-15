#!/usr/bin/env node
// Build-time taxonomy snapshot. Two sources, each doing what it's best at:
//
//   * GBIF  — picks a BALANCED, RECOGNIZABLE set of species (per-group quotas,
//     filled by occurrence volume) and supplies English common names.
//   * Open Tree of Life — supplies the real evolutionary TOPOLOGY connecting
//     those species, including the named clades GBIF's backbone omits (Amniota,
//     Tetrapoda, …). This is what lets the game teach shared ancestry.
//
// Writes src/data/taxonomy.json (nodes + scopes). Run: npm run build:taxonomy.
// It hits the network; the app itself never does — it just reads the JSON.

import { writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { COMMON_NAME_OVERRIDES } from "./common-name-overrides.mjs";

const GBIF = "https://api.gbif.org/v1";
const OTL = "https://api.opentreeoflife.org/v3";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "taxonomy.json");
// Human-review dump of every derived name (clades + species), so junk that slips
// past the filters can be caught by eye and pushed into the override maps.
const NAME_REVIEW = join(dirname(fileURLToPath(import.meta.url)), "name-review.tsv");

// ---- flags (all reversible) --------------------------------------------------
// The build writes a .bak of the previous snapshot first, so a bad run is always
// recoverable (that, plus git). New phases default ON but can be turned off to
// reproduce the older, shallower snapshot:
//   --no-densify      skip family densification (base proportional set only)
//   --no-clade-names  skip GBIF clade-name derivation (rely on cladeNames.ts)
const FLAGS = new Set(process.argv.slice(2));
const DO_DENSIFY = !FLAGS.has("--no-densify");
const DO_CLADE_NAMES = !FLAGS.has("--no-clade-names");
// Cap of members per family. Densification tops each family up to this by pulling
// the group's most-observed species (see densifyByGroup); a family already at the
// cap is left alone. Recognizability comes from rank-within-group, not this number.
const DENSIFY_TARGET = 6;
const DENSIFY_CAP = 2500; // hard blow-up guard on total added species
// Only look up a vernacular for clades at least this "big" (species under them) —
// tiny clades aren't worth a group label and it keeps the API load sane.
const CLADE_NAME_MIN_LEAVES = 3;

// Umbrella words that are true for a whole kingdom/domain but useless (or wrong)
// as a specific clade's label — GBIF sometimes returns "Animals" for a small bird
// family. A derived clade name matching one of these is dropped → Latin fallback.
// (The legit broad labels like Metazoa→"Animals" come from CLADE_COMMON, not here.)
const GENERIC_CLADE_NAMES = new Set([
  "life", "organism", "organisms", "animal", "animals", "plant", "plants",
  "fungus", "fungi", "mould", "moulds", "mold", "molds", "microbe", "microbes",
  "bacteria", "creature", "creatures", "insect", "insects",
  "species", "wildlife", "vertebrate", "vertebrates", "invertebrate", "invertebrates",
]);

// High-precision markers of a NON-English vernacular that GBIF mislabelled as
// "eng" (ASCII slips past the non-Latin filter). Kept short and unambiguous —
// Spanish/Portuguese/Malay function & colour words that never appear in an
// English organism name. A clade name containing one as a whole word is dropped.
const FOREIGN_MARKERS = new Set([
  "de", "la", "el", "del", "los", "las", "da", "do", "dos", "das",
  "roja", "rojo", "negra", "negro", "verde", "comun", "gato", "perro",
  "cavalo", "ular", "kura", "ikan", "burung", "pokok", "ardilla", "berleher",
]);

// Per-GROUP quota keeps birds/insects (billions of records) from crowding out
// mammals, reptiles, fish. Occurrence volume then only decides WHICH species fill
// each share. Bumped up for a meatier game.
// Quotas are AMBITIONS, not guarantees — each group fills only as far as it has
// occurrence-ranked species with a clean English common name (the real ceiling).
// `quota` = base proportional pull (occurrence-ranked, per-order capped) — the
// balanced skeleton, unchanged. `deep` = the DENSIFICATION budget: how far down
// this group's occurrence ranking to reach when topping families up to 6 (see
// densifyByGroup). Only the most-observed species in the group are ever pulled,
// so depth arrives in the recognizable families and never reaches the obscure
// tail. Groups with a long obscure tail (insects, arachnids, molluscs, most
// plants, fungi) get NO `deep` — their extra depth would be unrecognizable.
const ANCHORS = [
  { name: "Mammalia", quota: 260, deep: 520 },
  { name: "Aves", quota: 300, deep: 580 },
  { name: "Squamata", quota: 130, deep: 240 },
  { name: "Testudines", quota: 46, deep: 80 },
  { name: "Crocodylia", quota: 15, deep: 28 },
  { name: "Amphibia", quota: 85, key: 131, deep: 180 }, // quota unchanged — base fill hit the name ceiling (28/85); only deepen
  // Fish orders are single-order anchors → skip the per-order cap (flat).
  { name: "Perciformes", quota: 95, flat: true, deep: 200 },
  { name: "Cypriniformes", quota: 45, flat: true, deep: 80 },
  { name: "Salmoniformes", quota: 30, flat: true, deep: 55 },
  { name: "Gadiformes", quota: 18, flat: true, deep: 32 },
  { name: "Siluriformes", quota: 28, flat: true, deep: 48 },
  { name: "Pleuronectiformes", quota: 18, flat: true, deep: 32 },
  { name: "Characiformes", quota: 22, flat: true, deep: 38 },
  { name: "Anguilliformes", quota: 16, flat: true, deep: 28 },
  { name: "Elasmobranchii", quota: 64, key: 121, deep: 120 }, // sharks & rays
  { name: "Insecta", quota: 270 },
  { name: "Arachnida", quota: 55 }, // ceiling-limited (42/55) — unchanged
  { name: "Cephalopoda", quota: 34, deep: 58 },
  { name: "Malacostraca", quota: 48 }, // ceiling-limited (29/48) — unchanged
  { name: "Anthozoa", quota: 32 },
  { name: "Gastropoda", quota: 55 }, // snails & slugs
  { name: "Bivalvia", quota: 28 }, // clams, mussels
  { name: "Magnoliopsida", quota: 280 }, // dicots
  { name: "Liliopsida", quota: 105 }, // monocots — ceiling-limited (85/105) — unchanged
  { name: "Pinopsida", quota: 42, flat: true, deep: 60 }, // conifers (≈ one order)
  { name: "Polypodiopsida", quota: 30 }, // ferns
  { name: "Agaricomycetes", quota: 105 }, // mushrooms
];
// Per-anchor cap so no single order dominates a group; scales with the quota.
const orderCap = (quota) => Math.max(5, Math.ceil(quota / 7));

// Curated must-include species: added regardless of occurrence volume, with
// hand-set common names, so the game isn't missing organisms everyone knows.
// Ranking by GBIF occurrence records favours well-surveyed birds/insects over
// culturally famous animals, so this list is the popularity counterweight —
// the ~150 species people recognise "from culture". Deduped against the
// occurrence set; Open Tree supplies their real placement (a few obscure or
// domestic-subspecies names may not resolve and are pruned — harmless).
const EXTRAS = [
  // Humans + classic lab model organisms
  { name: "Homo sapiens", common: "Human" },
  { name: "Mus musculus", common: "House mouse" },
  { name: "Rattus norvegicus", common: "Brown rat" },
  { name: "Danio rerio", common: "Zebrafish" },
  { name: "Gallus gallus", common: "Chicken" },
  { name: "Xenopus laevis", common: "African clawed frog" },
  { name: "Drosophila melanogaster", common: "Fruit fly" },
  { name: "Caenorhabditis elegans", common: "Roundworm" },
  { name: "Apis mellifera", common: "Western honey bee" },
  { name: "Saccharomyces cerevisiae", common: "Brewer's yeast" },
  { name: "Arabidopsis thaliana", common: "Thale cress" },
  { name: "Nematostella vectensis", common: "Starlet sea anemone" },
  { name: "Physcomitrium patens", common: "Spreading earthmoss" },
  { name: "Dictyostelium discoideum", common: "Slime mould" },
  { name: "Escherichia coli", common: "E. coli" },
  // Charismatic / phylogenetically fun tips
  { name: "Ambystoma mexicanum", common: "Axolotl" },
  { name: "Ornithorhynchus anatinus", common: "Platypus" },
  { name: "Sphenodon punctatus", common: "Tuatara" },
  { name: "Latimeria chalumnae", common: "Coelacanth" },
  { name: "Enteroctopus dofleini", common: "Giant Pacific octopus" },
  { name: "Architeuthis dux", common: "Giant squid" },
  { name: "Chelonia mydas", common: "Green sea turtle" },
  { name: "Danaus plexippus", common: "Monarch butterfly" },
  { name: "Phascolarctos cinereus", common: "Koala" },
  { name: "Milnesium tardigradum", common: "Water bear" },

  // ---- Culturally famous species (the "everyone knows these" set) ----
  // Big cats & other cats
  { name: "Panthera leo", common: "Lion" },
  { name: "Panthera tigris", common: "Tiger" },
  { name: "Panthera pardus", common: "Leopard" },
  { name: "Panthera onca", common: "Jaguar" },
  { name: "Panthera uncia", common: "Snow leopard" },
  { name: "Acinonyx jubatus", common: "Cheetah" },
  { name: "Puma concolor", common: "Cougar" },
  { name: "Felis catus", common: "Domestic cat" },
  { name: "Lynx lynx", common: "Eurasian lynx" },
  // Canids
  // (Domestic dog is Canis lupus familiaris — the same Open Tree tip as the wolf,
  //  so it can't be a distinct leaf here; "Gray wolf" stands in for the lineage.)
  { name: "Canis lupus", common: "Gray wolf" },
  { name: "Canis latrans", common: "Coyote" },
  { name: "Vulpes vulpes", common: "Red fox" },
  { name: "Vulpes lagopus", common: "Arctic fox" },
  { name: "Vulpes zerda", common: "Fennec fox" },
  { name: "Lycaon pictus", common: "African wild dog" },
  // Bears & other carnivores
  { name: "Ursus arctos", common: "Brown bear" },
  { name: "Ursus maritimus", common: "Polar bear" },
  { name: "Ursus americanus", common: "American black bear" },
  { name: "Ailuropoda melanoleuca", common: "Giant panda" },
  { name: "Ailurus fulgens", common: "Red panda" },
  { name: "Procyon lotor", common: "Raccoon" },
  { name: "Suricata suricatta", common: "Meerkat" },
  { name: "Meles meles", common: "European badger" },
  { name: "Lutra lutra", common: "European otter" },
  { name: "Enhydra lutris", common: "Sea otter" },
  { name: "Mephitis mephitis", common: "Striped skunk" },
  { name: "Crocuta crocuta", common: "Spotted hyena" },
  // Primates
  { name: "Pan troglodytes", common: "Chimpanzee" },
  { name: "Pan paniscus", common: "Bonobo" },
  { name: "Gorilla gorilla", common: "Western gorilla" },
  { name: "Pongo pygmaeus", common: "Bornean orangutan" },
  { name: "Hylobates lar", common: "Lar gibbon" },
  { name: "Papio anubis", common: "Olive baboon" },
  { name: "Mandrillus sphinx", common: "Mandrill" },
  { name: "Macaca mulatta", common: "Rhesus macaque" },
  { name: "Lemur catta", common: "Ring-tailed lemur" },
  // Large herbivores & hoofed mammals
  { name: "Loxodonta africana", common: "African bush elephant" },
  { name: "Elephas maximus", common: "Asian elephant" },
  { name: "Ceratotherium simum", common: "White rhinoceros" },
  { name: "Diceros bicornis", common: "Black rhinoceros" },
  { name: "Hippopotamus amphibius", common: "Hippopotamus" },
  { name: "Giraffa camelopardalis", common: "Giraffe" },
  { name: "Equus quagga", common: "Plains zebra" },
  { name: "Equus caballus", common: "Horse" },
  { name: "Equus asinus", common: "Donkey" },
  { name: "Bos taurus", common: "Cattle" },
  { name: "Bison bison", common: "American bison" },
  { name: "Bubalus bubalis", common: "Water buffalo" },
  { name: "Sus scrofa", common: "Wild boar" },
  { name: "Ovis aries", common: "Sheep" },
  { name: "Capra hircus", common: "Goat" },
  { name: "Alces alces", common: "Moose" },
  { name: "Rangifer tarandus", common: "Reindeer" },
  { name: "Cervus elaphus", common: "Red deer" },
  { name: "Odocoileus virginianus", common: "White-tailed deer" },
  { name: "Camelus dromedarius", common: "Dromedary" },
  { name: "Camelus bactrianus", common: "Bactrian camel" },
  { name: "Lama glama", common: "Llama" },
  { name: "Vicugna pacos", common: "Alpaca" },
  { name: "Connochaetes taurinus", common: "Blue wildebeest" },
  { name: "Aepyceros melampus", common: "Impala" },
  { name: "Phacochoerus africanus", common: "Warthog" },
  { name: "Oryctolagus cuniculus", common: "European rabbit" },
  // Other mammals
  { name: "Osphranter rufus", common: "Red kangaroo" },
  { name: "Vombatus ursinus", common: "Common wombat" },
  { name: "Sarcophilus harrisii", common: "Tasmanian devil" },
  { name: "Bradypus variegatus", common: "Brown-throated sloth" },
  { name: "Dasypus novemcinctus", common: "Nine-banded armadillo" },
  { name: "Myrmecophaga tridactyla", common: "Giant anteater" },
  { name: "Erinaceus europaeus", common: "European hedgehog" },
  { name: "Castor canadensis", common: "American beaver" },
  { name: "Orycteropus afer", common: "Aardvark" },
  // Marine mammals
  { name: "Tursiops truncatus", common: "Bottlenose dolphin" },
  { name: "Orcinus orca", common: "Orca" },
  { name: "Balaenoptera musculus", common: "Blue whale" },
  { name: "Megaptera novaeangliae", common: "Humpback whale" },
  { name: "Physeter macrocephalus", common: "Sperm whale" },
  { name: "Monodon monoceros", common: "Narwhal" },
  { name: "Delphinapterus leucas", common: "Beluga" },
  { name: "Odobenus rosmarus", common: "Walrus" },
  { name: "Phoca vitulina", common: "Harbor seal" },
  { name: "Trichechus manatus", common: "West Indian manatee" },
  { name: "Zalophus californianus", common: "California sea lion" },
  // Birds
  { name: "Haliaeetus leucocephalus", common: "Bald eagle" },
  { name: "Aquila chrysaetos", common: "Golden eagle" },
  { name: "Falco peregrinus", common: "Peregrine falcon" },
  { name: "Tyto alba", common: "Barn owl" },
  { name: "Bubo bubo", common: "Eurasian eagle-owl" },
  { name: "Aptenodytes forsteri", common: "Emperor penguin" },
  { name: "Spheniscus demersus", common: "African penguin" },
  { name: "Struthio camelus", common: "Common ostrich" },
  { name: "Dromaius novaehollandiae", common: "Emu" },
  { name: "Phoenicopterus roseus", common: "Greater flamingo" },
  { name: "Pavo cristatus", common: "Indian peafowl" },
  { name: "Cygnus olor", common: "Mute swan" },
  { name: "Anas platyrhynchos", common: "Mallard" },
  { name: "Ramphastos toco", common: "Toco toucan" },
  { name: "Ara macao", common: "Scarlet macaw" },
  { name: "Melopsittacus undulatus", common: "Budgerigar" },
  { name: "Corvus corax", common: "Common raven" },
  { name: "Columba livia", common: "Rock dove" },
  { name: "Erithacus rubecula", common: "European robin" },
  { name: "Alcedo atthis", common: "Common kingfisher" },
  { name: "Pelecanus onocrotalus", common: "Great white pelican" },
  { name: "Ciconia ciconia", common: "White stork" },
  { name: "Meleagris gallopavo", common: "Wild turkey" },
  { name: "Archilochus colubris", common: "Ruby-throated hummingbird" },
  // Reptiles & amphibians
  { name: "Crocodylus niloticus", common: "Nile crocodile" },
  { name: "Alligator mississippiensis", common: "American alligator" },
  { name: "Ophiophagus hannah", common: "King cobra" },
  { name: "Naja naja", common: "Indian cobra" },
  { name: "Python regius", common: "Ball python" },
  { name: "Boa constrictor", common: "Boa constrictor" },
  { name: "Crotalus atrox", common: "Western diamondback rattlesnake" },
  { name: "Eunectes murinus", common: "Green anaconda" },
  { name: "Varanus komodoensis", common: "Komodo dragon" },
  { name: "Iguana iguana", common: "Green iguana" },
  { name: "Chamaeleo chamaeleon", common: "Common chameleon" },
  { name: "Chelonoidis niger", common: "Galápagos tortoise" },
  { name: "Bufo bufo", common: "Common toad" },
  { name: "Dendrobates tinctorius", common: "Dyeing poison dart frog" },
  // Fish
  { name: "Carcharodon carcharias", common: "Great white shark" },
  { name: "Rhincodon typus", common: "Whale shark" },
  { name: "Sphyrna mokarran", common: "Great hammerhead" },
  { name: "Amphiprion ocellaris", common: "Clownfish" },
  { name: "Carassius auratus", common: "Goldfish" },
  { name: "Salmo salar", common: "Atlantic salmon" },
  { name: "Thunnus thynnus", common: "Atlantic bluefin tuna" },
  { name: "Xiphias gladius", common: "Swordfish" },
  { name: "Pygocentrus nattereri", common: "Red-bellied piranha" },
  { name: "Mobula birostris", common: "Giant manta ray" },
  { name: "Electrophorus electricus", common: "Electric eel" },
  { name: "Betta splendens", common: "Siamese fighting fish" },
  { name: "Sphyraena barracuda", common: "Great barracuda" },
  { name: "Gadus morhua", common: "Atlantic cod" },
  // Invertebrates
  { name: "Latrodectus mactans", common: "Southern black widow" },
  { name: "Mantis religiosa", common: "European mantis" },
  { name: "Coccinella septempunctata", common: "Seven-spot ladybird" },
  { name: "Homarus americanus", common: "American lobster" },
  { name: "Callinectes sapidus", common: "Blue crab" },
  { name: "Octopus vulgaris", common: "Common octopus" },
  { name: "Cornu aspersum", common: "Garden snail" },
  { name: "Periplaneta americana", common: "American cockroach" },
  { name: "Papilio machaon", common: "Old World swallowtail" },
  { name: "Photinus pyralis", common: "Common eastern firefly" },
  // Plants
  { name: "Helianthus annuus", common: "Sunflower" },
  { name: "Rosa canina", common: "Dog rose" },
  { name: "Quercus robur", common: "English oak" },
  { name: "Acer saccharum", common: "Sugar maple" },
  { name: "Sequoiadendron giganteum", common: "Giant sequoia" },
  { name: "Dionaea muscipula", common: "Venus flytrap" },
  { name: "Cannabis sativa", common: "Cannabis" },
  { name: "Solanum lycopersicum", common: "Tomato" },
  { name: "Solanum tuberosum", common: "Potato" },
  { name: "Oryza sativa", common: "Rice" },
  { name: "Triticum aestivum", common: "Bread wheat" },
  { name: "Zea mays", common: "Maize" },
  { name: "Coffea arabica", common: "Arabica coffee" },
  { name: "Vitis vinifera", common: "Grapevine" },
  { name: "Malus domestica", common: "Apple" },
  { name: "Taraxacum officinale", common: "Dandelion" },
  { name: "Cocos nucifera", common: "Coconut palm" },
  { name: "Musa acuminata", common: "Banana" },
  { name: "Carnegiea gigantea", common: "Saguaro" },
  // Fungi
  { name: "Amanita muscaria", common: "Fly agaric" },
  { name: "Agaricus bisporus", common: "Button mushroom" },
  { name: "Amanita phalloides", common: "Death cap" },
  { name: "Lentinula edodes", common: "Shiitake" },
  { name: "Tuber melanosporum", common: "Black truffle" },

  // ---- Within-clade depth for harder Kinship boards ----
  // Famous species that rank too low in occurrence for densification to reach, but
  // fill out recognisable sub-clades so a "within X" board has four groups of four.
  // (Dolphins/Panthera/dabbling-duck bases already exist above or in the anchors.)

  // Whales (Cetacea): rorquals · right whales · beaked whales · porpoises
  { name: "Balaenoptera physalus", common: "Fin whale" },
  { name: "Balaenoptera acutorostrata", common: "Minke whale" },
  { name: "Balaenoptera borealis", common: "Sei whale" },
  { name: "Eubalaena glacialis", common: "North Atlantic right whale" },
  { name: "Eubalaena australis", common: "Southern right whale" },
  { name: "Eubalaena japonica", common: "North Pacific right whale" },
  { name: "Balaena mysticetus", common: "Bowhead whale" },
  { name: "Ziphius cavirostris", common: "Cuvier's beaked whale" },
  { name: "Hyperoodon ampullatus", common: "Northern bottlenose whale" },
  { name: "Berardius bairdii", common: "Baird's beaked whale" },
  { name: "Mesoplodon densirostris", common: "Blainville's beaked whale" },
  { name: "Phocoena phocoena", common: "Harbour porpoise" },
  { name: "Phocoenoides dalli", common: "Dall's porpoise" },
  { name: "Neophocaena asiaeorientalis", common: "Finless porpoise" },
  { name: "Phocoena sinus", common: "Vaquita" }, // Phocoenidae 3→4 → 4th whale group

  // Cats (Felidae): small cats · lynxes · ocelots (+ big cats already present)
  { name: "Felis silvestris", common: "Wildcat" },
  { name: "Felis chaus", common: "Jungle cat" },
  { name: "Felis nigripes", common: "Black-footed cat" },
  { name: "Felis margarita", common: "Sand cat" },
  { name: "Lynx rufus", common: "Bobcat" },
  { name: "Lynx canadensis", common: "Canada lynx" },
  { name: "Lynx pardinus", common: "Iberian lynx" },
  { name: "Leopardus pardalis", common: "Ocelot" },
  { name: "Leopardus wiedii", common: "Margay" },
  { name: "Leopardus geoffroyi", common: "Geoffroy's cat" },
  { name: "Leopardus tigrinus", common: "Oncilla" },
  { name: "Prionailurus bengalensis", common: "Leopard cat" },
  { name: "Prionailurus viverrinus", common: "Fishing cat" },
  { name: "Caracal caracal", common: "Caracal" },
  { name: "Leptailurus serval", common: "Serval" },
  { name: "Neofelis nebulosa", common: "Clouded leopard" },
  { name: "Otocolobus manul", common: "Pallas's cat" }, // +4 cats push Felidae >25 leaves
  { name: "Herpailurus yagouaroundi", common: "Jaguarundi" }, // so grid descends to
  { name: "Catopuma temminckii", common: "Asian golden cat" }, // Panthera|Felis|Lynx|Leopardus
  { name: "Prionailurus rubiginosus", common: "Rusty-spotted cat" },

  // Ducks (Anatidae): dabbling ducks · diving ducks · sea ducks (+ geese/swans base)
  { name: "Anas crecca", common: "Eurasian teal" },
  { name: "Anas acuta", common: "Northern pintail" },
  { name: "Spatula clypeata", common: "Northern shoveler" },
  { name: "Spatula discors", common: "Blue-winged teal" },
  { name: "Mareca strepera", common: "Gadwall" },
  { name: "Aythya ferina", common: "Common pochard" },
  { name: "Aythya fuligula", common: "Tufted duck" },
  { name: "Aythya marila", common: "Greater scaup" },
  { name: "Aythya americana", common: "Redhead" },
  { name: "Aythya valisineria", common: "Canvasback" },
  { name: "Mergus merganser", common: "Common merganser" },
  { name: "Mergus serrator", common: "Red-breasted merganser" },
  { name: "Bucephala clangula", common: "Common goldeneye" },
  { name: "Bucephala albeola", common: "Bufflehead" },
  { name: "Somateria mollissima", common: "Common eider" },
  { name: "Melanitta nigra", common: "Common scoter" },

  // Dogs (Canidae): true foxes · wolves & jackals · South American canids
  { name: "Vulpes velox", common: "Swift fox" },
  { name: "Vulpes macrotis", common: "Kit fox" },
  { name: "Vulpes corsac", common: "Corsac fox" },
  { name: "Canis aureus", common: "Golden jackal" },
  { name: "Canis mesomelas", common: "Black-backed jackal" },
  { name: "Canis lupaster", common: "African golden wolf" },
  { name: "Canis simensis", common: "Ethiopian wolf" },
  { name: "Lycalopex culpaeus", common: "Culpeo" },
  { name: "Lycalopex gymnocercus", common: "Pampas fox" },
  { name: "Cerdocyon thous", common: "Crab-eating fox" },
  { name: "Chrysocyon brachyurus", common: "Maned wolf" },
  { name: "Speothos venaticus", common: "Bush dog" },
  { name: "Nyctereutes procyonoides", common: "Raccoon dog" },
  { name: "Otocyon megalotis", common: "Bat-eared fox" },
  { name: "Urocyon cinereoargenteus", common: "Gray fox" },
];

// Scope presets: clade NAMES to expose if OTL places them in the pulled tree.
const SCOPE_CANDIDATES = [
  { names: ["life"], label: "All life" },
  { names: ["Metazoa", "Animalia"], label: "Animals" },
  { names: ["Chordata"], label: "Chordates" },
  { names: ["Mammalia"], label: "Mammals" },
  { names: ["Aves"], label: "Birds" },
  { names: ["Actinopterygii", "Actinipterygii"], label: "Fish" },
  { names: ["Insecta"], label: "Insects" },
  { names: ["Arthropoda"], label: "Arthropods" },
  { names: ["Chloroplastida", "Viridiplantae"], label: "Plants" },
  { names: ["Fungi"], label: "Fungi" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(url, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, opts);
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      if (res.ok) return json;
      if (res.status === 429 || res.status >= 500) { await sleep(500 * (i + 1)); continue; }
      return { __error: true, status: res.status, body: json ?? text };
    } catch {
      await sleep(500 * (i + 1));
    }
  }
  return { __error: true, status: 0 };
}
const getJSON = (url) => req(url, { headers: { accept: "application/json" } });
const postJSON = (url, body) =>
  req(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (idx < items.length) { const i = idx++; out[i] = await fn(items[i], i); }
    })
  );
  return out;
}

// ---------- GBIF: choose a balanced, recognizable species set ----------

async function resolveGbifKey(a) {
  if (a.key) return a.key;
  const doc = await getJSON(`${GBIF}/species/match?name=${encodeURIComponent(a.name)}`);
  return doc && !doc.__error && doc.matchType !== "NONE" ? doc.usageKey ?? null : null;
}

// Resolve one curated extra to a spec (speciesKey + canonical name + our common).
async function resolveExtra(e) {
  const doc = await getJSON(`${GBIF}/species/match?name=${encodeURIComponent(e.name)}`);
  if (!doc || doc.__error || doc.matchType === "NONE") return null;
  const speciesKey = doc.speciesKey ?? doc.usageKey;
  if (!speciesKey) return null;
  return {
    speciesKey,
    canonicalName: doc.canonicalName ?? e.name,
    common: e.common,
    orderKey: doc.orderKey ?? null,
    familyKey: doc.familyKey ?? null,
  };
}

function cleanCommon(name) {
  if (!name) return null;
  const n = name.trim();
  if (n.length < 2 || n.length > 30) return null;
  if (/[0-9(){}\[\]\/]/.test(n)) return null;
  if (/[^\x00-\x7F]/.test(n)) return null;
  if (n === n.toUpperCase() && n.length <= 5) return null;
  if (n.split(/\s+/).length > 4) return null;
  // De-shout an all-caps vernacular ("EARED SEALS" → "Eared seals") so it reads
  // like the curated sentence-case labels instead of yelling.
  const norm = n === n.toUpperCase() ? n.toLowerCase() : n;
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}

// A stricter cleaner for CLADE labels (group names, shown to every player). Starts
// from cleanCommon, then drops names that are useless or wrong as a group label:
// generic umbrellas ("Animals"), leaked non-English (foreign marker word or a
// hyphenated reduplication like "Kura-kura"). A dropped clade just keeps its Latin
// name — fine, a clade doesn't need a common name.
function cleanCladeName(name) {
  // GBIF tags higher taxa "Pinks, Cactuses, and Allies" / "Spiderworts and Allies";
  // trim the vague tail so the label is just the recognisable part.
  let cc = cleanCommon((name ?? "").replace(/,?\s+and allies$/i, "").trim());
  if (!cc) return null;
  // GBIF placeholder / rank junk — never a real label ("Indet. Diver", "Nyctalus
  // Bat species", "Amanita Sect. Lepidella"). Drop → Latin fallback.
  if (/\bindet\b/i.test(cc) || /\bspecies$/i.test(cc) || /\bsect\.?\b/i.test(cc)) return null;
  const words = cc.toLowerCase().split(/[\s-]+/).filter(Boolean);
  // Drop only when the WHOLE label is generic ("Insects", "Animals") — a qualifier
  // makes it specific enough to keep ("Carp-like Fish", "Land Plants").
  if (words.every((w) => GENERIC_CLADE_NAMES.has(w))) return null;
  if (words.some((w) => FOREIGN_MARKERS.has(w))) return null;
  // reduplication (word-word, same halves) — a Malay/Indonesian tell, never English
  if (/\b([a-z]{3,})-\1\b/i.test(cc)) return null;
  // GBIF Title-Cases everything; lowercase the connector words so multiword labels
  // read like the curated sentence-case style ("Swallows And Martins" → "…and…").
  cc = cc.replace(/\b(And|Or|Of|The|In)\b/g, (m) => m.toLowerCase());
  return cc;
}

async function englishCommonName(key, sciName, clean = cleanCommon) {
  const doc = await getJSON(`${GBIF}/species/${key}/vernacularNames?limit=80`);
  if (!doc || doc.__error) return null;
  const eng = (doc.results ?? []).filter((v) => v.language === "eng" && v.vernacularName);
  const preferred = eng.filter((v) => v.preferred).map((v) => v.vernacularName);
  const sciTokens = new Set((sciName ?? "").toLowerCase().split(/\s+/));
  for (const c of [...preferred, ...eng.map((v) => v.vernacularName)]) {
    const cc = clean(c);
    if (cc && !sciTokens.has(cc.toLowerCase())) return cc;
  }
  return null;
}

// Scan occurrence-ranked species deepest-first, keeping only those with a clean
// English common name, until the quota fills or the pool (or common names) run
// out. Lazy/batched so we stop early instead of fetching the whole deep pool.
async function speciesForAnchor(a, key) {
  const facetLimit = Math.min(a.quota * 8, 1500);
  const doc = await getJSON(`${GBIF}/occurrence/search?taxonKey=${key}&facet=speciesKey&facetLimit=${facetLimit}&limit=0`);
  const ranked = (doc?.facets?.[0]?.counts ?? []).map((c) => c.name);
  const cap = a.flat ? Infinity : orderCap(a.quota);
  const perOrder = new Map();
  const chosen = [];
  for (let i = 0; i < ranked.length && chosen.length < a.quota; i += 24) {
    const batch = ranked.slice(i, i + 24);
    const recs = (await mapLimit(batch, 8, (sk) => getJSON(`${GBIF}/species/${sk}`)))
      .filter((s) => s && !s.__error && s.rank === "SPECIES" && s.speciesKey && s.canonicalName);
    await mapLimit(recs, 8, async (s) => { s.common = await englishCommonName(s.speciesKey, s.canonicalName); });
    for (const s of recs) {
      if (chosen.length >= a.quota) break;
      if (!s.common) continue; // drop Latin-only — recognizability filter
      if (s.orderKey != null) {
        const n = perOrder.get(s.orderKey) ?? 0;
        if (n >= cap) continue;
        perOrder.set(s.orderKey, n + 1);
      }
      chosen.push(s);
    }
  }
  return chosen;
}

// ---------- densification: deepen recognizable families ----------
// Kinship groups are clades of ≥4; the base sample is broad but shallow (few
// clades reach 4), so hard "within-clade" boards can't form. This deepens families
// up to DENSIFY_TARGET (6) so e.g. the bird/carnivore/perch families fill and their
// parent clades become within-clade boards.
//
// The recognizability gate is RANK WITHIN THE GROUP, not an absolute count: for
// each anchor group we walk its GBIF occurrence ranking (most-observed first) only
// as deep as the group's `deep` budget, and cap each family at the target. So depth
// arrives in the families famous species cluster into, and the obscure long tail
// (mites, loaches, scorpionflies — far down their group's ranking) is never
// reached. Groups without a `deep` budget aren't densified at all. Judged per group
// so fish/insects/plants are each measured on their own scale, never a shared floor.
async function densifyByGroup(anchors, specs, target) {
  // Current family occupancy across everything chosen so far (base + extras).
  const famCount = new Map(); // familyKey -> count
  const seen = new Set();
  for (const s of specs) {
    seen.add(String(s.speciesKey));
    if (s.familyKey != null) famCount.set(s.familyKey, (famCount.get(s.familyKey) ?? 0) + 1);
  }
  const added = [];
  let capped = false;
  for (const a of anchors) {
    if (!a.deep || a.deep <= a.quota) continue; // only groups with a depth budget
    if (added.length >= DENSIFY_CAP) { capped = true; break; }
    // The group's occurrence ranking; take the top `deep` positions.
    const doc = await getJSON(`${GBIF}/occurrence/search?taxonKey=${a.key}&facet=speciesKey&facetLimit=${Math.min(a.deep, 1500)}&limit=0`);
    const ranked = (doc?.facets?.[0]?.counts ?? []).map((c) => String(c.name)).slice(0, a.deep);
    const fresh = ranked.filter((sk) => !seen.has(sk)); // base already took the very top
    let addedHere = 0;
    for (let j = 0; j < fresh.length; j += 24) {
      if (added.length >= DENSIFY_CAP) { capped = true; break; }
      const recs = (await mapLimit(fresh.slice(j, j + 24), 8, (sk) => getJSON(`${GBIF}/species/${sk}`)))
        .filter((s) => s && !s.__error && s.rank === "SPECIES" && s.speciesKey && s.canonicalName);
      await mapLimit(recs, 8, async (s) => { s.common = await englishCommonName(s.speciesKey, s.canonicalName); });
      for (const s of recs) {
        const key = String(s.speciesKey);
        if (seen.has(key) || !s.common) continue;          // dedupe + recognizability
        if (s.familyKey == null) continue;                 // need a family to cap against
        if ((famCount.get(s.familyKey) ?? 0) >= target) continue; // family already full
        seen.add(key); famCount.set(s.familyKey, (famCount.get(s.familyKey) ?? 0) + 1);
        added.push(s); addedHere++;
      }
    }
    console.log(`   ${a.name}: +${addedHere} (deep ${a.quota}→${a.deep})`);
  }
  return { added, capped };
}

// ---------- Open Tree of Life: topology ----------

async function tnrsMatch(names) {
  const out = new Map(); // canonicalName -> ott_id
  for (let i = 0; i < names.length; i += 200) {
    const chunk = names.slice(i, i + 200);
    const doc = await postJSON(`${OTL}/tnrs/match_names`, { names: chunk, do_approximate_matching: false });
    if (!doc || doc.__error) continue;
    for (const r of doc.results ?? []) {
      const t = r.matches?.[0]?.taxon;
      if (t?.ott_id) out.set(r.name, t.ott_id);
    }
  }
  return out;
}

async function inducedSubtree(ottIds) {
  let ids = [...ottIds];
  for (let attempt = 0; attempt < 6; attempt++) {
    const doc = await postJSON(`${OTL}/tree_of_life/induced_subtree`, { ott_ids: ids, label_format: "name_and_id" });
    if (doc && !doc.__error && doc.newick) return { newick: doc.newick, ids };
    // Prune any ott ids the synthetic tree rejected, then retry.
    const body = doc?.body ?? doc;
    const bad = new Set();
    for (const field of ["unknown_ids", "node_ids_not_in_tree", "broken", "unknown"]) {
      const v = body?.[field];
      if (Array.isArray(v)) v.forEach((x) => bad.add(Number(String(x).replace(/\D/g, ""))));
      else if (v && typeof v === "object") Object.keys(v).forEach((x) => bad.add(Number(String(x).replace(/\D/g, ""))));
    }
    if (typeof body?.message === "string") {
      for (const m of body.message.matchAll(/ott(\d+)/g)) bad.add(Number(m[1]));
    }
    const before = ids.length;
    ids = ids.filter((id) => !bad.has(id));
    if (ids.length === before || ids.length === 0) return null;
    console.log(`   induced_subtree: pruned ${before - ids.length} taxa OTL couldn't place, retrying…`);
  }
  return null;
}

// Newick parser that tolerates single-quoted labels.
function parseNewick(s) {
  s = s.trim().replace(/;\s*$/, "");
  let i = 0;
  const readLabel = () => {
    let out = "";
    if (s[i] === "'") {
      i++;
      while (i < s.length) {
        if (s[i] === "'") { if (s[i + 1] === "'") { out += "'"; i += 2; continue; } i++; break; }
        out += s[i++];
      }
    } else {
      while (i < s.length && !"(),".includes(s[i])) out += s[i++];
    }
    return out.trim();
  };
  const node = () => {
    const n = { children: [] };
    if (s[i] === "(") {
      i++;
      do { n.children.push(node()); } while (s[i] === "," && ++i);
      i++; // consume ')'
    }
    n.label = readLabel();
    return n;
  };
  return node();
}

// Split "Panthera_leo_ott563151" / "Amniota_ott5246131" / "mrcaott786ott83926".
function parseLabel(raw) {
  const t = (raw ?? "").trim();
  const m = t.match(/^(.*?)[ _]?ott(\d+)$/);
  if (m) {
    let name = m[1].replace(/_/g, " ").replace(/\(.*?\)/g, "").trim();
    if (!name || /^mrca/i.test(name)) return { name: null, id: `ott${m[2]}` };
    return { name, id: `ott${m[2]}` };
  }
  if (/^mrca/i.test(t)) return { name: null, id: t };
  const name = t.replace(/_/g, " ").trim();
  return { name: name || null, id: null };
}

async function main() {
  // Safety net: keep the previous snapshot so any run is recoverable (cp OUT.bak
  // back over OUT, or `git checkout`). Written before we touch anything.
  if (existsSync(OUT)) {
    copyFileSync(OUT, OUT + ".bak");
    console.log(`↩ backed up current snapshot → ${OUT}.bak`);
  }
  console.log(`  phases: densify=${DO_DENSIFY ? `on (≥${DENSIFY_TARGET}/family)` : "off"}, clade-names=${DO_CLADE_NAMES ? "on" : "off"}`);

  console.log("→ [GBIF] resolving anchor groups…");
  const anchors = [];
  for (const a of ANCHORS) {
    const key = await resolveGbifKey(a);
    if (key) anchors.push({ ...a, key });
    else console.warn(`   ! could not resolve ${a.name} — skipping`);
  }

  console.log("→ [GBIF] filling per-group quotas by occurrence volume…");
  const nested = await mapLimit(anchors, 4, async (a) => {
    const chosen = await speciesForAnchor(a, a.key);
    console.log(`   ${a.name}: ${chosen.length}/${a.quota}`);
    return chosen;
  });
  const seen = new Set();
  const specs = nested.flat().filter((s) => (seen.has(s.speciesKey) ? false : seen.add(s.speciesKey)));
  console.log(`   ${specs.length} species selected (all with common names)`);

  console.log("→ [GBIF] adding curated extras…");
  const extras = (await mapLimit(EXTRAS, 6, resolveExtra)).filter(Boolean);
  // A curated species may already be in the occurrence set — often under an odd
  // GBIF vernacular ("Alley Cat", "Blackfish", "Aurochs"). The hand-set common
  // name is intentional, so it WINS: override the existing entry rather than skip
  // it, else add it. (Two curated names can map to one species key — e.g. a
  // domestic subspecies onto its wild species — so last-writer-wins by list order.)
  const specByKey = new Map(specs.map((s) => [String(s.speciesKey), s]));
  let added = 0;
  let renamed = 0;
  for (const s of extras) {
    const key = String(s.speciesKey);
    const existing = specByKey.get(key);
    if (existing) { existing.common = s.common; renamed++; }
    else { seen.add(s.speciesKey); specs.push(s); specByKey.set(key, s); added++; }
  }
  console.log(`   +${added} new, ${renamed} renamed to their curated common name`);

  const baseCount = specs.length;
  const stats = { base: baseCount, densified: 0, densCapped: false, cladesNamedGbif: 0 };
  if (DO_DENSIFY) {
    console.log(`→ [GBIF] densifying recognizable families to ≤${DENSIFY_TARGET}/family (top-of-group only)…`);
    const { added: dens, capped } = await densifyByGroup(anchors, specs, DENSIFY_TARGET);
    for (const s of dens) {
      const key = String(s.speciesKey);
      if (specByKey.has(key)) continue;
      seen.add(s.speciesKey); specs.push(s); specByKey.set(key, s);
    }
    stats.densified = dens.length; stats.densCapped = capped;
    console.log(`   +${dens.length} species${capped ? " (hit cap)" : ""}`);
  }

  // Curated common-name corrections, by scientific name — fixes GBIF vernacular
  // collisions/errors (two species sharing an English name, or a plain-wrong one).
  let fixed = 0;
  for (const s of specs) {
    const better = COMMON_NAME_OVERRIDES[s.canonicalName];
    if (better && s.common !== better) { s.common = better; fixed++; }
  }
  console.log(`   ${fixed} common names corrected from the override map`);

  console.log("→ [OTL] matching names → OTT ids…");
  const nameToOtt = await tnrsMatch(specs.map((s) => s.canonicalName));
  const byOtt = new Map();
  for (const s of specs) {
    const ott = nameToOtt.get(s.canonicalName);
    if (ott != null && !byOtt.has(ott)) byOtt.set(ott, s);
  }
  console.log(`   ${byOtt.size}/${specs.length} placed in the Open Tree`);

  console.log("→ [OTL] fetching induced topology…");
  const res = await inducedSubtree([...byOtt.keys()]);
  if (!res) { console.error("induced_subtree failed"); process.exit(1); }
  const root = parseNewick(res.newick);

  // ---- flatten newick → nodes ----
  // Collapse only single-child PASS-THROUGHS. Keep every named clade, and keep
  // UNNAMED branch points (≥2 live children) too — OTL labels most real clades
  // (Neoaves, Laridae, even genus Larus in an induced tree) as unnamed "mrca"
  // nodes, and dropping them flattens the tree into useless polytomies. Unnamed
  // clades are stored with an empty sciName and drawn as bare junctions.
  const nodes = new Map();
  nodes.set("life", { id: "life", sciName: "Life", common: "Life", rank: "domain", parentId: null });
  const nameToId = new Map();

  // Does this subtree contain at least one keepable (common-named) species?
  const live = new Map();
  const hasLeaf = (n) => {
    if (live.has(n)) return live.get(n);
    let res;
    if (n.children.length === 0) {
      const num = parseLabel(n.label).id ? Number(parseLabel(n.label).id.replace(/\D/g, "")) : null;
      const spec = num != null ? byOtt.get(num) : null;
      res = !!(spec && spec.common);
    } else {
      res = n.children.some(hasLeaf);
    }
    live.set(n, res);
    return res;
  };

  const emit = (n, parentId) => {
    const { name, id } = parseLabel(n.label);
    if (n.children.length === 0) {
      const ottNum = id ? Number(id.replace(/\D/g, "")) : null;
      const spec = ottNum != null ? byOtt.get(ottNum) : null;
      if (!spec || !spec.common) return; // no Latin-only leaves
      const nid = String(spec.speciesKey);
      if (!nodes.has(nid))
        nodes.set(nid, { id: nid, sciName: spec.canonicalName, common: spec.common ?? undefined, rank: "species", parentId });
      return;
    }
    const liveKids = n.children.filter(hasLeaf);
    if (name) {
      const nid = id ?? `clade-${name}`;
      if (!nodes.has(nid)) {
        nodes.set(nid, { id: nid, sciName: name, common: undefined, rank: "clade", parentId });
        nameToId.set(name, nid);
      }
      for (const c of liveKids) emit(c, nid);
    } else if (liveKids.length >= 2) {
      // unnamed branch point — preserve the split as an unlabeled junction
      const nid = id ?? n.label;
      if (!nodes.has(nid)) nodes.set(nid, { id: nid, sciName: "", common: undefined, rank: "clade", parentId });
      for (const c of liveKids) emit(c, nid);
    } else {
      for (const c of liveKids) emit(c, parentId); // single-child pass-through → collapse
    }
  };
  emit(root, "life");

  // Dropping Latin-only leaves can leave clades with no descendants — prune them
  // to a fixpoint so they don't show up as phantom guessable tips.
  for (let pruned = true; pruned; ) {
    pruned = false;
    const parents = new Set([...nodes.values()].map((n) => n.parentId).filter(Boolean));
    for (const [id, n] of nodes) {
      if (n.parentId !== null && n.rank !== "species" && !parents.has(id)) { nodes.delete(id); pruned = true; }
    }
  }

  // Ranks via ONE batched TNRS pass over the clade names (fast). Verify the
  // resolved ott id matches the clade's own id, so homonyms (a moth genus named
  // "Tetrapoda") can't mislabel a clade. Unverified/unranked → generic "clade".
  const cladeEntries = [...nameToId.entries()].filter(([, nid]) => nid.startsWith("ott") && nodes.has(nid));
  console.log(`→ [OTL] labelling ranks for ${cladeEntries.length} clades (batched)…`);
  const rankByName = new Map();
  for (let i = 0; i < cladeEntries.length; i += 200) {
    const chunk = cladeEntries.slice(i, i + 200).map(([name]) => name);
    const doc = await postJSON(`${OTL}/tnrs/match_names`, { names: chunk, do_approximate_matching: false });
    if (doc && !doc.__error) for (const r of doc.results ?? []) {
      const t = r.matches?.[0]?.taxon;
      if (t) rankByName.set(r.name, { ott: t.ott_id, rank: t.rank });
    }
  }
  for (const [name, nid] of cladeEntries) {
    const hit = rankByName.get(name);
    const ottNum = Number(nid.replace(/\D/g, ""));
    const rank = hit && hit.ott === ottNum ? hit.rank : null;
    // A node with children is a clade, never a species — ignore a "species" rank.
    nodes.get(nid).rank = rank && rank !== "species" && !/^no /.test(rank) ? rank.toLowerCase() : "clade";
  }

  // ---- genus-node injection ----
  // OTL's induced topology often leaves a genus's clade unlabeled — the branch point
  // exists, but no name rode along. Where a genus is MONOPHYLETIC here (an unnamed
  // node whose every descendant is that same genus) we attach the genus name. This
  // adds NO topology (the clade already exists) and asserts nothing OTL contradicts:
  // a genus that is paraphyletic in this tree (its MRCA sweeps in other genera) fails
  // the purity test and is left alone — deferring to OTL, never overriding it. It's
  // the same GBIF-taxonomy × OTL-topology reconciliation the build already does for
  // families, just at genus rank. Lets grid.ts theme genus-level groups (ducks,
  // foxes, whiptails…). Runs before clade-naming so injected genera get vernaculars.
  {
    const childrenOf = new Map();
    for (const n of nodes.values()) {
      if (n.parentId == null) continue;
      (childrenOf.get(n.parentId) ?? childrenOf.set(n.parentId, []).get(n.parentId)).push(n.id);
    }
    const leafCache = new Map();
    const leavesN = (id) => {
      if (leafCache.has(id)) return leafCache.get(id);
      const ch = childrenOf.get(id);
      let r;
      if (!ch || ch.length === 0) r = [id];
      else { r = []; for (const c of ch) r.push(...leavesN(c)); }
      leafCache.set(id, r); return r;
    };
    const genusOf = (n) => (n && n.rank === "species" ? n.sciName.split(/\s+/)[0] : null);
    const pathToRoot = (id) => { const p = []; for (let c = id; c; c = nodes.get(c)?.parentId) p.push(c); return p; };
    const mrca = (ids) => {
      let anc = pathToRoot(ids[0]);
      for (const id of ids.slice(1)) { const s = new Set(pathToRoot(id)); anc = anc.filter((a) => s.has(a)); if (!anc.length) break; }
      return anc[0] ?? null;
    };
    const byGenus = new Map();
    for (const n of nodes.values()) {
      const g = genusOf(n);
      if (g) (byGenus.get(g) ?? byGenus.set(g, []).get(g)).push(n.id);
    }
    let injected = 0;
    for (const [g, sp] of byGenus) {
      if (sp.length < 2) continue;
      const m = mrca(sp);
      const node = m && nodes.get(m);
      if (!node || node.rank === "species" || node.sciName) continue; // only UNNAMED internal nodes
      if (leavesN(m).some((id) => genusOf(nodes.get(id)) !== g)) continue; // purity: MRCA is all one genus
      node.sciName = g;
      node.rank = "genus";
      nameToId.set(g, m);
      injected++;
    }
    console.log(`→ [inject] named ${injected} monophyletic genus clades OTL left unlabeled`);
  }

  // ---- clade common names, DERIVED from GBIF (not a hand list) ----
  // Open Tree gives topology + scientific names but no vernaculars; GBIF has them
  // (the same source we already use for species). For every named clade big enough
  // to be a group label, look up its English vernacular via the SAME cleaner used
  // for species. Baked into the snapshot; cladeNames.ts remains only a load-time
  // correction layer (a curated entry overrides a junk GBIF name). Clades with no
  // clean vernacular simply stay scientific-name-only — the game tolerates that.
  if (DO_CLADE_NAMES) {
    // species descendants under each clade (walk each species up to the root)
    const leafCount = new Map();
    for (const n of nodes.values()) {
      if (n.rank !== "species") continue;
      for (let cur = n.parentId; cur; cur = nodes.get(cur)?.parentId) {
        leafCount.set(cur, (leafCount.get(cur) ?? 0) + 1);
      }
    }
    const targets = [...nodes.values()].filter(
      (n) => n.rank !== "species" && n.sciName && (leafCount.get(n.id) ?? 0) >= CLADE_NAME_MIN_LEAVES
    );
    console.log(`→ [GBIF] deriving common names for ${targets.length} clades…`);
    await mapLimit(targets, 6, async (n) => {
      const m = await getJSON(`${GBIF}/species/match?name=${encodeURIComponent(n.sciName)}`);
      const key = m && !m.__error && m.matchType !== "NONE" ? m.usageKey ?? null : null;
      if (!key) return;
      const cn = await englishCommonName(key, n.sciName, cleanCladeName);
      if (cn) { n.common = cn; stats.cladesNamedGbif++; }
    });
    console.log(`   ${stats.cladesNamedGbif}/${targets.length} clades got a clean GBIF vernacular`);
  }

  const list = [...nodes.values()].map((n) => ({
    id: n.id, sciName: n.sciName, ...(n.common ? { common: n.common } : {}), rank: n.rank, parentId: n.parentId,
  }));

  // scopes: first present name in each candidate group
  const scopes = [];
  for (const c of SCOPE_CANDIDATES) {
    if (c.names.includes("life")) { scopes.push({ id: "life", label: c.label }); continue; }
    const hit = c.names.map((nm) => nameToId.get(nm)).find((id) => id && nodes.has(id));
    if (hit) scopes.push({ id: hit, label: c.label });
  }

  const species = list.filter((n) => n.rank === "species").length;
  const clades = list.filter((n) => n.rank !== "species").length;
  const namedClades = list.filter((n) => n.rank !== "species" && n.common).length;

  // Family-depth histogram — the metric that governs Kinship hardness (a group
  // needs ≥4 members; several ≥4 families under one parent make a within-clade
  // board). Kept in the snapshot so we can watch it move build over build.
  const byId = new Map(list.map((n) => [n.id, n]));
  const famOf = (id) => { for (let c = byId.get(id)?.parentId; c; c = byId.get(c)?.parentId) { const n = byId.get(c); if (n?.rank === "family") return c; } return null; };
  const famMembers = {};
  for (const n of list) if (n.rank === "species") { const f = famOf(n.id); if (f) famMembers[f] = (famMembers[f] ?? 0) + 1; }
  const famSizes = Object.values(famMembers);
  const familyDepth = {
    families: famSizes.length,
    ge4: famSizes.filter((v) => v >= 4).length,
    ge6: famSizes.filter((v) => v >= 6).length,
  };

  const buildStats = {
    baseSpecies: stats.base,
    densifiedSpecies: stats.densified,
    densifyCapped: stats.densCapped,
    cladesNamedFromGbif: stats.cladesNamedGbif,
    familyDepth,
  };

  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "GBIF (species + common names) × Open Tree of Life (topology)",
    counts: { nodes: list.length, species },
    build: buildStats,
    scopes, nodes: list,
  }, null, 2));
  console.log(`✓ wrote ${OUT}`);

  // ---- name-review dump ----
  // Every named clade + species, sorted, with member count — eyeball it for junk,
  // then move fixes into CLADE_COMMON (clades) / COMMON_NAME_OVERRIDES (species).
  const leaves = new Map();
  for (const n of list) {
    if (n.rank !== "species") continue;
    for (let cur = n.parentId; cur; cur = byId.get(cur)?.parentId) leaves.set(cur, (leaves.get(cur) ?? 0) + 1);
  }
  const named = list.filter((n) => n.common);
  const cladeRows = named.filter((n) => n.rank !== "species")
    .sort((a, b) => (leaves.get(b.id) ?? 0) - (leaves.get(a.id) ?? 0) || a.common.localeCompare(b.common))
    .map((n) => `clade\t${leaves.get(n.id) ?? 0}\t${n.rank}\t${n.sciName}\t${n.common}`);
  const speciesRows = named.filter((n) => n.rank === "species")
    .sort((a, b) => a.common.localeCompare(b.common))
    .map((n) => `species\t\t${n.rank}\t${n.sciName}\t${n.common}`);
  writeFileSync(NAME_REVIEW,
    `# kind\tleaves\trank\tsciName\tcommonName\n# ${cladeRows.length} named clades, ${speciesRows.length} named species\n` +
    [...cladeRows, ...speciesRows].join("\n") + "\n");
  console.log(`  ↪ names for review: ${NAME_REVIEW} (${cladeRows.length} clades, ${speciesRows.length} species)`);

  console.log(`  ${list.length} nodes, ${species} species (${stats.base} base + ${stats.densified} densified), ${scopes.length} scopes`);
  console.log(`  clades: ${clades} (${namedClades} with a common name — ${stats.cladesNamedGbif} derived from GBIF)`);
  console.log(`  family depth: ${familyDepth.families} families, ${familyDepth.ge4} with ≥4 species, ${familyDepth.ge6} with ≥6  (was 94 / 56 before densification)`);
  console.log(`  ↩ revert: cp "${OUT}.bak" "${OUT}"  (or git checkout)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
