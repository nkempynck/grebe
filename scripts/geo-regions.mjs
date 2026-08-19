// ISO 3166-1 alpha-2 -> continent, and -> biogeographic realm.
//
// TWO SCHEMES, deliberately. Continents are what a player thinks in ("that looks African").
// Realms are what a tree-of-life game is actually about: they explain why kangaroos and
// platypuses go together, why North Africa belongs with Europe, and why Bali and Lombok have
// different faunas. Both are computed from the same country facets and stored side by side, so
// switching the game from one to the other is a one-line change, not a re-fetch.
//
// COUNTRY GRANULARITY IS THE LIMIT of this approach, and it bites hardest on realms. Mexico is
// Nearctic in the north and Neotropic in the south; China is Palearctic above the Yangtze and
// Indomalayan below it; Indonesia is split down the middle by the Wallace line, which is the
// single most famous boundary in biogeography and the one this model cannot see. Each of those
// is assigned its DOMINANT realm below and flagged. Getting them right needs occurrence
// coordinates rather than country codes.

/** Continent codes. Three letters so nothing collides with an ISO country code — "NA" is
 *  Namibia and "AS" is American Samoa, which is exactly the sort of bug that would quietly
 *  file half of Africa under North America. */
export const CONTINENTS = ["AFR", "ASI", "EUR", "NAM", "SAM", "OCE", "ANT"];

export const CONTINENT_LABEL = {
  AFR: "Africa", ASI: "Asia", EUR: "Europe", NAM: "N America",
  SAM: "S America", OCE: "Oceania", ANT: "Antarctica",
};

/** Biogeographic realms (Udvardy / Olson). */
export const REALMS = ["PAL", "NEA", "NEO", "AFT", "IND", "AUS", "OCN", "ANT"];

export const REALM_LABEL = {
  PAL: "Palearctic", NEA: "Nearctic", NEO: "Neotropic", AFT: "Afrotropic",
  IND: "Indomalayan", AUS: "Australasian", OCN: "Oceanian", ANT: "Antarctic",
};

const expand = (table) => {
  const out = {};
  for (const [code, list] of Object.entries(table))
    for (const cc of list.trim().split(/\s+/)) out[cc] = code;
  return out;
};

export const CONTINENT_OF = expand({
  AFR: `DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY
        MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW`,
  ASI: `AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KP KR KW KG LA LB MO MY MV
        MN MM NP OM PK PS PH QA SA SG LK SY TW TJ TH TL TR TM AE UZ VN YE`,
  EUR: `AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE LV LI LT LU MT
        MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA AX`,
  NAM: `AI AG AW BS BB BZ BM BQ VG CA KY CR CU CW DM DO SV GL GD GP GT HT HN JM MQ MX MS NI PA
        PR BL KN LC MF PM VC SX TT TC US VI`,
  SAM: `AR BO BR CL CO EC FK GF GY PY PE SR UY VE`,
  OCE: `AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF UM`,
  ANT: `AQ BV GS HM TF`,
});
// Late additions, kept apart so the main table stays the readable one.
Object.assign(CONTINENT_OF, {
  XK: "EUR",           // Kosovo
  CX: "ASI", CC: "ASI", // Christmas I. and Cocos (Keeling) — Australian territory, Asian shelf
  IO: "ASI",           // British Indian Ocean Territory (Chagos)
});

