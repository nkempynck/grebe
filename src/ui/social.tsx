import type { CSSProperties } from "react";

/** Grebe's Instagram page: news and updates, easy discussions, feature requests by DM. Kept here
 *  so the banner, the home page and the About page all link the same place. */
export const INSTAGRAM_URL = "https://www.instagram.com/grebegames/";
export const INSTAGRAM_HANDLE = "@grebegames";

/** The Instagram glyph (outline camera), drawn in the current text colour so it sits in any
 *  link. Inline rather than an image, so nothing extra loads. */
export function InstagramIcon({ size = 14, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ verticalAlign: "-0.15em", ...style }}
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}
