/** The canonical public URL, dropped at the end of a shared result to invite
 *  others straight to the game. Hardcoded (not window.location.origin) so a result
 *  copied from localhost or a preview deploy still links to the real site. Update
 *  here if the domain changes. */
export const SITE_URL = "https://grebegames.com";

export function gameUrl(): string {
  return SITE_URL;
}

/** Branches' shareable grid: ONE ROW PER SUBMIT, one square per slot in board
 *  order, so a board won after a mistake shows the row it went wrong on above the
 *  clean one. `attempts` holds a char per slot ("1" correct / "0" wrong) per
 *  submit; `square` renders a slot that came up correct (🟩, or 🟨/🟦 when help
 *  was used — help belongs to the slot, not the submit, so it shows from the row
 *  the slot first came up correct on). A wrong slot is always ⬛.
 *
 *  With no history — a board restored from the server (which keeps only summary
 *  stats), or one finished before attempts were recorded — it falls back to a
 *  single row of the final state, which is what the grid always used to show. */
export function branchesShareRows(
  slotIds: string[],
  attempts: string[],
  square: (slotId: string) => string
): string[] {
  if (attempts.length === 0) return [slotIds.map(square).join("")];
  return attempts.map((row) => slotIds.map((s, i) => (row[i] === "1" ? square(s) : "⬛")).join(""));
}
