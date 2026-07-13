import taxonomy from "./taxonomy.json";

// A pool of species common names used to give new players a fun default display
// name. Kept short and to the characters a display name allows (letters, digits,
// spaces, hyphens) so they pass set_display_name(). Funny/edge names are welcome;
// anything the profanity filter happens to block is just skipped at assignment.
const POOL: string[] = ((taxonomy.nodes as { rank: string; common?: string }[]) || [])
  .filter((n) => n.rank === "species" && n.common)
  .map((n) => n.common as string)
  .filter((c) => /^[A-Za-z][A-Za-z0-9 -]*$/.test(c) && c.length >= 3 && c.length <= 15);

/** A random species name shaped into a username-y handle: words CamelCased and
 *  joined with no spaces or hyphens ("Red Fox" → "RedFox", "Three-toed Sloth" →
 *  "ThreeToedSloth"). This becomes both the login handle and the initial
 *  leaderboard name for a new player. Falls back to "Explorer" if empty. */
export function randomSpeciesName(): string {
  const raw = POOL[Math.floor(Math.random() * POOL.length)] ?? "Explorer";
  const handle = raw
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("")
    .slice(0, 20);
  return handle.length >= 3 ? handle : "Explorer";
}
