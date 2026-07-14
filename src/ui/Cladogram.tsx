import { useEffect, useMemo, useRef, useState } from "react";
import type { DisplayTreeNode, GuessResult, TaxonNode, Tree } from "../core";
import { ancestryChain, inducedSubtree, isAncestor, leavesUnder } from "../core";
import { fetchWikiSummary, wikiUrlFor, type WikiSummary } from "../data/wikipedia";
import { warmthColor } from "./temperature";
import { treeLayout, radialLayout, CLADO_TREE, CLADO_RADIAL } from "./cladoLayout";

type CladoView = "tree" | "radial";

interface Props {
  tree: Tree;
  scopeRootId: string;
  results: GuessResult[];
  answerId: string;
  /** Clades revealed via hints (on the answer's lineage). */
  hintIds: string[];
  /** When true, the answer is named and its full lineage is drawn. */
  revealed: boolean;
}

const TARGET = "__target__";

type Kind = "clade" | "guess" | "answer" | "target" | "collapsed";

interface DNode {
  id: string;
  kind: Kind;
  children: DNode[];
  /** For a collapsed run: how many unnamed splits it stands in for. */
  count?: number;
  /** For a junction inside an expanded run: the run's id (click to re-collapse). */
  runId?: string;
}

interface PNode extends DNode {
  x: number;
  y: number;
  isLeaf: boolean;
  warmth?: number;
  isWin?: boolean;
}

