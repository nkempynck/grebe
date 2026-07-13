import taxonomy from "./taxonomy.json";

// A pool of species common names used to give new players a fun default display
// name. Kept short and to the characters a display name allows (letters, digits,
// spaces, hyphens) so they pass set_display_name(). Funny/edge names are welcome;
// anything the profanity filter happens to block is just skipped at assignment.
const POOL: string[] = ((taxonomy.nodes as { rank: string; common?: string }[]) || [])
  .filter((n) => n.rank === "species" && n.common)
  .map((n) => n.common as string)
  .filter((c) => /^[A-Za-z][A-Za-z0-9 -]*$/.test(c) && c.length >= 3 && c.length <= 15);

/** A random species common name (leaves room for a trailing number within the
 *  20-char display-name limit). Falls back to "Explorer" if the pool is empty. */
export function randomSpeciesName(): string {
  return POOL[Math.floor(Math.random() * POOL.length)] ?? "Explorer";
}
