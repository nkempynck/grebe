import { useEffect, useState } from "react";
import type { TaxonNode, Tree } from "../core";
import { ancestryChain } from "../core";
import { fetchWikiSummary, wikiUrlFor, type WikiSummary } from "../data/wikipedia";

interface Props {
  tree: Tree;
  answer: TaxonNode;
  won: boolean;
  guessCount: number;
  /** Current daily streak, to celebrate on a daily win (null hides it). */
  streak?: number | null;
  /** Informed-solver par (guesses) for this puzzle, to benchmark against. */
  par?: number | null;
}

export function ResultCard({ tree, answer, won, guessCount, streak, par }: Props) {
  const [wiki, setWiki] = useState<WikiSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchWikiSummary(answer).then((w) => {
      if (live) { setWiki(w); setLoading(false); }
    });
    return () => { live = false; };
  }, [answer.id]);

  // Lineage as a breadcrumb, root-first, for a little teachable moment.
  const lineage = ancestryChain(tree, answer.id)
    .reverse()
    .map((id) => tree.byId.get(id)!)
    .map((n) => n.common ?? n.sciName)
    .join(" › ");

  return (
    <div className="result">
      <div className="verdict">
        {won ? `Solved in ${guessCount} ${guessCount === 1 ? "guess" : "guesses"}` : "Revealed"}
        {won && streak != null && streak > 0 && (
          <span className="verdict-streak">🔥 {streak}-day streak</span>
        )}
      </div>
      {par != null && (
        <div className="par">
          🤖 Solver's par: {par}
          {won && guessCount <= par && (
            <span className="par-beat">
              {guessCount < par ? " · you beat it!" : " · you matched it"}
            </span>
          )}
        </div>
      )}
      <h2>{answer.common ?? answer.sciName}</h2>
      <div className="sci" style={{ fontStyle: "italic" }}>{answer.sciName}</div>
      <div className="branch" style={{ marginTop: 10 }}>{lineage}</div>

      <div className="wikirow">
        {wiki?.thumbnail && <img src={wiki.thumbnail} alt={answer.common ?? answer.sciName} />}
        <div>
          <p className="extract">
            {loading ? "Fetching field notes…" : wiki?.extract || "No Wikipedia summary found for this one."}
          </p>
          <a href={wiki?.pageUrl ?? wikiUrlFor(answer)} target="_blank" rel="noreferrer">
            Read on Wikipedia →
          </a>
        </div>
      </div>
    </div>
  );
}
