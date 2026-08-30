// The picture, at whichever rung the player has earned.
//
// The ladder used to be seven pre-built JPEGs per day, shuffled and blurred by a build script
// and staged under public/mosaic/<date>/. That existed for one good reason — the file the
// browser fetched was already scrambled, so the answer was not sitting in the network tab — and
// it cost a staging run per day, which is why only twenty days ever existed.
//
// The beta trades that away. It fetches the species' photograph live from Wikipedia and does the
// scrambling here in CSS, so every animal in the pool is playable with no pipeline at all. The
// price is that the picture's URL is a Wikimedia filename with the species in it, readable by
// anyone who opens devtools. That is acceptable while nothing is being scored; it is also the
// reason Mosaic cannot take a leaderboard without a server between it and Wikimedia.
//
// Shuffling in CSS rather than on a canvas is deliberate: background-position needs no pixel
// access, so there is no CORS request, no tainted canvas and no second copy of the image in
// memory. Each tile is a div pointing at the one image the browser already has.
import { useEffect, useState } from "react";
import { mosaicTileOrder, type MosaicMechanic } from "../core/mosaic";

interface Props {
  src: string;
  /** The full-resolution original, used when the sized thumbnail will not load. */
  fallback: string;
  mechanic: MosaicMechanic;
  /** The ladder value: tiles per side when shuffling, the reduced width when blurring. Passed
   *  rather than a rung index because the ladder now depends on how many guesses the day has,
   *  which is the game's business and not the picture's. */
  step: number;
  /** The whole picture, no ladder: the round is over. */
  revealed: boolean;
  alt: string;
  /** Neither URL loaded. The game reports it rather than showing an empty frame. */
  onUnavailable?: () => void;
}

/** A URL inside a CSS url() literal. Wikimedia percent-encodes its filenames so there is
 *  nothing to escape in practice, but a quote reaching a style attribute is not a thing to
 *  leave to practice. */
function cssUrl(u: string): string {
  return u.replace(/["\\]/g, "\\$&");
}

export function MosaicPicture({ src, fallback, mechanic, step, revealed, alt, onUnavailable }: Props) {
  const [url, setUrl] = useState(src);
  // The photograph's own shape, measured rather than assumed. The stage takes it so the whole
  // animal is on screen: a fixed box would crop, and cropping is how a barramundi lost its head.
  // Null until the file has loaded, which is also the signal that there is nothing to draw yet.
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => { setUrl(src); setRatio(null); }, [src]);

  useEffect(() => {
    let live = true;
    const probe = new Image();
    probe.onload = () => { if (live) setRatio(probe.naturalWidth / probe.naturalHeight || 1); };
    probe.onerror = () => {
      if (!live) return;
      // One retry, at the original: the sized render can be missing where the source file is
      // smaller than the width we asked the wiki for.
      if (url !== fallback) setUrl(fallback);
      else onUnavailable?.();
    };
    probe.src = url;
    return () => { live = false; };
    // onUnavailable is deliberately not a dependency: it is a fresh closure on every render of
    // the parent, and re-running this would re-download the picture on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, fallback]);

  if (!ratio) {
    return <div className="mosaic-shot is-loading" aria-busy="true" aria-label="Loading the picture" />;
  }

  // Width is capped so that height cannot exceed the cap either, which is what keeps a tall
  // portrait from pushing the guess bar off the screen.
  const box = {
    aspectRatio: String(ratio),
    maxWidth: `min(100%, calc(min(68vh, 34rem) * ${ratio}))`,
  };

  if (revealed || mechanic === "blur") {
    // Blur is a bench mechanic. The staged pipeline made it by shrinking the file to N pixels
    // wide and letting the browser smooth it back up, so the radius here is that same reduction
    // read against a nominal stage width. It approximates; it is not measured against the real
    // element, because a mechanic nobody ships does not earn a resize observer.
    const px = revealed ? 0 : 480 / step / 2;
    return (
      <div className="mosaic-shot" style={box}>
        <img
          className="mosaic-shot-img"
          src={url}
          alt={alt}
          style={px ? { filter: `blur(${px.toFixed(1)}px)` } : undefined}
        />
      </div>
    );
  }

  const n = step;
  // Seeded on the ladder VALUE, not the rung index. Two guesses that land on the same value —
  // the last two of every day, by design — then keep the same permutation, so the picture does
  // not rescramble for no reason on the final guess.
  const order = mosaicTileOrder(`${url}:${n}`, n);
  return (
    <div
      className="mosaic-shot mosaic-shot-grid"
      style={{ ...box, gridTemplateColumns: `repeat(${n}, 1fr)`, gridTemplateRows: `repeat(${n}, 1fr)` }}
      role="img"
      aria-label={alt}
    >
      {order.map((from, i) => (
        <span
          key={i}
          style={{
            backgroundImage: `url("${cssUrl(url)}")`,
            // The image is scaled to n times the TILE, which is exactly the whole stage, so the
            // grid shows the picture at its own proportions with no squashing.
            backgroundSize: `${n * 100}% ${n * 100}%`,
            backgroundPosition:
              `${((from % n) / (n - 1)) * 100}% ${(Math.floor(from / n) / (n - 1)) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
