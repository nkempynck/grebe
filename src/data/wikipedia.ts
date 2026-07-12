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
