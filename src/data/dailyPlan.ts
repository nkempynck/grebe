import plan from "./dailyPlan.json";
import { supabase } from "./supabase";

/**
 * Curator overrides for the daily puzzle, keyed by YYYY-MM-DD. Anything set here
 * wins over the automatic schedule/pick for that date; anything omitted falls
 * back to the suggestion. This file is the committed source of truth — the admin
 * panel (open the app with #admin) exports JSON to paste into dailyPlan.json.
 */
export interface DayPlan {
  /** Override the scope (a SCOPE_PRESETS id). */
  scopeRootId?: string;
  /** Override the win tolerance (edges from the answer). */
  winWithin?: number;
  /** Override the search assist. */
  assist?: boolean;
  /** Pin an exact answer (a species leaf id) instead of the deterministic pick. */
  answerId?: string;
  /** Free note for your own reference; ignored by the game. */
  note?: string;
}

export type DailyPlan = Record<string, DayPlan>;

export const DAILY_PLAN = plan as DailyPlan;

/** localStorage key holding the curator's unpublished draft overrides. */
export const DRAFT_KEY = "cladensis.dailyPlan.draft";

/** The plan the game actually resolves against: committed overrides with any
 *  local (unpublished) draft layered on top. The draft is per-browser, so a
 *  curator can preview their edits by playing; other players see only the
 *  committed plan until the draft is exported into dailyPlan.json. */
export function effectivePlan(): DailyPlan {
  let draft: DailyPlan = {};
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) draft = JSON.parse(raw) as DailyPlan;
  } catch {
    /* ignore */
  }
  return { ...DAILY_PLAN, ...draft };
}

// ---- Supabase-backed live plan (used only when Supabase is configured) ----

/** DB row shape for public.daily_plan (snake_case columns). */
interface PlanRow {
  date: string;
  scope_root_id: string | null;
  win_within: number | null;
  assist: boolean | null;
  answer_id: string | null;
  note: string | null;
}

function rowToDayPlan(r: PlanRow): DayPlan {
  const p: DayPlan = {};
  if (r.scope_root_id != null) p.scopeRootId = r.scope_root_id;
  if (r.win_within != null) p.winWithin = r.win_within;
  if (r.assist != null) p.assist = r.assist;
  if (r.answer_id != null) p.answerId = r.answer_id;
  if (r.note != null) p.note = r.note;
  return p;
}

/** The live plan: committed overrides with any Supabase rows layered on top.
 *  Falls back to the committed plan on any error so the game never breaks. */
export async function fetchRemotePlan(): Promise<DailyPlan> {
  if (!supabase) return { ...DAILY_PLAN };
  try {
    const { data, error } = await supabase.from("daily_plan").select("*");
    if (error || !data) return { ...DAILY_PLAN };
    const remote: DailyPlan = {};
    for (const row of data as PlanRow[]) remote[row.date] = rowToDayPlan(row);
    return { ...DAILY_PLAN, ...remote };
  } catch {
    return { ...DAILY_PLAN };
  }
}

/** Upsert one day's override (admin only; RLS enforces this server-side). */
export async function saveRemoteDay(date: string, p: DayPlan): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Supabase not configured" };
  const { error } = await supabase.from("daily_plan").upsert({
    date,
    scope_root_id: p.scopeRootId ?? null,
    win_within: p.winWithin ?? null,
    assist: p.assist ?? null,
    answer_id: p.answerId ?? null,
    note: p.note ?? null,
    updated_at: new Date().toISOString(),
  });
  return { error: error?.message ?? null };
}

/** Remove a day's override entirely (back to auto). */
export async function deleteRemoteDay(date: string): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Supabase not configured" };
  const { error } = await supabase.from("daily_plan").delete().eq("date", date);
  return { error: error?.message ?? null };
}
