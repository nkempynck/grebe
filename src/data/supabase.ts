import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Config comes from Vite env vars (VITE_ prefixed → exposed to the browser).
// The anon key is public-safe: row-level security in the database is what
// actually protects writes. When these are absent the app runs exactly as
// before — committed dailyPlan.json + local draft, no network.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url!, anonKey!)
  : null;
