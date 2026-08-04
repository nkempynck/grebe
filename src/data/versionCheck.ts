/** Picks up a deploy in a tab that was already open.
 *
 *  Once index.html has loaded, an SPA never fetches it again, so a tab left open
 *  keeps running the bundle it started with for as long as it lives. The guards in
 *  index.html and main.tsx only fire when a deploy BROKE such a tab (a bundle it
 *  still needs is gone); a tab that keeps working just quietly stays old.
 *
 *  So: compare the build baked into this bundle against /version.json, which is
 *  no-cache and rewritten by every deploy, and reload when they differ. Progress
 *  for all three games is persisted to localStorage on every move, so a reload
 *  restores the game in place — hence no prompt, it just happens.
 *
 *  Anything unexpected (offline, 404 from a deploy that predates version.json, a
 *  Pages error page instead of JSON) is a no-op: staying on the old build is the
 *  safe outcome, and a check that can't read a build id must never reload. */

const VERSION_URL = "/version.json";
/** How often an awake, visible tab re-checks on its own. Deliberately slow: this is
 *  only the backstop for a tab nobody ever switches away from. The checks that
 *  actually matter are event-driven (tab focus, machine wake) and don't wait on it,
 *  so lengthening this delays nobody in practice and costs one request an hour. */
const POLL_MS = 60 * 60_000;
/** Heartbeat. Short so that a machine waking from sleep is noticed promptly, but it
 *  only FETCHES when POLL_MS has elapsed or a sleep gap was detected, so a tab left
 *  open all day still makes four requests an hour, not sixty. */
const TICK_MS = 20_000;
/** A tick arriving this much later than scheduled means the machine was suspended
 *  (timers don't run while asleep). That is a resume, and the most likely moment for
 *  the page to be many hours out of date, so it re-checks immediately. */
const SLEEP_GAP_MS = 90_000;
/** Floor between two actual fetches, whatever asks for one. */
const MIN_CHECK_MS = 30_000;
/** Quiet period before reloading: a real pause, not the gap between two guesses.
 *  Someone thinking hard about a board can sit still for a minute, and reloading
 *  them mid-thought is the one way this becomes annoying. A tab just switched to, or
 *  a machine just woken, clears it instantly, since nothing can have been typed while
 *  it was away, so the cases we most want to catch are not slowed down at all. */
const IDLE_MS = 3 * 60_000;

let lastActivity = Date.now();
let lastCheck = 0;
let stale = false; // a newer build exists; waiting for a quiet moment
let checking = false;

async function check(): Promise<void> {
  // Already know / in flight / just asked. The last of those matters because three
  // listeners fire on one tab switch and alt-tabbing is a fast loop; without it a
  // restless user would poll the origin continuously.
  if (stale || checking || Date.now() - lastCheck < MIN_CHECK_MS) return;
  checking = true;
  lastCheck = Date.now();
  try {
    const res = await fetch(VERSION_URL, { cache: "no-store" });
    if (!res.ok) return;
    const body: unknown = await res.json();
    const id = (body as { buildId?: unknown } | null)?.buildId;
    if (typeof id === "string" && id !== "" && id !== __BUILD_ID__) stale = true;
  } catch {
    /* offline, or not JSON — treat as "no news" */
  } finally {
    checking = false;
  }
}

function reloadIfQuiet(): void {
  if (stale && Date.now() - lastActivity >= IDLE_MS) window.location.reload();
}

/** Starts watching for new deploys. Call once, at startup. */
export function startVersionCheck(): void {
  const note = () => { lastActivity = Date.now(); };
  for (const ev of ["keydown", "pointerdown", "input"]) {
    window.addEventListener(ev, note, { passive: true });
  }

  const run = () => { void check().then(reloadIfQuiet); };

  // Returning to a tab is the common case and the best moment to act on it. Three
  // events because no one of them is reliable for the case that matters most, a
  // laptop closed overnight and reopened: `visibilitychange` needs the tab to have
  // been marked hidden, which doesn't happen if it was the foreground tab when the
  // lid shut, and `pageshow` only fires on a bfcache restore. Whichever arrives
  // first wins; the rest are cheap no-ops behind the POLL_MS gate below.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run();
  });
  window.addEventListener("focus", run);
  window.addEventListener("pageshow", run);

  // Backstop, and the only thing that catches a resume that fires no event at all:
  // a tab nobody switches away from, on a machine that just woke up. Ticks often but
  // fetches rarely — on the POLL_MS schedule, or at once when the gap between ticks
  // shows the machine was suspended.
  let lastTick = Date.now();
  window.setInterval(() => {
    const now = Date.now();
    const wokeUp = now - lastTick > SLEEP_GAP_MS;
    lastTick = now;
    if (document.visibilityState !== "visible") return;
    if (wokeUp || now - lastCheck >= POLL_MS) run();
    else reloadIfQuiet(); // a pending reload still waiting for the player to pause
  }, TICK_MS);
}
