import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DisplayTreeNode, Tree } from "../core";
import { inducedSubtree, dailyNumber } from "../core";
import { resolveDailyRules } from "../data/dailySchedule";
import { GameHeader } from "./GameHeader";
import { useBranchesGame, type BranchesComplete } from "../hooks/useBranchesGame";
import { branchesPoints } from "../data/score";
import { fetchWikiImage, type WikiImage } from "../data/wikipedia";
import { treeLayout, radialLayout, CLADO_TREE, CLADO_RADIAL, type GraphLayout } from "./cladoLayout";
import { WikiCard } from "./WikiCard";
import { Leaderboard } from "./Leaderboard";
import { LeaderboardNudge } from "./LeaderboardNudge";
import { gameUrl } from "./share";
import { PlaytestBar } from "./PlaytestBar";
import { useDev } from "../data/devMode";

interface Props {
  tree: Tree;
  /** Fired once when a board is submitted — App records the result. */
  onComplete?: (r: BranchesComplete) => void;
  /** Opens the Branches section of the About page. */
  onHowItWorks?: () => void;
  /** Leaderboard name to highlight (null when signed out). */
  me?: string | null;
  /** True when a backend is configured — gates the post-game board. */
  configured?: boolean;
  /** Bump to refetch the post-game board after the result is submitted. */
  reloadKey?: number;
  /** The viewer's current Branches streak, shown in the board footer. */
  streak?: number | null;
  /** Renders inside the Admin test bench: difficulty/reshuffle/autosolve controls,
   *  no daily lock, nothing recorded. Off for the normal site. */
  sandbox?: boolean;
}

const nameOf = (tree: Tree, id: string) =>
  tree.byId.get(id)?.common ?? tree.byId.get(id)?.sciName ?? id;
const sciOf = (tree: Tree, id: string) => tree.byId.get(id)?.sciName ?? "";

export type BranchesView = "tree" | "radial";

// How far a tip's interactive tile floats out past its branch end in radial mode.
const TIP_OUT = 22;

/** Lay the skeleton out with the SAME engine + spacing Lineage uses, so the two
 *  games look identical; Branches then renders its own interactive leaf tiles.
 *  The tiles are wide boxes, so Branches needs more margin than Lineage's text
 *  labels: extra side padding for edge tiles and bottom room for those hanging
 *  below the deepest tip. Column/tier gaps stay identical, so the trees match. */

function branchesLayout(root: DisplayTreeNode, radial: boolean): GraphLayout {
  // Radial: labels radiate outward (see the render's `flip`), and the canvas is sized to
  // the real footprints — a leaf tile (up to ~148px wide) around its tip, and a clade label
  // (150px) extending outward — so nothing clips at the rim. Branches carries wider boxes
  // than Lineage's bare text, so it uses a bigger RADIUS (innerRadius) and enough angular
  // gap (gapx) that leaf tiles don't touch, without inflating the depth spacing into a
  // sprawl. Residual overlaps (a label over its own child's tile) are cleared after render
  // by sliding tiles outward — see the nudge effect. `pad` leaves room for that slide.
  if (radial) return radialLayout(root, {
    ...CLADO_RADIAL, ring: 88, innerRadius: 100, spanMax: 2.6, gapx: 160,
    pad: 44, rim: 74, focusId: null,
    tipOut: TIP_OUT, leafBox: { halfW: 78, halfH: 28 }, labelW: 150, labelHalfH: 14,
  });
  const L = treeLayout(root, { ...CLADO_TREE, padx: 92 });
  return { ...L, height: L.height + 56 };
}

