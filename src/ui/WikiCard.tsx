import { useEffect, useState } from "react";
import type { TaxonNode, Tree } from "../core";
import { isFullyRedacted, leavesUnder, redactSpoilers, type Spoiler } from "../core";
import { fetchWikiImage, fetchWikiSummary, wikiUrlFor, type WikiImage, type WikiSummary } from "../data/wikipedia";

/** A small Wikipedia reader, opened by tapping a species or a clade. Shared by
 *  the games so the field-notes card looks and behaves the same everywhere.
 *  `hideImage` drops the lead photo (used for clade nodes in Branches, where a
 *  clade's representative photo can be the very picture of a species you must
 *  still place, giving the answer away — species keep their own photo).
 *  `redact` blanks names out of the prose for the same reason: a clade summary
 *  listing its members can otherwise spell out a Branches tray. `latinTitle` keeps
 *  the header in step with the label on the board, which drops a clade's common
 *  name when it shares a word with a species still to place.
 *
 *  Everything above only guards the card. The link out to Wikipedia leads to the
 *  unedited article, where nothing is blanked, so a game that charges for that
 *  passes `onFollowLink`: the link becomes a button and the host decides what to do
 *  with the url (confirm, charge, then open). Left off — Lineage, Kinship, a
 *  finished board — it stays an ordinary link. */
export function WikiCard({ node, tree, onClose, hideImage, redact, latinTitle, onFollowLink, linkNote }: { node: TaxonNode; tree: Tree; onClose: () => void; hideImage?: boolean; redact?: Spoiler[]; latinTitle?: boolean; onFollowLink?: (url: string) => void; linkNote?: string }) {
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
  // Hidden names are replaced by a fixed-width block, never by the text itself:
  // the word stays out of the DOM, and a constant width keeps the name's length
  // from being a clue.
  const url = wiki?.pageUrl ?? wikiUrlFor(node);
  const segments = redactSpoilers(wiki?.extract ?? "", redact ?? []);
  const prose = isFullyRedacted(segments)
    ? "Summary hidden: it names species you still have to place."
    : segments.map((s, i) =>
        s.hidden
          ? <span key={i} className="clado-redact" title="A species you still have to place" aria-label="name hidden" />
          : <span key={i}>{s.text}</span>
      );
  return (
    <div className="clado-wiki">
      <button className="clado-wiki-close" onClick={onClose} aria-label="Close">×</button>
      {!hideImage && img?.thumb && <img src={img.thumb} alt={node.common ?? node.sciName} />}
      <div className="clado-wiki-body">
        <div className="clado-wiki-rank">{node.rank} · {sub}</div>
        <h3>{latinTitle ? node.sciName ?? node.common : node.common ?? node.sciName}</h3>
        {node.common && !latinTitle && <div className="clado-wiki-sci">{node.sciName}</div>}
        <p>{loading ? "Fetching field notes…" : wiki?.extract ? prose : "No Wikipedia summary found."}</p>
        {onFollowLink ? (
          <button type="button" className="clado-wiki-more" onClick={() => onFollowLink(url)}>
            Read on Wikipedia →{linkNote && <span className="clado-wiki-cost"> {linkNote}</span>}
          </button>
        ) : (
          <a href={url} target="_blank" rel="noreferrer">Read on Wikipedia →</a>
        )}
      </div>
    </div>
  );
}
