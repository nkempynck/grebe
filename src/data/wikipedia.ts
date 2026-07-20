import type { TaxonNode } from "../core/types";

// Wikipedia's REST summary endpoint is CORS-enabled, so it works straight from
// the browser with no proxy. If you later hit rate limits, add a small backend
// cache — but the shape below (title -> summary) is all the app depends on.

const REST = "https://en.wikipedia.org/api/rest_v1/page/summary/";

export interface WikiSummary {
  title: string;
  extract: string;
  thumbnail?: string;
  /** Full-resolution lead image (for an enlarged view). */
  original?: string;
  pageUrl: string;
}

/** Candidate Wikipedia titles for a node, best first. The scientific (binomial)
 *  name is preferred because the database's common names don't always match
 *  Wikipedia's article titles, whereas Wikipedia keeps redirects from scientific
 *  names to the article (and the summary endpoint follows redirects) — so the
 *  Latin name is the most reliable key. A curated override (wikiTitle) still
 *  wins; the common name is a last resort for the rare species whose article
 *  sits only under the common name with no binomial redirect. */
function candidateTitles(node: TaxonNode): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [node.wikiTitle, node.sciName, node.common]) {
    const v = t?.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
}

/** The best Wikipedia title to use for a node (the top candidate). */
export function wikiTitleFor(node: TaxonNode): string {
  return candidateTitles(node)[0] ?? node.sciName;
}

/** Public article URL (works even if the summary fetch fails). */
export function wikiUrlFor(node: TaxonNode): string {
  return "https://en.wikipedia.org/wiki/" + encodeURIComponent(wikiTitleFor(node).replace(/ /g, "_"));
}

export interface WikiImage {
  /** Small square-ish image for a tile. */
  thumb: string;
  /** Larger image for an enlarged view (falls back to the thumb). */
  full: string;
}

// Images are shown on many tiles at once, so cache per node id (including misses,
// as null) to avoid re-fetching the same species across renders.
const imgCache = new Map<string, WikiImage | null>();

// A page's lead image is often not a photo of the organism: range/distribution
// maps, IUCN-status icons, and old line-drawing plates all commonly sit at the
// top of a taxon infobox. Two cheap signals separate a photo from those:
//   1. File type — photographs are virtually always JPEG, whereas maps and
//      diagrams are SVG/PNG (Wikipedia renders SVGs to a *.svg.png thumbnail, so
//      we test the ORIGINAL file's extension, not the thumb's).
//   2. Filename — maps/icons carry tell-tale words.
// Neither is perfect (a colour-plate illustration saved as JPEG still slips
// through), but together they catch the common cases.
const NON_PHOTO_NAME =
  /(\bmap\b|range|distribution|locator|_area|_world\b|iucn|status[_ ]|wikispecies|commons-logo|question_book|disambig|_icon\b|\bicon\b|\blogo\b|ambox|silhouette)/i;

/** True when a file URL/name looks like a map, diagram, icon or drawing rather
 *  than a photograph. Pass the ORIGINAL file URL (or a File: title). */
function looksNonPhoto(url: string | undefined): boolean {
  if (!url) return true;
  const path = decodeURIComponent(url.split("?")[0]);
  if (/\.(svg|png|gif)$/i.test(path)) return true; // photos are JPEG; these are diagrams/maps
  return NON_PHOTO_NAME.test(path.split("/").pop() ?? path);
}

interface PageImage { title: string; mime: string; w: number; h: number; thumb: string; full: string; }

/** All images embedded in an article, with type + size, via the MediaWiki Action
 *  API (CORS-enabled with origin=*). Used only as a fallback when the lead image
 *  isn't a usable photo. Returns [] on any failure. */
async function fetchPageImages(title: string): Promise<PageImage[]> {
  const params = new URLSearchParams({
    action: "query", format: "json", origin: "*",
    titles: title, generator: "images", gimlimit: "40",
    prop: "imageinfo", iiprop: "url|mime|size", iiurlwidth: "320",
  });
  try {
    const res = await fetch("https://en.wikipedia.org/w/api.php?" + params, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const data = await res.json();
    const pages: Record<string, { title?: string; imageinfo?: Array<{ mime?: string; width?: number; height?: number; url?: string; thumburl?: string }> }> = data?.query?.pages ?? {};
    const out: PageImage[] = [];
    for (const p of Object.values(pages)) {
      const ii = p.imageinfo?.[0];
      if (!ii?.url) continue;
      out.push({ title: p.title ?? "", mime: ii.mime ?? "", w: ii.width ?? 0, h: ii.height ?? 0, thumb: ii.thumburl ?? ii.url, full: ii.url });
    }
    return out;
  } catch {
    return [];
  }
}

/** Pick the best photograph from a page's images: a JPEG that isn't a map/icon
 *  and isn't tiny, preferring the largest (the main subject photo, not a
 *  thumbnail or badge). Returns null when the article has no real photo. */
function bestPhoto(imgs: PageImage[]): WikiImage | null {
  const photos = imgs
    .filter((i) => i.mime === "image/jpeg" && Math.min(i.w, i.h) >= 80 && !NON_PHOTO_NAME.test(i.title.replace(/^File:/i, "")))
    .sort((a, b) => b.w * b.h - a.w * a.h);
  const p = photos[0];
  return p ? { thumb: p.thumb, full: p.full } : null;
}

/** Lead image(s) for a node (no prose), cached. Normally one request (the image
 *  rides along in the summary payload); when the lead image looks like a map,
 *  icon or line drawing rather than a photo, it makes one extra request to scan
 *  the article for a real photograph. Returns null when there's no usable image. */
export async function fetchWikiImage(node: TaxonNode): Promise<WikiImage | null> {
  const hit = imgCache.get(node.id);
  if (hit !== undefined) return hit;
  const summary = await fetchWikiSummary(node);
  let img: WikiImage | null = summary?.thumbnail
    ? { thumb: summary.thumbnail, full: summary.original ?? summary.thumbnail }
    : null;
  // Prefer an actual photo when the lead image is (or looks like) a map/drawing.
  if (summary?.title && (!img || looksNonPhoto(summary.original ?? summary.thumbnail))) {
    const better = bestPhoto(await fetchPageImages(summary.title));
    if (better) img = better;
  }
  imgCache.set(node.id, img);
  return img;
}

/** Fetch a short summary + thumbnail. Tries each candidate title in order and
 *  returns the first with a real extract, keeping a bare (extract-less) hit as a
 *  fallback. Returns null on total failure (offline, no article, disambiguation)
 *  so the UI can degrade gracefully. */
export async function fetchWikiSummary(node: TaxonNode): Promise<WikiSummary | null> {
  let fallback: WikiSummary | null = null;
  for (const title of candidateTitles(node)) {
    try {
      const res = await fetch(REST + encodeURIComponent(title.replace(/ /g, "_")), {
        headers: { accept: "application/json" },
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data.type === "disambiguation") continue;
      const summary: WikiSummary = {
        title: data.title ?? title,
        extract: data.extract ?? "",
        thumbnail: data.thumbnail?.source,
        original: data.originalimage?.source,
        pageUrl: data.content_urls?.desktop?.page ?? wikiUrlFor(node),
      };
      if (summary.extract) return summary; // a real article — done
      fallback ??= summary; // keep looking for one with prose
    } catch {
      /* network hiccup — try the next candidate */
    }
  }
  return fallback;
}
