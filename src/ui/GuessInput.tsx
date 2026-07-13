import { useMemo, useState } from "react";
import type { GameConfig, GuessResult, Tree } from "../core";
import { isAncestor, isInScope, normalizeName } from "../core";
import { warmthColor } from "./temperature";

interface Props {
  tree: Tree;
  config: GameConfig;
  disabled: boolean;
  onSubmit: (text: string) => void;
  /** When set (focused difficulty), only species inside this clade are offered. */
  focusCladeId: string | null;
  /** Guesses so far, to mark already-guessed entries. */
  guesses: GuessResult[];
}

interface Cand {
  id: string;
  common?: string;
  sci: string;
  kind: "species" | "group";
}

const label = (c: Cand) => (c.common ? `${c.common} (${c.sci})` : c.sci);

export function GuessInput({ tree, config, disabled, onSubmit, focusCladeId, guesses }: Props) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const guessedById = useMemo(
    () => new Map(guesses.map((r) => [r.guess.id, r])),
    [guesses]
  );

  // Everything guessable in scope, rebuilt only when the scope/focus changes.
  // Species (leaves) plus EVERY named clade — a clade counts as guessable if it
  // has any scientific name, so you can scout by the Latin name of any group
  // (e.g. "Carnivora", "Percidae"), not only the ones with a friendly common
  // name. Filtered per keystroke below.
  const candidates = useMemo(() => {
    const out: Cand[] = [];
    for (const node of tree.byId.values()) {
      if (!isInScope(tree, config, node.id)) continue;
      if (focusCladeId && !isAncestor(tree, focusCladeId, node.id)) continue;
      const isLeaf = (tree.childrenOf.get(node.id) ?? []).length === 0;
      if (isLeaf) out.push({ id: node.id, common: node.common, sci: node.sciName, kind: "species" });
      else if (node.sciName) out.push({ id: node.id, common: node.common, sci: node.sciName, kind: "group" });
    }
    return out;
  }, [tree, config, focusCladeId]);

  // id → candidate, so a synonym match can pull in its target species (only if
  // that species is itself in scope/focus and therefore guessable).
  const candById = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);

  // The empty-box BROWSE list (groups first, then species, A–Z). Latin-only
  // clades are typeable but kept OUT of this list, so idly scrolling isn't a wall
  // of scientific names — only species and friendly common-named groups show.
  // Typing still searches the full `candidates` set below, Latin names included.
  const sortedCandidates = useMemo(() => {
    const byName = (a: Cand, b: Cand) => (a.common ?? a.sci).localeCompare(b.common ?? b.sci);
    const groups = candidates.filter((c) => c.kind === "group" && c.common).sort(byName);
    const species = candidates.filter((c) => c.kind === "species").sort(byName);
    return [...groups, ...species];
  }, [candidates]);

  const q = text.trim().toLowerCase();
  const suggestions = useMemo(() => {
    if (!q) return sortedCandidates; // empty box → browse the whole scope/subset
    const pre: Cand[] = [];
    const sub: Cand[] = [];
    const seen = new Set<string>();
    const take = (arr: Cand[], c: Cand) => { if (!seen.has(c.id)) { seen.add(c.id); arr.push(c); } };
    for (const c of candidates) {
      const names = [c.common, c.sci].filter(Boolean).map((s) => s!.toLowerCase());
      if (names.some((n) => n.startsWith(q))) take(pre, c);
      else if (names.some((n) => n.includes(q))) take(sub, c);
    }
    // Synonyms: a typed alternate name ("orca") surfaces its target species
    // ("Killer whale"), as long as that species is guessable in the current scope.
    if (tree.synonyms) {
      const nq = normalizeName(text);
      if (nq) {
        for (const [alt, id] of tree.synonyms) {
          if (seen.has(id)) continue;
          const c = candById.get(id);
          if (!c) continue;
          if (alt.startsWith(nq)) take(pre, c);
          else if (alt.includes(nq)) take(sub, c);
        }
      }
    }
    // Groups surface above species within each tier.
    const order = (arr: Cand[]) => [...arr.filter((c) => c.kind === "group"), ...arr.filter((c) => c.kind === "species")];
    return [...order(pre), ...order(sub)].slice(0, 8);
  }, [candidates, candById, q, text, sortedCandidates, tree]);

  // Entries you can actually pick (already-guessed ones are shown but not
  // selectable). activeId lets each row test "am I active?" in O(1) — important
  // when the browse list is hundreds/thousands of rows.
  const selectable = suggestions.filter((c) => !guessedById.has(c.id));
  const activeId = selectable[active]?.id;

  const focusNode = focusCladeId ? tree.byId.get(focusCladeId) : null;
  const speciesCount = candidates.reduce((n, c) => (c.kind === "species" ? n + 1 : n), 0);
  const placeholder = focusNode
    ? `Name a ${focusNode.common ?? focusNode.sciName}… (${speciesCount} options)`
    : "Name a species — or a group like 'snakes' to scout…";

  const choose = (c: Cand) => {
    onSubmit(label(c));
    setText("");
    setOpen(false);
    setActive(0);
  };

  const submitTyped = () => {
    if (disabled || !text.trim()) return;
    onSubmit(text);
    setText("");
    setOpen(false);
    setActive(0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(selectable.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      // Only auto-pick a highlighted row when the user has typed something —
      // otherwise Enter on an empty box would guess the first browse entry.
      if (open && q && selectable[active]) choose(selectable[active]);
      else submitTyped();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="guessbar">
      <div className="gs-field">
        <input
          placeholder={placeholder}
          value={text}
          disabled={disabled}
          onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          // Also open on click: after picking a guess the input keeps focus, so a
          // second click wouldn't re-fire onFocus — without this the list would
          // stay closed for the next guess.
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          aria-label="Your guess"
          autoComplete="off"
        />
        {open && suggestions.length > 0 && (
          <ul className="gs-list" role="listbox">
            {suggestions.map((c) => {
              const r = guessedById.get(c.id);
              const isActive = c.id === activeId;
              const warm = r ? warmthColor(r.warmth, r.isWin) : undefined;
              return (
                <li
                  key={c.id}
                  role="option"
                  aria-selected={isActive}
                  className={`gs-opt${c.kind === "group" ? " is-group" : ""}${r ? " is-guessed" : ""}${isActive ? " is-active" : ""}`}
                  // preventDefault keeps input focus so the click registers before blur
                  onMouseDown={(e) => { e.preventDefault(); if (!r) choose(c); }}
                >
                  <span className="gs-name">{c.common ?? c.sci}</span>
                  {c.kind === "group" && <span className="gs-tag">group</span>}
                  {c.common && c.kind === "species" && <span className="gs-sci">{c.sci}</span>}
                  {r && (
                    <span className="gs-done" style={{ color: warm }}>
                      {r.isWin ? "✓ found" : `guessed · ${Math.round(r.warmth * 100)}°`}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <button onClick={submitTyped} disabled={disabled}>Guess</button>
    </div>
  );
}
