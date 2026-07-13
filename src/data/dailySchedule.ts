import type { GameConfig, Tree } from "../core";
import { dailyAnswerFromLeaves, leavesUnder, DAILY_EPOCH } from "../core";
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

interface Recipe {
  scope: RegExp;
  winWithin: number;
  assist: boolean;
}

/**
 * One pool of recipes per weekday. Difficulty still rises Monday → Sunday (win
 * tolerance tightens, assist switches off, scope broadens) — that ramp is the
 * leaderboard's difficulty tier, so it stays locked to the weekday. Within a
 * day, the specific recipe is drawn from a wide pool by a PER-DAY seed, so the
 * puzzle is unpredictable (consecutive same-weekdays don't cycle a tiny list)
 * while every player still shares one puzzle per day. Pools stay inside their
 * day's difficulty band so the fixed tier weight remains fair.
 */
const POOLS: Recipe[][] = [
  // Monday — gentle: familiar, narrow, forgiving (order/family, assist on)
  [
    { scope: /mammal/i, winWithin: 3, assist: true },
    { scope: /bird/i, winWithin: 3, assist: true },
    { scope: /fish/i, winWithin: 2, assist: true },
    { scope: /insect/i, winWithin: 3, assist: true },
    { scope: /mammal/i, winWithin: 2, assist: true },
    { scope: /bird/i, winWithin: 2, assist: true },
  ],
  // Tuesday — easy (family/order, assist on)
  [
    { scope: /mammal/i, winWithin: 2, assist: true },
    { scope: /bird/i, winWithin: 2, assist: true },
    { scope: /fish/i, winWithin: 3, assist: true },
    { scope: /insect/i, winWithin: 2, assist: true },
    { scope: /plant/i, winWithin: 3, assist: true },
    { scope: /fungi/i, winWithin: 2, assist: true },
  ],
  // Wednesday — medium: assist starts dropping (family/genus)
  [
    { scope: /bird/i, winWithin: 2, assist: false },
    { scope: /mammal/i, winWithin: 1, assist: true },
    { scope: /insect/i, winWithin: 2, assist: false },
    { scope: /plant/i, winWithin: 2, assist: true },
    { scope: /fish/i, winWithin: 2, assist: false },
    { scope: /arthropod/i, winWithin: 2, assist: true },
  ],
  // Thursday — tricky: broader clades (family/genus, mostly no assist)
  [
    { scope: /animals/i, winWithin: 2, assist: false },
    { scope: /chordate/i, winWithin: 2, assist: false },
    { scope: /arthropod/i, winWithin: 2, assist: false },
    { scope: /fungi/i, winWithin: 1, assist: true },
    { scope: /plant/i, winWithin: 1, assist: false },
    { scope: /insect/i, winWithin: 1, assist: false },
  ],
  // Friday — hard (genus/exact, no assist)
  [
    { scope: /animals/i, winWithin: 1, assist: false },
    { scope: /chordate/i, winWithin: 1, assist: false },
    { scope: /insect/i, winWithin: 1, assist: false },
    { scope: /arthropod/i, winWithin: 1, assist: false },
    { scope: /bird/i, winWithin: 0, assist: false },
    { scope: /mammal/i, winWithin: 0, assist: false },
  ],
  // Saturday — harder: exact species, medium-broad scopes
  [
    { scope: /animals/i, winWithin: 0, assist: false },
    { scope: /chordate/i, winWithin: 0, assist: false },
    { scope: /bird/i, winWithin: 0, assist: false },
    { scope: /insect/i, winWithin: 0, assist: false },
    { scope: /fish/i, winWithin: 0, assist: false },
    { scope: /arthropod/i, winWithin: 0, assist: false },
  ],
  // Sunday — brutal: widest scope, exact
  [
    { scope: /all life/i, winWithin: 0, assist: false },
    { scope: /animals/i, winWithin: 0, assist: false },
    { scope: /plant/i, winWithin: 0, assist: false },
    { scope: /chordate/i, winWithin: 0, assist: false },
    { scope: /fungi/i, winWithin: 0, assist: false },
  ],
];

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DIFFICULTY = ["Gentle", "Easy", "Medium", "Tricky", "Hard", "Harder", "Brutal"];

/** The daily rules for a given YYYY-MM-DD (UTC). */
export function dailyRules(dateKey: string): DailyRules {
  const ts = Date.parse(`${dateKey}T00:00:00Z`);
  const days = Math.floor(ts / 86_400_000);
  // UTC weekday, re-indexed so Monday = 0, so the ramp lands the same for all.
  const idx = (new Date(ts).getUTCDay() + 6) % 7;

  // Per-DAY seed (not per-week): the absolute day number mixed with a salt, so
  // consecutive same-weekdays draw independently from the pool rather than
  // marching through it. Still a pure function of the date → shared by everyone.
  const pool = POOLS[idx];
  const r = pool[hash(`grebe:${days}:${idx}`) % pool.length];

  return {
    config: { scopeRootId: scope(r.scope), winWithin: r.winWithin },
    assist: r.assist,
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

// leavesUnder is the costly part of a pick; cache it per (tree, scope) so the
// epoch replay below is O(1) per day.
const leavesByTree = new WeakMap<Tree, Map<string, string[]>>();
function scopeLeaves(tree: Tree, scope: string): string[] {
  let m = leavesByTree.get(tree);
  if (!m) { m = new Map(); leavesByTree.set(tree, m); }
  let l = m.get(scope);
  if (!l) { l = leavesUnder(tree, scope); m.set(scope, l); }
  return l;
}

/** One day's answer: a curator pin, else the first re-roll not blocked by `avoid`. */
function pickDay(tree: Tree, dateKey: string, plan: DailyPlan, avoid: (id: string) => boolean): string {
  const rules = resolveDailyRules(dateKey, plan);
  if (rules.answerId && tree.byId.has(rules.answerId)) return rules.answerId;
  const scope = rules.config.scopeRootId;
  const leaves = scopeLeaves(tree, scope);
  for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
    const cand = dailyAnswerFromLeaves(leaves, dateKey, scope, attempt);
    if (!avoid(cand)) return cand;
  }
  return dailyAnswerFromLeaves(leaves, dateKey, scope, 0);
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
