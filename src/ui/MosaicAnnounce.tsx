// A short announcement that there is a fourth game now.
//
// DELIBERATELY DISPOSABLE. It shows for a fixed window and then renders nothing at all, so
// nobody has to remember to take it down, and once the window has passed this whole file can be
// deleted without touching anything else. That is the point: a banner nobody removes becomes
// furniture, and a site with permanent "NEW!" on it is a site that stopped changing.
//
// Two ways out for the player, because an announcement that cannot be dismissed is an advert:
// tapping through to the game counts as having seen it, and so does closing it.
import { todayKey } from "../core/daily";

/** The window, inclusive both ends. Move these if the release slips; nothing else needs to
 *  change, and a window in the past is the same as this component not existing. */
const FROM = "2026-09-06";
const UNTIL = "2026-09-13";

const KEY = "grebe.announce.mosaic";

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false; // private mode: better to show it twice than to crash on a banner
  }
}

function remember(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* ignore — it just shows again next visit */
  }
}

export function MosaicAnnounce({ onPlay, onClose }: { onPlay: () => void; onClose: () => void }) {
  const today = todayKey();
  if (today < FROM || today > UNTIL || dismissed()) return null;
  return (
    <aside className="announce" data-game="mosaic">
      <span className="announce-tag">New</span>
      <p className="announce-text">
        <b>Mosaic</b> has launched. Also new: in Kinship and Branches, enlarge a species and you
        can flip through several photos of it.
      </p>
      <button
        className="announce-go"
        onClick={() => { remember(); onPlay(); }}
      >
        Play it →
      </button>
      <button
        className="announce-x"
        aria-label="Dismiss"
        onClick={() => { remember(); onClose(); }}
      >
        ×
      </button>
    </aside>
  );
}
