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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
