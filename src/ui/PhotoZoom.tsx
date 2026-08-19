import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** The enlarged-picture overlay. A 96px square crop is fine for recognising a fox
 *  and useless for telling two beetles apart, so every photograph in the game can
 *  be opened full-size.
 *
 *  Kinship, Branches and the Wikipedia card each grew their own copy of this
 *  (.grid-zoom, .branches-zoom, .clado-zoom — already sharing one CSS rule, which
 *  is the tell). This is the shared one; it renders above them all, so it also
 *  works from inside a dialog like the answer reveal.
 *
 *  Escape closes it as well as a tap. A host that has its own Escape handler must
 *  ignore the key while a zoom is open, or one press closes both.
 *
 *  It renders through a PORTAL, into document.body rather than where it is used,
 *  and both halves of that matter:
 *    - CSS. Sitting inside the result card meant `.result .wikirow img` — width
 *      104px — reached straight into the overlay and sized the enlarged picture,
 *      which is how a "zoom" ended up showing the photo at thumbnail size.
 *    - Layout. `position: fixed` is relative to the nearest ancestor carrying a
 *      transform, not to the viewport. The answer reveal's card keeps one from its
 *      entrance animation (fill-mode `both`), so a zoom opened from the hero photo
 *      would have been trapped inside that card. */
export function PhotoZoom({ src, caption, onClose }: { src: string; caption?: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // The overlay takes focus and hands it back on close. Without this the keyboard was left
  // wherever it was when the picture opened — for a zoom opened from inside the answer reveal
  // that meant focus on the card UNDERNEATH the overlay, with Tab walking content the player
  // could no longer see.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => prev?.focus?.();
  }, []);
  return createPortal(
    <div
      className="photo-zoom"
      role="dialog"
      aria-modal="true"
      aria-label={caption ? `${caption} picture` : "Enlarged picture"}
      tabIndex={-1}
      ref={ref}
      onClick={onClose}
    >
      <img src={src} alt={caption ?? ""} />
      <span className="photo-zoom-cap">{caption ? `${caption} · tap to close` : "tap to close"}</span>
    </div>,
    document.body
  );
}

/** A thumbnail that opens itself full-size: the button, its hover affordance and
 *  the overlay in one piece, for the places that just want a zoomable picture and
 *  have no other use for the open/closed state.
 *
 *  `full` is what the overlay shows; it falls back to the thumbnail when there is
 *  no larger file. `className` is passed through so each host keeps its own
 *  footprint — the button must occupy exactly what the bare <img> did, or the
 *  layout around it shifts. */
export function ZoomableShot({ src, full, caption, className, title }: {
  src: string;
  full?: string | null;
  caption?: string | null;
  className?: string;
  title?: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`zoom-shot${className ? ` ${className}` : ""}`}
        onClick={() => setZoomed(true)}
        title={title ?? "Enlarge picture"}
        aria-label={caption ? `Enlarge ${caption} picture` : "Enlarge picture"}
      >
        <img src={src} alt={caption ?? ""} />
        <span className="zoom-shot-icon" aria-hidden="true">⤢</span>
      </button>
      {zoomed && <PhotoZoom src={full || src} caption={caption} onClose={() => setZoomed(false)} />}
    </>
  );
}
