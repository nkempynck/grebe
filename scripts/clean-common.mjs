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
