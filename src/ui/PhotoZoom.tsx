import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fetchImageCredit, type WikiCredit, type WikiImage } from "../data/wikipedia";

/** The photographer and licence for one picture, from either source.
 *
 *  CC-BY and its variants ask for the creator by name wherever the work is shown, so every
 *  photograph displayed at a size worth reading carries one: the enlarged views and the
 *  answer reveal. A 96px tile has nowhere to put a name, which is the case the licences'
 *  "in any reasonable manner" allowance exists for.
 *
 *  Renders nothing when there is no credit to show — a picture whose attribution has not
 *  arrived yet, or could not be read at all, gets no line rather than a wrong one. */
export function PhotoCredit({ credit, className }: { credit?: WikiCredit | null; className?: string }) {
  if (!credit?.licence) return null;
  return (
    <span className={`photo-credit${className ? ` ${className}` : ""}`}>
      Photo: {credit.artist ?? "unknown"} · {credit.licence}
      {credit.filePage && (
        <> · <a href={credit.filePage} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>source</a></>
      )}
    </span>
  );
}

/** The credit for whatever picture is currently enlarged.
 *
 *  Every photograph shown at a readable size gets a line, whichever source it came from.
 *  iNaturalist's rides along with the image; Wikimedia's costs one request, made here on
 *  open, so a board of sixteen tiles pays nothing until somebody actually looks at one. */
export function usePhotoCredit(image: WikiImage | null): WikiCredit | null {
  const [credit, setCredit] = useState<WikiCredit | null>(image?.credit ?? null);
  useEffect(() => {
    if (!image) { setCredit(null); return; }
    if (image.credit) { setCredit(image.credit); return; }
    let live = true;
    // Cleared first: paging from a credited photo to one still loading must not leave the
    // previous photographer's name under the new picture.
    setCredit(null);
    fetchImageCredit(image).then((c) => { if (live) setCredit(c); });
    return () => { live = false; };
  }, [image?.full, image?.credit]);
  return credit;
}

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
export function PhotoZoom({ src, caption, credit, onClose }: { src: string; caption?: string | null; credit?: WikiCredit | null; onClose: () => void }) {
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
      <span className="photo-zoom-cap">
        {caption ? `${caption} · tap to close` : "tap to close"}
        <PhotoCredit credit={credit} />
      </span>
    </div>,
    document.body
  );
}

/** Paging through the several photographs we hold of one species, for the enlarged view in
 *  Kinship and Branches.
 *
 *  One photograph is one angle, one lighting and one individual, and on a bad draw that is a
 *  dead end: a bird seen only from behind, a fish on a slab, a plant that is arguably not
 *  the right plant. The alternates are the escape hatch, and the only remedy for a
 *  misidentified community photo that does not need someone to curate the species by hand.
 *
 *  `controls` is null when there is nothing to page through — a lone arrow pair over a
 *  single image reads as a broken gallery.
 *
 *  The index resets on `key` (the species), not on the list: an overlay reused for the next
 *  species must open on that species' first photo, never on whatever page the last one was
 *  left at. */
export function usePhotoPager(
  images: WikiImage[],
  key: string | null,
  /** Supply both to offer "use this one": the picture currently in use for this species,
   *  and what to do when a different one is chosen. The choice belongs to the HOST, which
   *  holds it in component state for the life of the board — it is never stored, so it
   *  cannot follow a player into tomorrow's puzzle and quietly give them a different board
   *  from everyone else's. */
  pick?: { current?: string | null; onPick: (image: WikiImage) => void }
) {
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [key]);
  // Open on the picture the species is actually using, so reopening a tile whose photo was
  // swapped does not show page 1 while the tile behind it shows page 3.
  const currentAt = pick?.current ? images.findIndex((im) => im.full === pick.current) : -1;
  useEffect(() => { if (currentAt > 0) setI(currentAt); }, [currentAt, key]);
  const n = images.length;
  const at = n ? Math.min(i, n - 1) : 0;
  const step = (d: number) => setI((x) => (n ? (Math.min(x, n - 1) + d + n) % n : 0));
  // Arrow keys as well as the buttons. PhotoZoom owns Escape; these sit alongside it, and
  // are bound only while there is more than one picture to move between.
  useEffect(() => {
    if (n < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);
  const shown = images[at] ?? null;
  const inUse = !!shown && (pick?.current ? pick.current === shown.full : at === 0);
  return {
    image: shown,
    controls: n < 2 ? null : (
      // stopPropagation: the overlay closes on any click, and every control here is a click.
      <span className="photo-pager" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => step(-1)} aria-label="Previous photo" title="Previous photo">‹</button>
        <span className="photo-pager-n">{at + 1} / {n}</span>
        <button type="button" onClick={() => step(1)} aria-label="Next photo" title="Next photo">›</button>
        {pick && shown && (
          <button
            type="button"
            className={`photo-pager-pick${inUse ? " is-on" : ""}`}
            disabled={inUse}
            onClick={() => pick.onPick(shown)}
          >
            {inUse ? "✓ In use" : "Use this one"}
          </button>
        )}
      </span>
    ),
  };
}

/** A thumbnail that opens itself full-size: the button, its hover affordance and
 *  the overlay in one piece, for the places that just want a zoomable picture and
 *  have no other use for the open/closed state.
 *
 *  `full` is what the overlay shows; it falls back to the thumbnail when there is
 *  no larger file. `className` is passed through so each host keeps its own
 *  footprint — the button must occupy exactly what the bare <img> did, or the
 *  layout around it shifts. */
export function ZoomableShot({ src, full, image, caption, credit, className, title }: {
  src: string;
  full?: string | null;
  /** The image behind `src`, when the host has it. Passing it lets the overlay credit a
   *  Wikimedia photograph, whose attribution costs a request and so is only fetched once
   *  the picture is actually opened. */
  image?: WikiImage | null;
  caption?: string | null;
  credit?: WikiCredit | null;
  className?: string;
  title?: string;
}) {
  const [zoomed, setZoomed] = useState(false);
  const fetched = usePhotoCredit(zoomed ? image ?? null : null);
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
      {zoomed && <PhotoZoom src={full || src} caption={caption} credit={credit ?? fetched} onClose={() => setZoomed(false)} />}
    </>
  );
}
