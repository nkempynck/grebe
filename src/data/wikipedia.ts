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

// A page's lead image is often not a photo of the organism: range/distribution maps,
// IUCN-status icons, size-comparison charts and old line-drawing plates all commonly sit
// at the top of a taxon infobox. Two cheap signals separate those from a usable image:
//   1. File type — SVG is a vector diagram, cladogram or range map, never a subject
//      image. We test the ORIGINAL file's extension, not the thumb's, since Wikipedia
//      renders SVGs to a *.svg.png thumbnail. GIF is deliberately NOT rejected: it is a
//      RASTER format, and every GIF in our set is a real subject image (Tubifex, Capelin,
//      Black marlin, Hobo spider, and the scanned microscope plate that is the only
//      picture Wikipedia has of the balsam woolly adelgid). Lumping it in with SVG cost
//      19 species their photo and handed one of them a picture of a dead forest instead.
//   2. Filename — maps, icons and charts carry tell-tale WORDS, matched as words and
//      never as substrings. The old substring rule fired on "range" inside "Orange_Walk",
//      "_area" inside "head_area", and "status " inside every Latin epithet ending
//      -cristatus/-cristata, discarding 50 good photos including Turkey vulture, Marine
//      iguana, Great crested grebe, Wheel Bug, Dunlin and Yuzu.
// PNG is NOT rejected on type alone: many legitimate species lead images are PNGs
// (colour illustrations, or photos re-saved as PNG). Rejecting every PNG made us throw
// away a correct fish plate (Sebastes alutus) and grab the biggest JPEG on the page
// instead — which was a food-dish photo (a "…perch sandwich"). A PNG range map still
// gets caught by its filename (signal 2).
// Neither signal is perfect (a colour-plate illustration saved as JPEG still slips
// through), but together they catch the common cases.

/** Words marking a diagram, map, icon or chart wherever they appear in the filename. */
const NON_PHOTO_WORDS = new Set([
  "range", "distribution", "locator", "iucn", "status", "wikispecies", "disambig",
  "icon", "logo", "ambox", "silhouette", "cladogram", "phylogeny", "phylogenetic",
  "diagram", "chart", "graph",
]);
/** …and words that only mark one when they END the name, which is where a map file puts
 *  them ("Dendrolagus_mayri_map.png"). "map" cannot be a general marker, because the
 *  northern map turtle is a real animal with a real photo called "Northern_Map_Turtle". */
const NON_PHOTO_TAIL = new Set(["map", "maps", "area", "range", "distribution", "size"]);
/** Cooked food. Any article about an edible organism carries dish photos, and since
 *  bestPhoto takes the LARGEST jpeg on the page it will happily serve a cafeteria tray of
 *  fish and rice as the picture of a blue grenadier. Nothing here belongs on a tile in a
 *  game about living things. "plate" is excluded on purpose: it means a colour plate in
 *  an illustrated monograph far more often than it means dinnerware. */
const FOOD_WORDS = new Set([
  "meal", "meals", "dish", "dishes", "cooked", "cooking", "fried", "grilled", "roasted",
  "boiled", "baked", "smoked", "fillet", "fillets", "filet", "filets", "steak", "sushi",
  "sashimi", "soup", "stew", "salad", "sandwich", "recipe", "cuisine", "restaurant",
  "dinner", "lunch", "canned", "tinned",
]);

/** Filename words, lowercased, extension dropped. "Turkey_vulture_(Cathartes_aura).jpg"
 *  → ["turkey","vulture","cathartes","aura"]. */
