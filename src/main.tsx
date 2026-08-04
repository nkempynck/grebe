import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import logoUrl from "../logo.png";

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
// instead. Same one-shot flag as the inline guard, so the two can't ping-pong.
window.addEventListener("vite:preloadError", () => {
  try {
    if (sessionStorage.getItem("grebe.assetReload")) return;
    sessionStorage.setItem("grebe.assetReload", "1");
  } catch {
    /* private mode — reload anyway, the flag is only loop protection */
  }
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Reaching this line means every bundle loaded, so clear the one-shot reload flag:
// a LATER deploy in this same session can then recover the same way. If a reload
// doesn't fix things, we never get here and the flag stays set, so it can't loop.
try {
  sessionStorage.removeItem("grebe.assetReload");
} catch {
  /* private mode */
}