/** Load Wikipedia lead images for the species-to-place (cached across renders). */
function useSpeciesImages(tree: Tree, ids: string[]): Record<string, WikiImage> {
  const key = ids.join(",");
  const [imgs, setImgs] = useState<Record<string, WikiImage>>({});
  useEffect(() => {
    let live = true;
    for (const id of ids) {
      const node = tree.byId.get(id);
      if (!node) continue;
      fetchWikiImage(node).then((img) => {
        if (live && img) setImgs((m) => (m[id] ? m : { ...m, [id]: img }));
      });
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, key]);
  return imgs;
}

interface DragData {
  from: "tray" | "slot";
  speciesId: string;
  slotId?: string;
}
const readDrag = (e: React.DragEvent): DragData | null => {
  try {
    return JSON.parse(e.dataTransfer.getData("text/plain")) as DragData;
  } catch {
    return null;
  }
};

export function BranchesGame({ tree, onComplete, onHowItWorks, me, configured, reloadKey, streak, sandbox }: Props) {
  const devSettings = useDev();
  const dev = sandbox ? { tier: devSettings.tier, nonce: devSettings.nonce } : null;
  const g = useBranchesGame(tree, onComplete, dev);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [trayOver, setTrayOver] = useState(false);
  const [wikiId, setWikiId] = useState<string | null>(null);
  const [pendingPeek, setPendingPeek] = useState<string | null>(null);
  const [mode, setMode] = useState<BranchesView>("radial");
  const [copied, setCopied] = useState(false);

  const skeleton = useMemo<DisplayTreeNode | null>(() => {
    if (!g.board) return null;
    const groups = new Set(g.board.groupIds);
    return inducedSubtree(tree, g.board.leafIds, (id) => groups.has(id));
  }, [tree, g.board]);
  const radial = mode === "radial";
  const layout = useMemo(
    () => (skeleton ? branchesLayout(skeleton, radial) : null),
    [skeleton, radial]
  );
  const trayImgs = useSpeciesImages(tree, g.board?.tray ?? []);
  const [zoomId, setZoomId] = useState<string | null>(null);

  // Radial overlap cleanup: after render, slide any leaf tile that overlaps a clade label
  // (or an earlier tile) outward along its own branch until it's clear. Tiles carry no
  // branch-anchored dot, so moving them along the ray reads naturally; labels stay put.
  const canvasRef = useRef<HTMLDivElement>(null);
  const tileEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const nodeById = useMemo(() => new Map((layout?.nodes ?? []).map((n) => [n.id, n])), [layout]);
  const placementSig = Object.entries(g.placements).sort().join("|");
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layout) return;
    for (const el of tileEls.current.values()) el.style.transform = ""; // clear prior nudges (also on leaving radial)
    if (!radial) return; // tree mode stacks cleanly; nothing to nudge
    const c = canvas.getBoundingClientRect();
    const GAP = 5; // min clear space between boxes
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.left - c.left - GAP, y: r.top - c.top - GAP, w: r.width + 2 * GAP, h: r.height + 2 * GAP };
    };
    type R = { x: number; y: number; w: number; h: number };
    const hit = (a: R, b: R) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const obstacles: R[] = [...canvas.querySelectorAll(".clado-pt")].map(rect);
    const STEP = 8, MAX = 40;
    for (const id of [...tileEls.current.keys()].sort()) {
      const el = tileEls.current.get(id)!;
      const node = nodeById.get(id);
      if (!node) continue;
      const ox = node.ox ?? 0, oy = node.oy ?? 0;
      let r = rect(el), delta = 0;
      while (delta < MAX && obstacles.some((o) => hit(r, o))) {
        delta += STEP;
        r = { x: r.x + ox * STEP, y: r.y + oy * STEP, w: r.w, h: r.h };
      }
      if (delta > 0) el.style.transform = `translate(calc(-50% + ${(ox * delta).toFixed(1)}px), calc(-50% + ${(oy * delta).toFixed(1)}px))`;
      obstacles.push(r); // this tile is now an obstacle for the ones after it
    }
  }, [layout, radial, nodeById, g.status, g.tier, placementSig]);

  if (!g.board || !layout) return <p className="empty">No Branches puzzle available today.</p>;

  const board = g.board;
  const anchors = new Set(board.anchorIds);
  const groupSet = new Set(board.groupIds);
  const over = g.status === "done";
  const rules = resolveDailyRules(g.date);
  // Annotate the shared common ancestor (the skeleton's root). If that node is a
  // bare junction, walk up to the nearest named clade — a labelled ancestor reads
  // cleaner than an unnamed shared dot.
  const rootId = skeleton?.id ?? null;
  const namedAncestorOf = (id: string): string | null => {
    for (let cur: string | null = id; cur; cur = tree.byId.get(cur)?.parentId ?? null) {
      if (tree.byId.get(cur)?.sciName) return cur;
    }
    return null;
  };
  const rootAnnoId = rootId ? namedAncestorOf(rootId) : null;
  // From Thursday on (tier ≥ 4) clade LABELS show the scientific name only. A common clade
  // name ("Old World sparrows") shares a word with its answer tile ("House Sparrow") and
  // hands the placement over; the Latin ("Passeridae") doesn't — the harder-half analogue
  // of Kinship hiding names midweek. (Species tiles keep their common names via nameOf.)
  const CLADE_LATIN_MIN_TIER = 4;
  const cladeLatinOnly = g.tier >= CLADE_LATIN_MIN_TIER && !over; // reveal common names once solved
  const cladeLabel = (id: string) => {
    const n = tree.byId.get(id);
    return (cladeLatinOnly ? n?.sciName ?? n?.common : n?.common ?? n?.sciName) ?? id;
  };
  // Brutal weekend (Sat/Sun, tier ≥ 6): also hide the rank subtitle ("GENUS"/"FAMILY").
  // Knowing a group's rank narrows placement, so the final escalation removes it — you
  // still have the Latin name, the tree shape and the pictures. Shown again once solved.
  const HIDE_RANK_MIN_TIER = 6;
  const hideRank = g.tier >= HIDE_RANK_MIN_TIER && !over;
  const points = g.result ? branchesPoints(g.tier, g.result.correct, g.result.total, g.result.hinted + 0.5 * g.result.peeked) : 0;
  // Shareable result grid: one square per slot in board order. The answer species
  // are never encoded — only whether each was placed right, and with what help —
  // so the grid is safe to post. Clean correct 🟩, hint-revealed 🟨, peeked 🟦,
  // wrong ⬛.
  const won = !!g.result && g.result.correct === g.result.total;
  const shareSquare = (s: string) =>
    g.placements[s] !== s ? "⬛" : g.hints.includes(s) ? "🟨" : g.peeked.includes(s) ? "🟦" : "🟩";
  const shareText = (() => {
    const head = `🌿 Grebe Branches · №${dailyNumber(g.date)}${rules.difficulty ? ` · ${rules.difficulty}` : ""}`;
    const grid = board.slotIds.map(shareSquare).join("");
    const help = [
      g.result?.hinted ? `${g.result.hinted} hint${g.result.hinted > 1 ? "s" : ""}` : "",
      g.result?.peeked ? `${g.result.peeked} peek${g.result.peeked > 1 ? "s" : ""}` : "",
    ].filter(Boolean).join(", ");
    const streakLine = won && streak != null && streak > 0 ? ` · 🔥${streak}` : "";
    const verdict = `${won ? "Solved" : "Missed it"} · ${g.result?.correct}/${g.result?.total} placed${help ? ` · ${help}` : ""} · ${points} pts${streakLine}`;
    return `${head}\n${grid}\n${verdict}\n${gameUrl()}`;
  })();
  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };
  const wikiNode = wikiId ? tree.byId.get(wikiId) ?? null : null;
  const peekNode = pendingPeek ? tree.byId.get(pendingPeek) ?? null : null;
  // Looking up a species you still have to place forfeits its point, so it goes
  // through a confirm step; anchors + clade labels are free context and open at once.
  const willCost = (id: string) => !over && board.slotIds.includes(id) && !g.peeked.includes(id) && !g.hints.includes(id);
  const askWiki = (id: string) => (willCost(id) ? setPendingPeek(id) : setWikiId(id));
  const confirmPeek = () => { if (pendingPeek) { g.peek(pendingPeek); setWikiId(pendingPeek); setPendingPeek(null); } };

  const info = (id: string) => (
    <button className="branches-info" title={willCost(id) ? "Wikipedia (costs ½ point)" : "Wikipedia"} onClick={(e) => { e.stopPropagation(); askWiki(id); }}>ⓘ</button>
  );

  function LeafTile({ id }: { id: string }) {
    if (anchors.has(id)) {
      return (
        <div className="branches-leaf is-anchor" title={sciOf(tree, id)} onClick={() => setWikiId(id)}>
          <span className="branches-leaf-name">{nameOf(tree, id)}</span>
        </div>
      );
    }
    const placed = g.placements[id];
    const hinted = g.hints.includes(id);
    const correct = over && placed === id;
    const wrong = over && placed !== id;
    const cls = [
      "branches-leaf is-slot",
      placed ? "is-filled" : "is-empty",
      hinted ? "is-hint" : "",
      dragOver === id ? "is-drop" : "",
      correct ? "is-correct" : "",
      wrong ? "is-wrong" : "",
    ].join(" ");
    return (
      <div
        className={cls}
        title={placed ? sciOf(tree, placed) : "Drop a species here"}
        onClick={() => g.placeAt(id)}
        onDragOver={(e) => { if (!over && !hinted) { e.preventDefault(); setDragOver(id); } }}
        onDragLeave={() => setDragOver((d) => (d === id ? null : d))}
        onDrop={(e) => { e.preventDefault(); setDragOver(null); const d = readDrag(e); if (d?.speciesId) g.place(id, d.speciesId); }}
      >
        {placed ? (
          <span className="branches-leaf-line">
            <span
              className="branches-leaf-name"
              draggable={!over && !hinted}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ from: "slot", speciesId: placed, slotId: id }))}
            >
              {nameOf(tree, placed)}
            </span>
            {hinted && <span className="branches-hint-tag">hint</span>}
            {info(placed)}
          </span>
        ) : (
          <span className="branches-leaf-blank">place species</span>
        )}
        {wrong && <span className="branches-leaf-answer">= {nameOf(tree, id)} {info(id)}</span>}
      </div>
    );
  }

  return (
    <div className="branches">
      <GameHeader
        game="branches"
        tier={g.tier}
        dayName={rules.dayName}
        difficulty={rules.difficulty}
        onHowItWorks={onHowItWorks}
        blurb="Rebuild the tree: drag each species onto the group it belongs to. Each group is one labelled clade; where a species is already placed, it's a worked example. Tapping a clade or anchor for its Wikipedia is free; looking up a species you must place costs half its point."
      >
        <div className="branches-viewtoggle" role="tablist" aria-label="Tree view">
          <button role="tab" aria-selected={!radial} className={`branches-viewseg${!radial ? " is-on" : ""}`} onClick={() => setMode("tree")}>Tree</button>
          <button role="tab" aria-selected={radial} className={`branches-viewseg${radial ? " is-on" : ""}`} onClick={() => setMode("radial")}>Radial</button>
        </div>
      </GameHeader>

      {sandbox && <PlaytestBar dev={devSettings} onAutosolve={g.solve} />}

      <div className="branches-stage">
        <div ref={canvasRef} className="clado-canvas" style={{ width: layout.width, height: layout.height }}>
          <svg className="clado-links" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.links.map((l, i) => (
              <path key={i} d={l.d} className="clado-link" />
            ))}
          </svg>
          {layout.nodes.map((n) => {
            // Leaves are the game's interactive tiles: in radial mode a tip's tile
            // floats out along its branch; in tree mode it hangs from the tip.
            if (n.isLeaf) {
              const style = radial
                ? { left: n.x + (n.ox ?? 0) * TIP_OUT, top: n.y + (n.oy ?? 0) * TIP_OUT }
                : { left: n.x, top: n.y };
              return (
                <div
                  key={n.id}
                  ref={(el) => { if (el) tileEls.current.set(n.id, el); else tileEls.current.delete(n.id); }}
                  className={`branches-node is-leaf${radial ? " is-radial" : ""}`}
                  style={style}
                >
                  <LeafTile id={n.id} />
                </div>
              );
            }
            // Clades + junctions render exactly like Lineage's cladogram points. In the
            // radial fan a clade label extends INWARD (toward the centre), where there's only
            // thin branch structure, rather than outward toward the rim where the big leaf
            // tiles sit. So a right-half label (ox > 0) is mirrored to point left (is-flip)
            // and a left-half label points right — both away from their own tiles.
            const flip = radial && (n.ox ?? 0) > 0;
            if (!groupSet.has(n.id)) {
              // The root shared ancestor gets a clade label (nearest named one);
              // every other unnamed split stays a bare junction dot.
              if (n.id === rootId && rootAnnoId) {
                const anc = tree.byId.get(rootAnnoId);
                return (
                  <button key={n.id} type="button" className={`clado-pt is-clade is-ancestor${flip ? " is-flip" : ""}`} style={{ left: n.x, top: n.y }} onClick={() => setWikiId(rootAnnoId)}>
                    <span className="pt-dot" />
                    <span className="pt-name">{cladeLabel(rootAnnoId)}</span>
                    {!hideRank && <span className="pt-rank">{anc?.rank}</span>}
                  </button>
                );
              }
              return (
                <div key={n.id} className="clado-pt is-junction" style={{ left: n.x, top: n.y }}>
                  <span className="pt-dot" />
                </div>
              );
            }
            const node = tree.byId.get(n.id);
            return (
              <button key={n.id} type="button" className={`clado-pt is-clade${flip ? " is-flip" : ""}`} style={{ left: n.x, top: n.y }} onClick={() => setWikiId(n.id)}>
                <span className="pt-dot" />
                <span className="pt-name">{cladeLabel(n.id)}</span>
                {!hideRank && <span className="pt-rank">{node?.rank}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {!over && (
        <div className="branches-dock">
          <div className="branches-tray-cap">
            {g.tray.length === 0 ? "All placed" : `Species to place · ${g.tray.length} left`}
          </div>
          <div
            className={`branches-tray${trayOver ? " is-over" : ""}${g.tray.length === 0 ? " is-empty" : ""}`}
            aria-label="Species to place"
            onDragOver={(e) => { e.preventDefault(); setTrayOver(true); }}
            onDragLeave={() => setTrayOver(false)}
            onDrop={(e) => { e.preventDefault(); setTrayOver(false); const d = readDrag(e); if (d?.from === "slot" && d.slotId) g.clearSlot(d.slotId); }}
          >
            {g.tray.length === 0 ? (
              <span className="branches-tray-empty">Drag a tile back here to change a placement.</span>
            ) : (
              g.tray.map((id) => (
                <span key={id} className="branches-chip-wrap">
                  <button
                    className={`branches-chip${g.held === id ? " is-held" : ""}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify({ from: "tray", speciesId: id }))}
                    onClick={() => g.hold(id)}
                    title={sciOf(tree, id)}
                  >
                    <span
                      className={`branches-chip-thumb${trayImgs[id] ? " is-clickable" : ""}`}
                      role={trayImgs[id] ? "button" : undefined}
                      tabIndex={trayImgs[id] ? 0 : undefined}
                      title={trayImgs[id] ? "View picture" : undefined}
                      onClick={(e) => { if (trayImgs[id]) { e.stopPropagation(); setZoomId(id); } }}
                      onKeyDown={(e) => { if (trayImgs[id] && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopPropagation(); setZoomId(id); } }}
                    >
                      {trayImgs[id] && <img src={trayImgs[id].thumb} alt="" />}
                    </span>
                    <span className="branches-chip-name">{nameOf(tree, id)}</span>
                  </button>
                  <button
                    className="branches-chip-info"
                    title={willCost(id) ? "Wikipedia (costs ½ point)" : "Wikipedia"}
                    onClick={(e) => { e.stopPropagation(); askWiki(id); }}
                  >
                    ⓘ
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="branches-actions">
            <button className="linkbtn" onClick={g.hint} disabled={g.hints.length === board.slotIds.length}>
              Hint: reveal one
            </button>
            <button className="branches-submit" onClick={g.submit} disabled={!g.canSubmit}>
              Submit
            </button>
          </div>
        </div>
      )}

      {over && g.result && (
        <div className="branches-result">
          <div className="branches-score">
            <b>{g.result.correct}/{g.result.total}</b> placed correctly
            {(g.result.hinted > 0 || g.result.peeked > 0) && (
              <span className="branches-score-hints"> · {[
                g.result.hinted && `${g.result.hinted} hint${g.result.hinted > 1 ? "s" : ""}`,
                g.result.peeked && `${g.result.peeked} peek${g.result.peeked > 1 ? "s" : ""}`,
              ].filter(Boolean).join(", ")}</span>
            )}
          </div>
          <div className="branches-points">{points} points</div>
          {g.result.correct < g.result.total && (
            <p className="branches-result-note">Each miss shows its correct species.</p>
          )}
          <div className="share">
            <div className="share-head">🌿 Grebe Branches <span>· №{dailyNumber(g.date)}{rules.difficulty ? ` · ${rules.difficulty}` : ""}</span></div>
            <div className="share-grid" aria-label={`placements: ${board.slotIds.map(shareSquare).join("")}`}>
              {board.slotIds.map(shareSquare).join("")}
            </div>
            <div className="share-verdict">
              {won ? "Solved" : "Missed it"} · {g.result.correct}/{g.result.total} placed
              <span className="share-score"> · {points} pts</span>
              {won && streak != null && streak > 0 && <span className="share-streak"> · 🔥{streak}</span>}
            </div>
            <button className="share-btn" onClick={copyShare}>{copied ? "Copied ✓" : "Copy result"}</button>
          </div>
          {g.locked && <p className="daily-lock">✓ You’ve played today’s Branches. Come back tomorrow for a new board.</p>}
        </div>
      )}

      {over && <LeaderboardNudge show={!!configured && !me} />}

      {over && configured && (
        <Leaderboard
          game="branches" label="Branches" variant="today" me={me ?? null} reloadKey={reloadKey} streak={streak}
          note="Score rewards harder days and correct placements. Hints and peeks trim it."
        />
      )}

      {peekNode && (
        <div className="branches-confirm" role="alertdialog" aria-label="Confirm lookup">
          <p>
            Look up <b>{peekNode.common ?? peekNode.sciName}</b>? Its Wikipedia usually names the family,
            which points to the answer, so this <b>costs half that point</b>.
          </p>
          <div className="branches-confirm-actions">
            <button className="linkbtn" onClick={() => setPendingPeek(null)}>Cancel</button>
            <button className="branches-submit" onClick={confirmPeek}>Look it up (−½ point)</button>
          </div>
        </div>
      )}

      {zoomId && trayImgs[zoomId] && (
        <div className="branches-zoom" role="dialog" aria-label={`${nameOf(tree, zoomId)} picture`} onClick={() => setZoomId(null)}>
          <img src={trayImgs[zoomId].full} alt={nameOf(tree, zoomId)} />
          <span className="branches-zoom-cap">{nameOf(tree, zoomId)} · tap to close</span>
        </div>
      )}

      {wikiNode && <WikiCard node={wikiNode} tree={tree} onClose={() => setWikiId(null)} hideImage={(tree.childrenOf.get(wikiNode.id) ?? []).length > 0} />}
    </div>
  );
}
