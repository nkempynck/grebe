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

interface PrimaryFile { built: string; photos: Record<string, InatPhoto> }
interface AltFile { built: string; photos: Record<string, InatPhoto[]> }

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

// TWO CHUNKS, SPLIT BY HOW OFTEN THEY ARE NEEDED. Both are lazy, and each is cached as one
// promise, exactly like the Kinship/Branches augment.
//
// A board reads ONE photo per species; the alternates exist for the moment someone pages
// through them in the enlarged view, which most players never do. Shipping all three
// together meant every player downloading ~18,600 records to read sixteen of them, and the
// combined file gzipped larger than the taxonomy itself. Split, the common path carries a
// third of that and the rest arrives only if somebody asks for it.
let cachedPrimary: Promise<Record<string, InatPhoto>> | null = null;
let cachedAlts: Promise<Record<string, InatPhoto[]>> | null = null;

export function loadSpeciesPhotos(): Promise<Record<string, InatPhoto>> {
  if (!cachedPrimary) {
    cachedPrimary = import("./speciesPhotos.json")
      .then((m) => ((m.default ?? m) as unknown as PrimaryFile).photos ?? {})
      // A missing or malformed chunk must not take the pictures down with it: every caller
      // falls back to Wikipedia when this comes back empty.
      .catch(() => ({}));
  }
  return cachedPrimary;
}

function loadSpeciesPhotoAlts(): Promise<Record<string, InatPhoto[]>> {
  if (!cachedAlts) {
    cachedAlts = import("./speciesPhotosAlt.json")
      .then((m) => ((m.default ?? m) as unknown as AltFile).photos ?? {})
      // Failing here costs the pager its extra pages and nothing else.
      .catch(() => ({}));
  }
  return cachedAlts;
}

/** The one photo the games show for a node. Null for clades, and for any species
 *  iNaturalist has no CC-licensed picture of. */
export async function inatPhotoFor(node: TaxonNode): Promise<InatPhoto | null> {
  if (node.rank !== "species" || node.virtual) return null;
  const map = await loadSpeciesPhotos();
  return map[node.id] ?? null;
}

/** Every photo we hold for a node, best first. Downloads the alternates chunk, so call it
 *  only where a player has asked to see more than one picture. */
export async function inatPhotosFor(node: TaxonNode): Promise<InatPhoto[]> {
  const first = await inatPhotoFor(node);
  if (!first) return [];
  const alts = await loadSpeciesPhotoAlts();
  return [first, ...(alts[node.id] ?? [])];
}
