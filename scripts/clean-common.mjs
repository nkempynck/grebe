// The vernacular-name filter shared by every script that takes an English name from Wikidata
// (P1843), so the base tree (build-names.mjs) and the augment (build-augment.mjs) accept
// exactly the same names. Returns the cleaned name, or null when it is not usable: too long or
// short, digits or brackets, non-ASCII, an all-caps abbreviation, or more than four words.
export function cleanCommon(name) {
  if (!name) return null; const n = name.trim();
  if (n.length < 2 || n.length > 30) return null;
  if (/[0-9(){}\[\]\/]/.test(n)) return null;
  if (/[^\x00-\x7F]/.test(n)) return null;
  if (n === n.toUpperCase() && n.length <= 5) return null;
  if (n.split(/\s+/).length > 4) return null;
  const norm = n === n.toUpperCase() ? n.toLowerCase() : n;
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}

// The same filter for a CLADE's English name, plus what only a group name gets wrong: "and
// allies" tails, "species"/"indet." placeholders, purely generic words ("animals", "insects"),
// foreign-language names Wikidata tags as English, and reduplicated forms.
const GENERIC_CLADE_NAMES = new Set(["life","organism","organisms","animal","animals","plant","plants","fungus","fungi","mould","moulds","mold","molds","microbe","microbes","bacteria","creature","creatures","insect","insects","species","wildlife","vertebrate","vertebrates","invertebrate","invertebrates"]);
const FOREIGN_MARKERS = new Set(["de","la","el","del","los","las","da","do","dos","das","roja","rojo","negra","negro","verde","comun","gato","perro","cavalo","ular","kura","ikan","burung","pokok","ardilla","berleher"]);
export function cleanCladeName(name) {
  let cc = cleanCommon((name ?? "").replace(/,?\s+and allies$/i, "").trim());
  if (!cc) return null;
  if (/\bindet\b/i.test(cc) || /\bspecies$/i.test(cc) || /\bsect\.?\b/i.test(cc)) return null;
  const words = cc.toLowerCase().split(/[\s-]+/).filter(Boolean);
  if (words.every((w) => GENERIC_CLADE_NAMES.has(w))) return null;
  if (words.some((w) => FOREIGN_MARKERS.has(w))) return null;
  if (/\b([a-z]{3,})-\1\b/i.test(cc)) return null;
  return cc.replace(/\b(And|Or|Of|The|In)\b/g, (m) => m.toLowerCase());
}