export const REALM_OF = expand({
  // Europe, North Africa, the Middle East and Asia north of the Himalaya.
  PAL: `AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE LV LI LT LU MT
        MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB VA AX
        DZ EG LY MA TN EH
        AM AZ GE TR CY IL JO LB SY IQ IR KZ KG TJ TM UZ AF MN KP KR JP
        CN`,
  // North America down to the northern Mexican deserts. US absorbs Hawaii, which is really
  // Oceanian; Mexico's south is really Neotropic.
  NEA: `CA US GL PM BM MX`,
  // Central and South America plus the Caribbean.
  NEO: `AI AG AW BS BB BZ BQ VG KY CR CU CW DM DO SV GD GP GT HT HN JM MQ MS NI PA PR BL KN LC
        MF VC SX TT TC VI
        AR BO BR CL CO EC FK GF GY PY PE SR UY VE`,
  // Sub-Saharan Africa, Madagascar, southern Arabia.
  AFT: `AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ GQ ER SZ ET GA GM GH GN GW KE LS LR MG MW ML
        MR MU YT MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG UG ZM ZW
        SA YE OM AE QA BH KW`,
  // South and Southeast Asia west of the Wallace line.
  IND: `BD BT BN KH HK IN ID LA MO MY MV MM NP PK PH LK SG TW TH TL VN`,
  // Australia, New Guinea, New Zealand and the islands east of Wallace.
  AUS: `AU NZ PG SB VU NC NF`,
  // Remote Pacific.
  OCN: `AS CK FJ PF GU KI MH FM NR NU PW PN WS TK TO TV WF MP`,
  ANT: `AQ BV GS HM TF`,
});
Object.assign(REALM_OF, {
  XK: "PAL", UM: "OCN",
  CX: "IND", CC: "IND", IO: "IND",
});

/** Countries split by a meridian, because assigning them whole is wrong either way.
 *
 *  RUSSIA was the case that forced this. Assigned to Europe it labels the Baikal seal (100% of
 *  its records Russian), the sable and Pallas's cat European. Flipped to Asia it is worse, not
 *  better: measured over the pool, Europe-only-via-Russia affects 8 species while
 *  Asia-only-via-Russia would affect 34, because most Russian records come from European Russia
 *  where the observers are. Neither whole-country answer is defensible, so the records are split
 *  at the Urals and counted on both sides. Checked: tiger 100% east, sable 97% east, red
 *  squirrel 30% east, which is what those animals actually do.
 *
 *  INDONESIA is here for the realms, not the continents — it is all Asia either way, but the
 *  WALLACE LINE runs through it, and Indomalayan versus Australasian is the single sharpest
 *  faunal boundary on earth. 120°E is a straight-meridian approximation of a line that really
 *  runs between Bali and Lombok and around Sulawesi.
 *
 *  Each half becomes a pseudo-code that the region tables below resolve normally. */
export const MERIDIAN_SPLITS = {
  RU: { at: 60, west: "RU_W", east: "RU_E", note: "the Urals" },
  ID: { at: 120, west: "ID_W", east: "ID_E", note: "the Wallace line, approximated" },
};

Object.assign(CONTINENT_OF, { RU_W: "EUR", RU_E: "ASI", ID_W: "ASI", ID_E: "ASI" });
Object.assign(REALM_OF, { RU_W: "PAL", RU_E: "PAL", ID_W: "IND", ID_E: "AUS" });

/** Codes that are deliberately unmapped, so the build does not report them as gaps.
 *
 *  ZZ is GBIF's "unknown or invalid country", and it is the single most common code in the
 *  whole dataset — 44 of the first 60 species carry some. It must stay IN the denominator and
 *  OUT of every region: a whale mostly recorded in international waters genuinely has weak
 *  claim to any continent, and quietly dropping those records would hand it one. */
export const IGNORED_CODES = new Set(["ZZ", "XZ"]);

/** Countries whose realm assignment is a compromise, kept as data so the build can report them
 *  rather than leaving the reader to notice. */
export const REALM_COMPROMISES = {
  MX: "Nearctic north / Neotropic south — assigned Nearctic",
  CN: "Palearctic north / Indomalayan south — assigned Palearctic",
  ID: "split by the WALLACE LINE, Indomalayan west / Australasian east — assigned Indomalayan",
  US: "Nearctic, but Hawaii is Oceanian",
  IN: "Indomalayan, but the Himalaya and north-west are Palearctic",
  SA: "Palearctic north / Afrotropic south-west — assigned Afrotropic",
  PK: "Indomalayan south-east / Palearctic north-west — assigned Indomalayan",
};

/** Every ISO code we know, for the build's coverage report. */
export const KNOWN_CODES = new Set([...Object.keys(CONTINENT_OF), ...Object.keys(REALM_OF)]);
