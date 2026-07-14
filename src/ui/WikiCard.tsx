import { useEffect, useState } from "react";
import type { TaxonNode, Tree } from "../core";
import { leavesUnder } from "../core";
import { fetchWikiSummary, wikiUrlFor, type WikiSummary } from "../data/wikipedia";

/** A small Wikipedia reader, opened by tapping a species or a clade. Shared by
 *  the games so the field-notes card looks and behaves the same everywhere. */
export function WikiCard({ node, tree, onClose }: { node: TaxonNode; tree: Tree; onClose: () => void }) {
  const [wiki, setWiki] = useState<WikiSummary | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setWiki(null);
    fetchWikiSummary(node).then((w) => { if (live) { setWiki(w); setLoading(false); } });
    return () => { live = false; };
  }, [node.id]);
  const isLeaf = (tree.childrenOf.get(node.id) ?? []).length === 0;
  const sub = isLeaf ? "species" : `${leavesUnder(tree, node.id).length} species below`;
  return (
    <div className="clado-wiki">
      <button className="clado-wiki-close" onClick={onClose} aria-label="Close">×</button>
      {wiki?.thumbnail && <img src={wiki.thumbnail} alt={node.common ?? node.sciName} />}
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