export function Cladogram({ tree, scopeRootId, results, answerId, hintIds, revealed }: Props) {
  // Runs of unnamed splits the player has chosen to expand back into dots.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleRun = (id: string) =>
    setExpanded((cur) => {
      const next = new Set(cur);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const [mode, setMode] = useState<CladoView>("tree");
  const model = useMemo(
    () => buildModel(tree, scopeRootId, results, answerId, hintIds, revealed, expanded, mode),
    [tree, scopeRootId, results, answerId, hintIds, revealed, expanded, mode]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId && selectedId !== TARGET ? tree.byId.get(selectedId) ?? null : null;
  const stageRef = useRef<HTMLDivElement>(null);

  // Keep the hidden species (or, on reveal, the answer) centred in view so you
  // never have to scroll to find where the search has landed.
  const focal = model?.nodes.find((n) => n.kind === "target" || n.kind === "answer");
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !focal) return;
    stage.scrollTo({
      left: focal.x - stage.clientWidth / 2,
      top: focal.y - stage.clientHeight / 2,
      behavior: "smooth",
    });
  }, [focal?.x, focal?.y]);

  if (!model) return null;
  const { nodes, links, width, height, closestName } = model;

  return (
    <figure className="clado">
      <figcaption className="clado-cap">
        {revealed
          ? "The answer's place on the tree of life. Each guess sits where it splits away from the answer's branch."
          : closestName
          ? <>Closest shared branch so far: <b>{closestName}</b>. Every guess hangs where it splits from the hidden species.</>
          : "Each guess hangs at the clade it shares with the hidden species. Guess to grow the tree downward."}
      </figcaption>

      <div className="branches-viewtoggle" role="tablist" aria-label="Tree view">
        <button role="tab" aria-selected={mode === "tree"} className={`branches-viewseg${mode === "tree" ? " is-on" : ""}`} onClick={() => setMode("tree")}>Tree</button>
        <button role="tab" aria-selected={mode === "radial"} className={`branches-viewseg${mode === "radial" ? " is-on" : ""}`} onClick={() => setMode("radial")}>Radial</button>
      </div>

      <div className="clado-stage" ref={stageRef}>
        <div className="clado-canvas" style={{ width, height }}>
          <svg className="clado-links" width={width} height={height} aria-hidden="true">
            {links.map((l, i) => (
              <path key={i} d={l.d} className={`clado-link${l.strong ? " is-strong" : ""}`} style={{ stroke: l.color }} />
            ))}
          </svg>

          {nodes.map((p) => {
            if (p.kind === "target") {
              return (
                <div key={p.id} className="clado-pt is-target" style={{ left: p.x, top: p.y }}>
                  <span className="pt-mark">?</span>
                  <span className="pt-name">hidden species</span>
                </div>
              );
            }
            // A collapsed run of unnamed splits — one compact marker, click to expand.
            if (p.kind === "collapsed") {
              return (
                <button
                  key={p.id}
                  type="button"
                  className="clado-pt is-collapsed"
                  style={{ left: p.x, top: p.y }}
                  title={`${p.count} unnamed splits — click to expand`}
                  onClick={() => toggleRun(p.id)}
                >
                  <span className="pt-dot" />
                  <span className="pt-collapsed">⋯ {p.count} splits</span>
                </button>
              );
            }
            const t = tree.byId.get(p.id)!;
            // Unnamed phylogenetic junction — draw a bare dot, no label, no wiki.
            // If it belongs to an expanded run, clicking re-collapses that run.
            if (p.kind === "clade" && !t.sciName) {
              const cls = `clado-pt is-junction${p.id === model.closestId ? " is-closest" : ""}${p.runId ? " is-expanded" : ""}`;
              if (p.runId) {
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={cls}
                    style={{ left: p.x, top: p.y }}
                    title="Collapse these splits"
                    onClick={() => toggleRun(p.runId!)}
                  >
                    <span className="pt-dot" />
                  </button>
                );
              }
              return (
                <div key={p.id} className={cls} style={{ left: p.x, top: p.y }}>
                  <span className="pt-dot" />
                </div>
              );
            }
            const color =
              p.kind === "answer" ? "var(--vermilion)" : p.kind === "guess" ? warmthColor(p.warmth ?? 0, !!p.isWin) : undefined;
            const cls = [
              "clado-pt",
              p.kind === "clade" ? "is-clade" : p.kind === "answer" ? "is-answer" : "is-guess",
              p.id === model.closestId ? "is-closest" : "",
              selectedId === p.id ? "is-selected" : "",
            ].join(" ");
            // Species show common name over scientific name; clades show name over rank.
            const isSpecies = p.kind === "guess" || p.kind === "answer";
            const line1 = isSpecies ? t.common ?? t.sciName : t.sciName;
            const line2 = isSpecies ? (t.common ? t.sciName : t.rank) : t.rank;
            return (
              <button
                key={p.id}
                type="button"
                className={cls}
                style={{ left: p.x, top: p.y }}
                onClick={() => setSelectedId((cur) => (cur === p.id ? null : p.id))}
              >
                <span className="pt-dot" style={color ? { background: color, borderColor: color } : undefined} />
                <span className="pt-name" style={color ? { color } : undefined}>
                  {line1}
                  {isSpecies && (
                    <span className="pt-warm" style={color ? { color } : undefined}>
                      {p.kind === "answer" ? " · answer" : p.isWin ? " · found" : ` · ${Math.round((p.warmth ?? 0) * 100)}°`}
                    </span>
                  )}
                </span>
                <span className={`pt-rank${isSpecies && t.common ? " is-sci" : ""}`}>{line2}</span>
              </button>
            );
          })}
        </div>
      </div>

      <WikiPanel node={selected} tree={tree} onClose={() => setSelectedId(null)} />
    </figure>
  );
}

function WikiPanel({ node, tree, onClose }: { node: TaxonNode | null; tree: Tree; onClose: () => void }) {
  const [wiki, setWiki] = useState<WikiSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!node) return;
    let live = true;
    setLoading(true);
    setWiki(null);
    fetchWikiSummary(node).then((w) => {
      if (live) { setWiki(w); setLoading(false); }
    });
    return () => { live = false; };
  }, [node?.id]);

  if (!node) {
    return <p className="clado-hint">Tap any clade or guess above to read about it.</p>;
  }

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

interface Model {
  nodes: PNode[];
  links: { d: string; color: string; strong: boolean }[];
  width: number;
  height: number;
  closestId: string | null;
  closestName: string | null;
}

