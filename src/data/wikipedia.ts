import type { TaxonNode } from "../core/types";

// Wikipedia's REST summary endpoint is CORS-enabled, so it works straight from
// the browser with no proxy. If you later hit rate limits, add a small backend
// cache — but the shape below (title -> summary) is all the app depends on.

const REST = "https://en.wikipedia.org/api/rest_v1/page/summary/";

export interface WikiSummary {
  title: string;
  extract: string;
  thumbnail?: string;
  pageUrl: string;
}

/** The best Wikipedia title to use for a node. */
export function wikiTitleFor(node: TaxonNode): string {
  return node.wikiTitle ?? node.common ?? node.sciName;
}

/** Public article URL (works even if the summary fetch fails). */
export function wikiUrlFor(node: TaxonNode): string {
  return "https://en.wikipedia.org/wiki/" + encodeURIComponent(wikiTitleFor(node).replace(/ /g, "_"));
}

/** Fetch a short summary + thumbnail. Returns null on any failure (offline,
 *  missing article, disambiguation) so the UI can degrade gracefully. */
export async function fetchWikiSummary(node: TaxonNode): Promise<WikiSummary | null> {
  const title = wikiTitleFor(node);
  try {
    const res = await fetch(REST + encodeURIComponent(title.replace(/ /g, "_")), {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.type === "disambiguation") return null;
    return {
      title: data.title ?? title,
      extract: data.extract ?? "",
      thumbnail: data.thumbnail?.source,
      pageUrl: data.content_urls?.desktop?.page ?? wikiUrlFor(node),
    };
  } catch {
    return null;
  }
}
