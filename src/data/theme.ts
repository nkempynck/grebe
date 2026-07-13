import { useCallback, useEffect, useState } from "react";

// Light/dark theming. The palette lives entirely in CSS custom properties
// (index.css): :root is the light default, a media query supplies dark for the
// OS preference, and a data-theme attribute on <html> lets the user force one.
// This module only manages that attribute + a remembered choice.

export type Theme = "light" | "dark";
const KEY = "grebe.theme";

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The theme currently on screen: an explicit choice if made, else the OS one. */
function currentTheme(): Theme {
  return stored() ?? systemTheme();
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode — the attribute still applies for this session */
  }
}

/** Tracks the active theme and flips + persists it. Also follows the OS
 *  preference live, but only until the user has made an explicit choice. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => { if (!stored()) setTheme(systemTheme()); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      apply(next);
      return next;
    });
  }, []);

  return [theme, toggle];
}