function buildModel(
  tree: Tree,
  scopeRootId: string,
  results: GuessResult[],
  answerId: string,
  hintIds: string[],
  revealed: boolean,
  expanded: Set<string>,
  mode: CladoView
): Model | null {
  if (results.length === 0 && hintIds.length === 0 && !revealed) return null;

  const byGuess = new Map(results.map((r) => [r.guess.id, r]));
  const depthOf = (id: string) => tree.depthOf.get(id) ?? 0;

  // Keep the guesses, the clades they each share with the answer, any hint-revealed
  // branches, and — on reveal — the answer plus its full lineage. inducedSubtree then
  // stitches in EVERY branch point among them, so we learn how the guesses relate to
  // each other (Amniotes, Tetrapods…) even when that says nothing about the answer.
  const keep = new Set<string>();
  keep.add(scopeRootId); // always anchor the drawing at the scope you're playing
  for (const r of results) {
    if (r.guess.id !== answerId) keep.add(r.guess.id);
    keep.add(r.mrca.id);
  }
  for (const h of hintIds) keep.add(h);
  if (revealed) {
    const chain = ancestryChain(tree, answerId).reverse();
    const start = chain.indexOf(scopeRootId);
    for (const id of chain.slice(start === -1 ? 0 : start)) keep.add(id);
  }

  // Annotate a named clade only when it's meaningful:
  //  • it's on the SHARED spine (the answer's own lineage — "you've narrowed to X"), or
  //  • it groups ≥2 guesses AND is the SHALLOWEST named clade to group that exact set
  //    (below where they split from the answer). So Buzzard+Eagle get labelled by
  //    their order; the redundant family only surfaces once a guess lands in the
  //    order but outside that family.
  const guessCount = new Map<string, number>();
  for (const r of results) {
    if (r.guess.id === answerId) continue;
    for (const anc of ancestryChain(tree, r.guess.id)) guessCount.set(anc, (guessCount.get(anc) ?? 0) + 1);
  }
  const onSpine = (id: string) => isAncestor(tree, id, answerId);
  // Guess-count of the nearest off-spine named ancestor (Infinity if none).
  const outerGroupCount = (id: string) => {
    for (let cur = tree.byId.get(id)?.parentId; cur; cur = tree.byId.get(cur)?.parentId ?? null) {
      if (tree.byId.get(cur)?.sciName && !onSpine(cur)) return guessCount.get(cur) ?? 0;
    }
    return Infinity;
  };
  const keepClade = (id: string) => {
    if (!tree.byId.get(id)?.sciName) return false;
    if (onSpine(id)) return true;
    const c = guessCount.get(id) ?? 0;
    // keep only if it groups ≥2 guesses and isn't redundant with a same-set outer clade
    return c >= 2 && outerGroupCount(id) > c;
  };
  const induced = inducedSubtree(tree, [...keep], keepClade);
  if (!induced) return null;

  // Squash redundant off-spine chains: if a kept named clade (Ecdysozoa) has a
  // single child that is itself the guesses' branch point (Pterygota, same guess
  // set), pull that split up so the group is labelled by the shallowest clade
  // (Ecdysozoa), not the deeper subclass. Never touch the answer's spine.
  const compress = (node: DisplayTreeNode): DisplayTreeNode => {
    node.children = node.children.map(compress);
    while (!onSpine(node.id) && node.children.length === 1 && node.children[0].children.length > 0) {
      node.children = node.children[0].children;
    }
    return node;
  };
  compress(induced);

  // Closest shared clade so far = deepest branch on the answer's lineage exposed by
  // a guess MRCA or a hint.
  let closestId: string | null = null;
  let closestDepth = -1;
  for (const id of [...results.map((r) => r.mrca.id), ...hintIds]) {
    const d = depthOf(id);
    if (d > closestDepth) { closestDepth = d; closestId = id; }
  }
  // The closest shared node may be a nameless junction — name the caption after
  // the nearest NAMED clade at or above it.
  let closestName: string | null = null;
  for (let id: string | null | undefined = closestId; id; id = tree.byId.get(id)?.parentId) {
    const n = tree.byId.get(id);
    if (n?.sciName) { closestName = n.common ?? n.sciName; break; }
  }

  // ---- assemble the display tree from the induced skeleton ----
  const kindOf = (id: string): Kind => {
    if (id === TARGET) return "target";
    if (id === answerId) return "answer";
    if (byGuess.has(id)) return "guess";
    return "clade";
  };
  const toDNode = (n: DisplayTreeNode): DNode => ({ id: n.id, kind: kindOf(n.id), children: n.children.map(toDNode) });
  const root = toDNode(induced);

  // While playing, hang the hidden species off the closest shared clade.
  if (!revealed && closestId) {
    const attach = (n: DNode): boolean => {
      if (n.id === closestId) { n.children.push({ id: TARGET, kind: "target", children: [] }); return true; }
      return n.children.some(attach);
    };
    attach(root);
  }

  // Collapse linear runs of ≥2 unnamed single-child junctions into one compact
  // marker — the deep stretches between named clades (e.g. order → genus) carry
  // no information, so hide the individual splits until the player expands them.
  // The closest shared branch (where the hidden species hangs) stays visible even
  // if it's nameless — never fold it into a run.
  const isJunction = (n: DNode) =>
    n.kind === "clade" && n.id !== closestId && !tree.byId.get(n.id)?.sciName;
  const collapse = (node: DNode): DNode => {
    const out: DNode[] = [];
    for (const child of node.children) {
      const run: DNode[] = [];
      let cur = child;
      while (isJunction(cur) && cur.children.length === 1) {
        run.push(cur);
        cur = cur.children[0];
      }
      const tail = collapse(cur); // recurse past the run
      if (run.length >= 2 && !expanded.has(run[0].id)) {
        out.push({ id: run[0].id, kind: "collapsed", count: run.length, children: [tail] });
      } else {
        // Keep the junctions (short run, or expanded): relink them above the tail,
        // tagging each with the run id so a click re-collapses the whole run.
        let acc = tail;
        for (let i = run.length - 1; i >= 0; i--) {
          run[i].children = [acc];
          if (run.length >= 2) run[i].runId = run[0].id;
          acc = run[i];
        }
        out.push(acc);
      }
    }
    node.children = out;
    return node;
  };
  collapse(root);

  // Branch colour + weight, keyed on the CHILD node's role (shared by both views).
  const linkColor = (kind: Kind, cr?: GuessResult) =>
    kind === "answer" ? "var(--vermilion)" : kind === "target" ? "var(--ink-faint)"
    : cr ? warmthColor(cr.warmth, cr.isWin) : "var(--clado-line)";

  // ---- lay the collapsed tree out via the shared engine, then colour it here ----
  // Radial rotates the hidden species (or, on reveal, the answer) to the bottom.
  const dById = new Map<string, DNode>();
  (function index(n: DNode) { dById.set(n.id, n); n.children.forEach(index); })(root);
  const geo =
    mode === "radial"
      ? radialLayout(root, { ...CLADO_RADIAL, focusId: revealed ? answerId : dById.has(TARGET) ? TARGET : null })
      : treeLayout(root, CLADO_TREE);

  const nodes: PNode[] = geo.nodes.map((gn) => {
    const d = dById.get(gn.id)!;
    const r = byGuess.get(gn.id);
    return { ...d, x: gn.x, y: gn.y, isLeaf: gn.isLeaf, warmth: r?.warmth, isWin: r?.isWin };
  });
  const links: Model["links"] = geo.links.map((l) => {
    const c = dById.get(l.childId)!;
    return { d: l.d, color: linkColor(c.kind, byGuess.get(c.id)), strong: c.kind === "guess" || c.kind === "answer" };
  });

  return { nodes, links, width: geo.width, height: geo.height, closestId, closestName };
}
