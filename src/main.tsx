import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import logoUrl from "../logo.png";
import { startVersionCheck } from "./data/versionCheck";

// Use the bundled logo as the browser-tab icon (favicon) — keeps a single copy
// of the asset in the package, hashed and cache-busted like everything else.
const icon = document.querySelector<HTMLLinkElement>("link[rel~='icon']") ?? document.createElement("link");
icon.rel = "icon";
icon.href = logoUrl;
document.head.appendChild(icon);

// The other half of the stale-asset guard in index.html. That one catches a bundle
// named by the HTML; this catches a LAZY chunk (the taxonomy augment) requested
// later from a tab that was already open when a deploy replaced it. A dynamic
// import creates no element, so no error event fires — Vite reports it here
// instead. Shares the inline guard's attempt counter, so between them they can
// only ever spend the same three reloads.
window.addEventListener("vite:preloadError", () => {
  let tries: number;
  try {
    tries = Number(sessionStorage.getItem("grebe.assetReload") ?? 0);
    sessionStorage.setItem("grebe.assetReload", String(tries + 1));
  } catch {
    return; // can't bound the attempts, so don't start reloading
  }
  if (tries >= 3) return;
  window.setTimeout(() => window.location.reload(), tries === 0 ? 800 : 2000);
});

// Proactive half of the same problem: a tab that a deploy did NOT break still runs
// the old bundle until something makes it reload. This notices and does.
startVersionCheck();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Reaching this line means every bundle loaded, so reset the reload budget: a LATER
// deploy in this same session gets its three attempts back. If reloading doesn't
// fix things, we never get here, the count keeps climbing, and it stops at three.
try {
  sessionStorage.removeItem("grebe.assetReload");
} catch {
  /* private mode */
}