function fileWords(url: string): string[] {
  const path = decodeURIComponent(url.split("?")[0]);
  const file = (path.split("/").pop() ?? path).replace(/\.[a-z0-9]+$/i, "");
  return file.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** True when a file URL/name looks like a map, diagram, icon, chart or plate of food
 *  rather than a photograph of the organism. Pass the ORIGINAL file URL (or a File:
 *  title). */
function looksNonPhoto(url: string | undefined): boolean {
  if (!url) return true;
  if (/\.svg$/i.test(decodeURIComponent(url.split("?")[0]))) return true;
  const words = fileWords(url);
  if (words.some((w) => NON_PHOTO_WORDS.has(w) || FOOD_WORDS.has(w))) return true;
  return words.length > 0 && NON_PHOTO_TAIL.has(words[words.length - 1]);
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
    .filter((i) => i.mime === "image/jpeg" && Math.min(i.w, i.h) >= 80 && !looksNonPhoto(i.title))
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

export interface WikiCredit {
  artist: string | null;
  licence: string | null;
  /** The file's description page, where the full licence terms live. */
  filePage: string | null;
}

/** The File: name behind an upload.wikimedia.org URL.
 *
 *  A thumbnail keeps the original name one segment up
 *  (…/commons/thumb/a/ab/Foo.jpg/320px-Foo.jpg), so the last segment is the wrong one to take:
 *  "320px-Foo.jpg" is not a page on any wiki. */
function fileTitleFrom(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const name = parts.includes("thumb") ? parts[parts.length - 2] : parts[parts.length - 1];
    return name ? decodeURIComponent(name) : null;
  } catch {
    return null;
  }
}

/** extmetadata values arrive as HTML ("<a href=…>Charles J. Sharp</a>"). Tags are stripped
 *  first and the entities decoded second, in a textarea: with the angle brackets already gone
 *  nothing from the wiki can be parsed as markup, so no <img onerror> rides in on a credit. */
function stripHtml(html: string | undefined): string | null {
  if (!html) return null;
  const el = document.createElement("textarea");
  el.innerHTML = html.replace(/<[^>]*>/g, " ");
  const text = el.value.replace(/\s+/g, " ").trim();
  return text || null;
}

export interface WikiShot {
  /** What to display: the file rendered at roughly the width asked for. */
  src: string;
  /** The original upload, as the fallback if `src` will not load. */
  full: string;
  credit: WikiCredit | null;
}

const shotCache = new Map<string, WikiShot>();

/** A file at a workable size, with its attribution, in one request.
 *
 *  THE WIDTH HAS TO BE ASKED FOR, not constructed. Wikimedia serves thumbnails only at widths
 *  it has already rendered, and refuses an arbitrary one from an outside request with a 400 —
 *  rewriting a "330px-" URL to "1024px-" yields an error page, not a picture. iiurlwidth asks
 *  the wiki instead, which snaps to the nearest bucket it has (1024 came back as 1280) and
 *  hands over a URL that loads. The original is not an answer either: a featured animal photo
 *  is regularly five megabytes, downloaded whole for a board that opens as four hundred
 *  scrambled squares.
 *
 *  The credit rides along because it costs nothing extra here. Fetching it separately on the
 *  reveal would be a second round trip for a line that was already one field away.
 *
 *  Asked of en.wikipedia rather than Commons on purpose: a local query resolves files on the
 *  shared repo too, so one request covers both homes instead of a miss and a retry. */
export async function fetchWikiShot(img: WikiImage, width: number): Promise<WikiShot> {
  const bare: WikiShot = { src: img.full, full: img.full, credit: null };
  const title = fileTitleFrom(img.full);
  if (!title) return bare;
  const key = `${title} ${width}`;
  const hit = shotCache.get(key);
  if (hit) return hit;
  const params = new URLSearchParams({
    action: "query", format: "json", origin: "*",
    titles: `File:${title}`, prop: "imageinfo",
    iiprop: "url|extmetadata", iiurlwidth: String(width),
    iiextmetadatafilter: "Artist|LicenseShortName",
  });
  let out = bare;
  try {
    const res = await fetch("https://en.wikipedia.org/w/api.php?" + params, { headers: { accept: "application/json" } });
    if (res.ok) {
      const data = await res.json();
      const pages: Record<string, { imageinfo?: Array<{ url?: string; thumburl?: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }> }> =
        data?.query?.pages ?? {};
      const ii = Object.values(pages)[0]?.imageinfo?.[0];
      if (ii) {
        out = {
          src: ii.thumburl ?? ii.url ?? img.full,
          full: ii.url ?? img.full,
          credit: {
            artist: stripHtml(ii.extmetadata?.Artist?.value),
            licence: stripHtml(ii.extmetadata?.LicenseShortName?.value),
            filePage: ii.descriptionurl ?? null,
          },
        };
      }
    }
  } catch {
    /* offline — the original at full size, and no credit line rather than a wrong one */
  }
  shotCache.set(key, out);
  return out;
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
