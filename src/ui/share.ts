/** The canonical public URL, dropped at the end of a shared result to invite
 *  others straight to the game. Hardcoded (not window.location.origin) so a result
 *  copied from localhost or a preview deploy still links to the real site. Update
 *  here if the domain changes. */
export const SITE_URL = "https://grebegames.com";

export function gameUrl(): string {
  return SITE_URL;
}
