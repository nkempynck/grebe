import { useEffect, useState } from "react";
import type { TaxonNode, Tree } from "../core";
import { leavesUnder } from "../core";
import { fetchWikiImage, fetchWikiSummary, wikiUrlFor, type WikiImage, type WikiSummary } from "../data/wikipedia";

/** A small Wikipedia reader, opened by tapping a species or a clade. Shared by
 *  the games so the field-notes card looks and behaves the same everywhere.
 *  `hideImage` drops the lead photo (used for clade nodes in Branches, where a
 *  clade's representative photo can be the very picture of a species you must
 *  still place, giving the answer away — species keep their own photo). */
export function WikiCard({ node, tree, onClose, hideImage }: { node: TaxonNode; tree: Tree; onClose: () => void; hideImage?: boolean }) {
  const [wiki, setWiki] = useState<WikiSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [img, setImg] = useState<WikiImage | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setWiki(null);
    fetchWikiSummary(node).then((w) => { if (live) { setWiki(w); setLoading(false); } });
    return () => { live = false; };
  }, [node.id]);
  // The card's picture goes through fetchWikiImage (cached, shared with the tiles)
  // so it gets a real photo when the lead image is a map/drawing. Skipped for
  // clades, whose image is hidden anyway.
  useEffect(() => {
    if (hideImage) { setImg(null); return; }
    let live = true;
    setImg(null);
    fetchWikiImage(node).then((i) => { if (live) setImg(i); });
    return () => { live = false; };
  }, [node.id, hideImage]);
  const isLeaf = (tree.childrenOf.get(node.id) ?? []).length === 0;
  const sub = isLeaf ? "species" : `${leavesUnder(tree, node.id).length} species below`;
  return (
    <div className="clado-wiki">
      <button className="clado-wiki-close" onClick={onClose} aria-label="Close">×</button>
      {!hideImage && img?.thumb && <img src={img.thumb} alt={node.common ?? node.sciName} />}
      <div className="clado-wiki-body">
        <div className="clado-wiki-rank">{node.rank} · {sub}</div>
        <h3>{node.common ?? node.sciName}</h3>
        {node.common && <div className="clado-wiki-sci">{node.sciName}</div>}
        <p>{loading ? "Fetching field notes…" : wiki?.extract || "No Wikipedia summary found."}</p>
        <a href={wiki?.pageUrl ?? wikiUrlFor(node)} target="_blank" rel="noreferrer">Read on Wikipedia →</a>
      </div>
    </div>
  );
}
