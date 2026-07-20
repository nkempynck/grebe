import type { GameConfig, Tree } from "../core";
import { dailyAnswerFromLeaves, leavesUnder, winTargetId, WIN_RANK_LADDER, DAILY_EPOCH } from "../core";
import { SCOPE_PRESETS } from "./presets";
import { DAILY_PLAN, type DailyPlan, type DayPlan } from "./dailyPlan";

/** Find a scope id by a keyword in its label, falling back to All life. */
function scope(keyword: RegExp): string {
  return (SCOPE_PRESETS.find((s) => keyword.test(s.label)) ?? SCOPE_PRESETS[0]).id;
}

/** Tiny deterministic string hash → unsigned 32-bit. */
function hash(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface DailyRules {
  config: GameConfig;
  assist: boolean;
  /** Mon…Sun difficulty tier, 1 (gentle) … 7 (brutal). */
  tier: number;
  dayName: string;
  difficulty: string;
  /** A pinned answer leaf id (from a curator override), if any. */
  answerId?: string;
  /** True when a curator override changed the auto-suggestion for this date. */
  overridden: boolean;
}

/**
 * The week is a RESOLUTION ramp: difficulty is set by how close a guess must land
 * (win tolerance) and whether assist is on — NOT by scope.
 *
 *   Mon/Tue  family  + assist   (Gentle)
 *   Wed      genus   + assist   (Tricky)
 *   Thu/Fri  species + assist   (Harder)
 *   Sat/Sun  species, no assist (Brutal)
 *
 * Prominence weighting (scopeWeights, keyed on the weekday tier) adds a second,
 * independent gradient: the early week leans toward famous species, the weekend
 * toward obscure ones. That's also what keeps the broad scopes (All life…) sane
 * on gentle days — the pick favours a recognisable organism over an obscure mite.
 *
 * On family/genus days many OTL lineages carry no tagged family/genus (birds have
 * a family under half the time); pickDay rejection-samples WITHIN the day's scope
 * until it draws a species whose lineage actually has that rank, so the tier is
 * never silently downgraded. See resolutionHonoured / pickDay.
 */
// Per-weekday resolution + assist. winWithin: 0 = exact species, 1 = genus, 2 = family.
const RAMP: { winWithin: number; assist: boolean }[] = [
  { winWithin: 2, assist: true },  // Mon — family, assist
  { winWithin: 2, assist: true },  // Tue — family, assist
  { winWithin: 1, assist: true },  // Wed — genus, assist
  { winWithin: 0, assist: true },  // Thu — species, assist
  { winWithin: 0, assist: true },  // Fri — species, assist
  { winWithin: 0, assist: false }, // Sat — species, no assist
  { winWithin: 0, assist: false }, // Sun — species, no assist
];

/**
 * Scope is a pure VARIETY knob, independent of difficulty: the same wide pool is
 * available every day. Themed groups plus the broad umbrellas, so a day can range
 * from "a bird" to "anything alive". Fungi is intentionally absent — no such scope
 * exists in the tree, and scope() would silently fall back to All life.
 */
const VARIETY_SCOPES: RegExp[] = [
  /mammal/i, /bird/i, /fish/i, /amphibian/i, /reptile/i, /insect/i, /arthropod/i, /plant/i,
  /animals/i, /chordate/i, /all life/i,
];

// Light scope anti-repeat: a scope drawn in the last N days is skipped, so the
// pool never clusters (no all-life-on-both-weekend-days, no group going dark for a
// month). Kept short so draws stay unpredictable rather than a fixed rotation.
const SCOPE_REPEAT_WINDOW = 3;
const EPOCH_DAY = Math.floor(Date.parse(`${DAILY_EPOCH}T00:00:00Z`) / 86_400_000);
const scopeIdxCache = new Map<number, number>(); // absolute day number → VARIETY_SCOPES index

/** The scope index for an absolute day number, spaced so it avoids the last
 *  SCOPE_REPEAT_WINDOW days' scopes. Deterministic: it replays forward from the
 *  epoch (each day's avoid-set is the prior picks), memoised so callers pay the
 *  walk once. Days before the epoch aren't spaced (no history to anchor to). */
function scopeIndexForDay(days: number): number {
  const len = VARIETY_SCOPES.length;
  if (days < EPOCH_DAY) return hash(`grebe-scope:${days}:0`) % len;
  const cached = scopeIdxCache.get(days);
  if (cached != null) return cached;
  let start = days;
  while (start > EPOCH_DAY && !scopeIdxCache.has(start - 1)) start--;
  for (let d = start; d <= days; d++) {
    if (scopeIdxCache.has(d)) continue;
    const avoid = new Set<number>();
    for (let k = 1; k <= SCOPE_REPEAT_WINDOW; k++) {
      const prev = scopeIdxCache.get(d - k);
      if (prev != null) avoid.add(prev);
    }
    let pick = hash(`grebe-scope:${d}:0`) % len;
    for (let attempt = 0; attempt < 32 && avoid.has(pick); attempt++) {
      pick = hash(`grebe-scope:${d}:${attempt + 1}`) % len;
    }
    scopeIdxCache.set(d, pick);
  }
  return scopeIdxCache.get(days)!;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
// Labelled by RESOLUTION BAND (indexed Mon…Sun): family = Gentle, genus = Tricky,
// species+assist = Harder, species no-assist = Brutal. Consecutive same-band days
// share a word; the difficulty still climbs every day underneath — tier (leaderboard
// weight 100→160) and species obscurity (PROM_EXP) both rise Mon→Sun regardless.
const DIFFICULTY = ["Gentle", "Gentle", "Tricky", "Harder", "Harder", "Brutal", "Brutal"];

/** The daily rules for a given YYYY-MM-DD (UTC). */
export function dailyRules(dateKey: string): DailyRules {
  const ts = Date.parse(`${dateKey}T00:00:00Z`);
  const days = Math.floor(ts / 86_400_000);
  // UTC weekday, re-indexed so Monday = 0, so the ramp lands the same for all.
  const idx = (new Date(ts).getUTCDay() + 6) % 7;

  // Difficulty (resolution + assist) is fixed by the weekday; scope is an
  // independent, spaced variety draw. Both are pure functions of the date →
  // everyone shares one puzzle per day.
  const { winWithin, assist } = RAMP[idx];
  const scopeRe = VARIETY_SCOPES[scopeIndexForDay(days)];

  return {
    config: { scopeRootId: scope(scopeRe), winWithin },
    assist,
    tier: idx + 1,
    dayName: DAY_NAMES[idx],
    difficulty: DIFFICULTY[idx],
    overridden: false,
  };
}

/** Fold a curator override over the auto-suggested rules. Fields left unset in
 *  the override keep the suggestion. */
export function mergeDayPlan(auto: DailyRules, ov: DayPlan | undefined): DailyRules {
  if (!ov) return auto;
  const overridden =
    ov.scopeRootId !== undefined ||
    ov.winWithin !== undefined ||
    ov.assist !== undefined ||
    ov.answerId !== undefined;
  return {
    ...auto,
    config: {
      scopeRootId: ov.scopeRootId ?? auto.config.scopeRootId,
      winWithin: ov.winWithin ?? auto.config.winWithin,
    },
    assist: ov.assist ?? auto.assist,
    answerId: ov.answerId,
    overridden,
  };
}

/** The effective daily rules for a date: the auto-suggestion with any override
 *  from `plan` (the committed plan by default) applied on top. */
export function resolveDailyRules(dateKey: string, plan: DailyPlan = DAILY_PLAN): DailyRules {
  return mergeDayPlan(dailyRules(dateKey), plan[dateKey]);
}

/** Days a Lineage answer must stay clear of its recent predecessors: a full year,
 *  so no organism recurs within 365 days. The per-scope pools comfortably support
 *  this (simulated: zero forced repeats even at 500) — raise/lower freely. */
const ANTI_REPEAT_WINDOW = 365;
const RESOLVE_ATTEMPTS = 40;

function shiftDate(dateKey: string, delta: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Once the game narrows to a species' terminal clade, siblings there are
// indistinguishable by warmth — so a big "rake" of leaves under one parent turns
// the endgame into a 1-in-N guess (luck, not skill). Bar species in a rake larger
// than this from being the ANSWER (they stay fully guessable); the answer then
// always sits in a ≤RAKE_CAP terminal clade. In this tree every rake this big is
// also obscure (shrews, abalone, boletes, hares), so this doubles as an obscurity
// filter — no occurrence data or rebuild needed, it's pure tree structure.
const RAKE_CAP = 3;
const rakeExcludedByTree = new WeakMap<Tree, Set<string>>();
function rakeExcluded(tree: Tree): Set<string> {
  let s = rakeExcludedByTree.get(tree);
  if (s) return s;
  s = new Set();
  for (const [, children] of tree.childrenOf) {
    const leafKids = children.filter((c) => (tree.childrenOf.get(c) ?? []).length === 0);
    if (leafKids.length > RAKE_CAP) for (const c of leafKids) s.add(c);
  }
  rakeExcludedByTree.set(tree, s);
  return s;
}

// leavesUnder is the costly part of a pick; cache it per (tree, scope) so the
// epoch replay below is O(1) per day. Answer-eligible leaves only (rake-capped).
const leavesByTree = new WeakMap<Tree, Map<string, string[]>>();
function scopeLeaves(tree: Tree, scope: string): string[] {
  let m = leavesByTree.get(tree);
  if (!m) { m = new Map(); leavesByTree.set(tree, m); }
  let l = m.get(scope);
  if (!l) {
    const excluded = rakeExcluded(tree);
    l = leavesUnder(tree, scope).filter((id) => !excluded.has(id));
    m.set(scope, l);
  }
  return l;
}

// Prominence weighting for the daily answer, biased by difficulty. The weight is
// base^exp: `base` is 1 for curated icons, else the species' occurrence percentile
// WITHIN ITS ORDER (so each order surfaces its own recognisable members instead of
// the most species-rich group drowning the rest — whales aren't buried by mice).
// `exp` is large on gentle days (famous-biased) and 0 on Sunday (uniform). Every
// species keeps a nonzero weight, so the anti-repeat pool is never shrunk.
const PROM_EXP = [0, 8, 6, 4.5, 3, 1.8, 0.8, 0]; // index by tier 1…7 (0 unused)

// Per species: occurrence percentile within its nearest ORDER ancestor (0,1].
// Empty until patch-prominence.mjs has baked `occ` — then weighting is uniform, a
// graceful no-op. Cached per tree.
const orderPromByTree = new WeakMap<Tree, Map<string, number>>();
function orderProm(tree: Tree): Map<string, number> {
  const cached = orderPromByTree.get(tree);
  if (cached) return cached;
  const m = new Map<string, number>();
  const keyFor = (id: string): string => {
    let fallback = "__root";
    for (let c: string | null | undefined = tree.byId.get(id)?.parentId; c; c = tree.byId.get(c)?.parentId) {
      const n = tree.byId.get(c);
      if (!n) break;
      if (n.rank === "order") return n.id;
      if (fallback === "__root" && (n.rank === "class" || n.rank === "phylum")) fallback = n.id;
    }
    return fallback;
  };
  const groups = new Map<string, { id: string; views: number }[]>();
  for (const n of tree.byId.values()) {
    if ((tree.childrenOf.get(n.id) ?? []).length) continue; // leaves = species
    if (n.views == null) continue; // no views baked yet → leave empty → uniform
    (groups.get(keyFor(n.id)) ?? groups.set(keyFor(n.id), []).get(keyFor(n.id))!).push({ id: n.id, views: n.views });
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => a.views - b.views);
    arr.forEach((s, i) => m.set(s.id, (i + 1) / (arr.length + 1))); // most-recorded → highest
  }
  orderPromByTree.set(tree, m);
  return m;
}

const weightsByTree = new WeakMap<Tree, Map<string, number[]>>();
function scopeWeights(tree: Tree, scope: string, tier: number): number[] | undefined {
  const exp = PROM_EXP[tier] ?? 0;
  if (exp === 0) return undefined; // uniform
  const prom = orderProm(tree);
  if (prom.size === 0) return undefined; // pre-patch: no occ → uniform
  let m = weightsByTree.get(tree);
  if (!m) { m = new Map(); weightsByTree.set(tree, m); }
  const key = `${scope}|${tier}`;
  let w = m.get(key);
  if (!w) {
    w = scopeLeaves(tree, scope).map((id) => {
      const n = tree.byId.get(id);
      const base = n?.icon ? 1 : (prom.get(id) ?? 0.01);
      return Math.pow(base, exp);
    });
    m.set(key, w);
  }
  return w;
}

/** True when the day's win resolution is actually achievable for a candidate —
 *  i.e. its lineage carries a real ancestor at the target rank. On family/genus
 *  days a candidate whose lineage skips that rank (OTL leaves it as an unranked
 *  "clade") would silently downgrade the tier to whatever lower rank exists.
 *  Exact-species days (winWithin 0) accept anyone. */
function resolutionHonoured(tree: Tree, cand: string, winWithin: number): boolean {
  if (winWithin <= 0) return true;
  const target = winTargetId(tree, cand, winWithin);
  return tree.byId.get(target)?.rank === WIN_RANK_LADDER[winWithin];
}

// Positions within scopeLeaves(scope) whose lineage carries the win rank, cached
// per scope|winWithin (rank eligibility is tier-independent). Pre-filtering the
// pool to these — rather than rejecting after the draw — guarantees the advertised
// resolution is ALWAYS honoured, with no risk of a weighted draw burning its
// attempts on a famous but untagged species (e.g. Grass snake, no tagged family).
const eligibleByScopeWin = new Map<string, number[]>();
function eligibleIndices(tree: Tree, scope: string, winWithin: number): number[] {
  if (winWithin <= 0) return [];
  const key = `${scope}|${winWithin}`;
  let idxs = eligibleByScopeWin.get(key);
  if (!idxs) {
    const leaves = scopeLeaves(tree, scope);
    idxs = [];
    for (let i = 0; i < leaves.length; i++) {
      if (resolutionHonoured(tree, leaves[i], winWithin)) idxs.push(i);
    }
    eligibleByScopeWin.set(key, idxs);
  }
  return idxs;
}

/** One day's answer: a curator pin, else a prominence-weighted draw (gentle =
 *  icon/familiar-biased, Sunday = uniform) that skips the anti-repeat `avoid` set.
 *  On family/genus days the pool is pre-restricted to species that actually carry
 *  that rank, so the resolution is guaranteed and the pool still dwarfs the
 *  anti-repeat window (no repeats). */
function pickDay(tree: Tree, dateKey: string, plan: DailyPlan, avoid: (id: string) => boolean): string {
  const rules = resolveDailyRules(dateKey, plan);
  if (rules.answerId && tree.byId.has(rules.answerId)) return rules.answerId;
  const scope = rules.config.scopeRootId;
  const winWithin = rules.config.winWithin;
  let leaves = scopeLeaves(tree, scope);
  let weights = scopeWeights(tree, scope, rules.tier);
  const idxs = eligibleIndices(tree, scope, winWithin);
  if (idxs.length > 0) {
    // Restrict to rank-eligible species (and realign their weights). Guarded on
    // non-empty so a scope with no tagged rank at all still yields a board.
    leaves = idxs.map((i) => leaves[i]);
    weights = weights ? idxs.map((i) => weights![i]) : undefined;
  }
  for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
    const cand = dailyAnswerFromLeaves(leaves, dateKey, scope, attempt, weights);
    if (!avoid(cand)) return cand;
  }
  // The weighted draw concentrates mass on a few prominent species; in a small
  // eligible pool those can all be inside the anti-repeat window, exhausting the
  // attempts. Fall back to a deterministic sweep over the WHOLE pool from a seeded
  // offset — this returns a non-repeating species whenever one exists (the pool
  // always dwarfs the window), so anti-repeat holds even when weighting can't.
  const start = hash(`grebe-sweep:${dateKey}:${scope}`) % leaves.length;
  for (let j = 0; j < leaves.length; j++) {
    const cand = leaves[(start + j) % leaves.length];
    if (!avoid(cand)) return cand;
  }
  return leaves[start]; // every eligible species used recently — unreachable in practice
}

/** The daily answer species for a date, skipping any species used in the previous
 *  ANTI_REPEAT_WINDOW days so nearby days never repeat. A curator pin always wins.
 *
 *  It replays the sequence from DAILY_EPOCH up to the date, keeping a rolling
 *  window of the species actually shown. Anchoring at the fixed epoch (rather
 *  than the target minus a window) makes every date resolve identically no matter
 *  which date is asked for — so a species picked on one day is visible to the days
 *  that follow it, giving a solid guarantee rather than an approximation. Pure and
 *  deterministic; cheap (O(1) per replayed day with leaves cached). */
export function dailyAnswerFor(tree: Tree, dateKey: string, plan: DailyPlan = DAILY_PLAN): string {
  if (dateKey <= DAILY_EPOCH) return pickDay(tree, dateKey, plan, () => false);

  const queue: string[] = []; // last WINDOW shown answers (FIFO)
  const counts = new Map<string, number>(); // multiset view of queue
  const avoid = (id: string) => (counts.get(id) ?? 0) > 0;

  for (let d = DAILY_EPOCH; ; d = shiftDate(d, 1)) {
    const pick = pickDay(tree, d, plan, avoid);
    if (d === dateKey) return pick;
    queue.push(pick);
    counts.set(pick, (counts.get(pick) ?? 0) + 1);
    if (queue.length > ANTI_REPEAT_WINDOW) {
      const old = queue.shift()!;
      const c = (counts.get(old) ?? 0) - 1;
      if (c <= 0) counts.delete(old);
      else counts.set(old, c);
    }
  }
}
