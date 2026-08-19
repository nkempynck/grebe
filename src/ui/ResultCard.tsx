import { useEffect, useState } from "react";
import type { TaxonNode, Tree } from "../core";
import { ancestryChain } from "../core";
import { fetchWikiImage, fetchWikiSummary, wikiUrlFor, type WikiImage, type WikiSummary } from "../data/wikipedia";
import { ZoomableShot } from "./PhotoZoom";

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
    .map((n) => n.common ?? n.sciName)
    .join(" › ");

  return (
    <div className="result">
      <div className="verdict">
        {won
          ? guessCount === 1
            ? "One guess ace is quite crazy. Too crazy one might think…"
            : `Solved in ${guessCount} guesses. You're doing great. `
          : "Revealed 😵‍💫 Next time maybe."}
        {/* Only a win carries a streak: giving up ends the run, whatever it cost
            to get there (see deriveStreaks in src/data/stats.ts). */}
        {won && streak != null && streak > 0 && (
          <span className="verdict-streak">🔥 {streak}-day streak</span>
        )}
      </div>
      {par != null && (
        <div className="par">
          🤖 Solver's par: {par}
          {won && guessCount <= par && (
            <span className="par-beat">
              {guessCount < par ? " · you beat it! 😎" : " · you matched it 🦭"}
            </span>
          )}
        </div>
      )}
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
