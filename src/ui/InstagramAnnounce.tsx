// A short announcement that Grebe has an Instagram page.
//
// DISPOSABLE, like MosaicAnnounce: it shows for a fixed window and then renders nothing, so
// nobody has to take it down. The permanent mentions live on the home page and the About page.
// Following the link counts as having seen it, and so does closing it.
import { todayKey } from "../core/daily";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL, InstagramIcon } from "./social";

/** The window, inclusive both ends. A window in the past is the same as this not existing. */
const FROM = "2026-10-05";
const UNTIL = "2026-10-19";

const KEY = "grebe.announce.instagram";

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

export function InstagramAnnounce({ onClose }: { onClose: () => void }) {
  const today = todayKey();
  if (today < FROM || today > UNTIL || dismissed()) return null;
  return (
    <aside className="announce" data-kind="instagram">
      <span className="announce-tag">New</span>
      <p className="announce-text">
        <b>Grebe is on Instagram.</b> Follow {INSTAGRAM_HANDLE} for news and updates, easy
        discussions (feel free to send me a DM with feature requests and ideas), and potentially
        some laughs.
      </p>
      <a
        className="announce-go"
        href={INSTAGRAM_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => { remember(); onClose(); }}
      >
        <InstagramIcon /> Follow →
      </a>
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
