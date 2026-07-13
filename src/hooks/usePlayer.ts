import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../data/supabase";

export interface UsePlayer {
  /** Whether sync is even possible (Supabase configured). */
  configured: boolean;
  session: Session | null;
  /** Login-derived username (the account identifier, sans internal domain). */
  username: string | null;
  /** True only for allowlisted admins (server-checked via is_admin()). Gates
   *  admin-only affordances like the leaderboard demo preview. */
  isAdmin: boolean;
  /** The editable public name shown on leaderboards (profiles.display_name). */
  displayName: string | null;
  error: string | null;
  signIn: (username: string, password: string, captchaToken?: string) => Promise<boolean>;
  signUp: (username: string, password: string, captchaToken?: string) => Promise<boolean>;
  signOut: () => void;
  /** Update the public leaderboard name. */
  updateDisplayName: (name: string) => Promise<{ error: string | null }>;
}

const PLAYER_DOMAIN = "@cladensis.player";

/** Turn a bare username into the email-format string Supabase Auth needs. If the
 *  user typed a real email, keep it (lets them use password reset). */
const asEmail = (u: string) => {
  const v = u.trim().toLowerCase();
  return v.includes("@") ? v : `${v}${PLAYER_DOMAIN}`;
};
const fromEmail = (e: string | undefined) =>
  e ? e.replace(new RegExp(`${PLAYER_DOMAIN}$`), "") : null;

export function usePlayer(): UsePlayer {
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayNameState] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Track the player's public display name from their profile row.
  useEffect(() => {
    if (!supabase || !session) { setDisplayNameState(null); return; }
    let live = true;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => { if (live) setDisplayNameState(data?.display_name ?? null); });
    return () => { live = false; };
  }, [session]);

  // Server-verified admin flag. is_admin() is SECURITY DEFINER and keys off the
  // caller's JWT, so this can't be spoofed client-side. Non-admins (and signed-out
  // players) resolve to false, which hides admin-only affordances.
  useEffect(() => {
    if (!supabase || !session) { setIsAdmin(false); return; }
    let live = true;
    supabase.rpc("is_admin").then(({ data }) => { if (live) setIsAdmin(data === true); });
    return () => { live = false; };
  }, [session]);

  const updateDisplayName = useCallback(
    async (name: string) => {
      const clean = name.trim();
      if (!supabase || !session) return { error: "not signed in" };
      if (!clean) return { error: "name can't be empty" };
      // Goes through the set_display_name() RPC — the ONLY write path — which
      // validates length/charset, screens a denylist, and enforces uniqueness
      // server-side (a direct profiles UPDATE is no longer permitted by RLS). It
      // returns the stored, normalised name; a rejection surfaces as error.message.
      const { data, error } = await supabase.rpc("set_display_name", { p_name: clean });
      if (error) return { error: error.message };
      setDisplayNameState((data as string | null) ?? clean);
      return { error: null };
    },
    [session]
  );

  const signIn = useCallback(async (username: string, password: string, captchaToken?: string) => {
    if (!supabase || !username.trim() || !password) return false;
    const { error } = await supabase.auth.signInWithPassword({
      email: asEmail(username),
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    setError(error?.message ?? null);
    return !error;
  }, []);

  const signUp = useCallback(async (username: string, password: string, captchaToken?: string) => {
    if (!supabase || !username.trim() || !password) return false;
    const { error } = await supabase.auth.signUp({
      email: asEmail(username),
      password,
      options: captchaToken ? { captchaToken } : undefined,
    });
    setError(error?.message ?? null);
    return !error;
  }, []);

  const signOut = useCallback(() => {
    void supabase?.auth.signOut();
  }, []);

  return {
    configured: isSupabaseConfigured,
    session,
    username: fromEmail(session?.user.email),
    isAdmin,
    displayName,
    error,
    signIn,
    signUp,
    signOut,
    updateDisplayName,
  };
}
