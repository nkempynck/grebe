import type { TaxonNode } from "../core/types";

/** One CC-licensed iNaturalist photograph, as baked by scripts/pull-inat-photos.mjs.
 *  Field names are short because there are ~7,000 species x up to 3 photos in the file. */
export interface InatPhoto {
  /** iNaturalist photo id; the URL is derived from it. */
  p: number;
  /** Licence code, e.g. "cc-by-nc". Never an ND licence: the build drops those. */
  l: string;
  /** Photographer, for the credit line. Null when iNaturalist has no name for them. */
  by: string | null;
  w: number;
  h: number;
  /** File extension when it is not jpg. */
  e?: string;
}

interface PhotoFile { built: string; photos: Record<string, InatPhoto[]> }

/** Sizes iNaturalist renders. `original` is deliberately unused: a featured photo is
 *  regularly several megabytes, and `large` is already 1024 on the long side, which is what
 *  Mosaic renders at and more than a zoomed tile needs. */
type Size = "square" | "small" | "medium" | "large" | "original";

export function inatUrl(photo: InatPhoto, size: Size): string {
  return `https://inaturalist-open-data.s3.amazonaws.com/photos/${photo.p}/${size}.${photo.e ?? "jpg"}`;
}

/** The photo's own page, where the licence terms and the photographer live. */
export function inatPageUrl(photo: InatPhoto): string {
  return `https://www.inaturalist.org/photos/${photo.p}`;
}

// Lazy, and cached as one promise, exactly like the Kinship/Branches augment: the file is
// ~1MB and the first paint does not need it, so it downloads as its own chunk the first time
// anything asks for a picture.
let cached: Promise<Record<string, InatPhoto[]>> | null = null;

export function loadSpeciesPhotos(): Promise<Record<string, InatPhoto[]>> {
  if (!cached) {
    cached = import("./speciesPhotos.json")
      .then((m) => ((m.default ?? m) as unknown as PhotoFile).photos ?? {})
      // A missing or malformed chunk must not take the pictures down with it: every caller
      // falls back to Wikipedia when this comes back empty.
      .catch(() => ({}));
  }
  return cached;
}

/** The photos we hold for a node, best first. Empty for clades, and for any species
 *  iNaturalist has no CC-licensed picture of. */
export async function inatPhotosFor(node: TaxonNode): Promise<InatPhoto[]> {
  if (node.rank !== "species" || node.virtual) return [];
  const map = await loadSpeciesPhotos();
  return map[node.id] ?? [];
}
