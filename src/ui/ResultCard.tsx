import { useEffect, useState } from "react";
import type { TaxonNode, Tree } from "../core";
import { ancestryChain } from "../core";
import { fetchWikiImage, fetchWikiSummary, wikiUrlFor, type WikiImage, type WikiSummary } from "../data/wikipedia";
import { ZoomableShot } from "./PhotoZoom";

interface Props {
  tree: Tree;
  answer: TaxonNode;
}

/** Lineage's answer, written up: name, binomial, ancestry and the Wikipedia summary. How the
 *  round went is not here; it follows in the ResultBlock every game ends with. */
export function ResultCard({ tree, answer }: Props) {
  const [wiki, setWiki] = useState<WikiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  // A second, better source for the picture: the summary's own thumbnail is
  // whatever sits at the top of the article, which for a taxon is often a range
  // map or a status icon. fetchWikiImage screens those out (and is cached, so on
  // a daily the reveal above has usually already paid for this call). The summary
  // thumbnail stays as the fallback for anything it rejects outright.
  const [img, setImg] = useState<WikiImage | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setImg(null);
    fetchWikiSummary(answer).then((w) => {
      if (live) { setWiki(w); setLoading(false); }
    });
    fetchWikiImage(answer).then((i) => { if (live) setImg(i); });
    return () => { live = false; };
  }, [answer.id]);

  // Lineage as a breadcrumb, root-first, for a little teachable moment.
  const lineage = ancestryChain(tree, answer.id)
    .reverse()
    .map((id) => tree.byId.get(id)!)
    // Unnamed clades carry an empty name; joining them printed runs of bare "› › ›".
    .map((n) => n.common || n.sciName)
    .filter(Boolean)
    .join(" › ");

  return (
    <div className="result">
      <h2>{answer.common ?? answer.sciName}</h2>
      <div className="sci" style={{ fontStyle: "italic" }}>{answer.sciName}</div>
      <div className="branch" style={{ marginTop: 10 }}>{lineage}</div>

      <div className="wikirow">
        {(img?.thumb || wiki?.thumbnail) && (
          <ZoomableShot
            src={img?.thumb ?? wiki!.thumbnail!}
            // The enlarged view wants the biggest file available: `full` is the
            // original, and the summary's own original is the fallback. Without
            // it, enlarging a picture that came from the summary would show the
            // 320px thumbnail at 320px, which is not an enlargement.
            full={img?.full ?? wiki?.original}
            // Lets the overlay credit the photographer; a Wikimedia attribution costs a
            // request, so it is only made once the picture is opened.
            image={img}
            caption={answer.common ?? answer.sciName}
          />
        )}
        <div>
          <p className="extract">
            {loading ? "Fetching field notes…" : wiki?.extract || "No Wikipedia summary found for this one. 🧐"}
          </p>
          <a href={wiki?.pageUrl ?? wikiUrlFor(answer)} target="_blank" rel="noreferrer">
            Read on Wikipedia →
          </a>
        </div>
      </div>
    </div>
  );
}
