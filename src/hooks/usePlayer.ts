import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../data/supabase";

export interface UsePlayer {
  /** Whether sync is even possible (Supabase configured). */
  configured: boolean;
  session: Session | null;
  /** Login-derived username (the account identifier, sans internal domain). */
  username: string | null;
  /** The editable public name shown on leaderboards (profiles.display_name). */
  displayName: string | null;
  error: string | null;
  signIn: (username: string, password: string) => Promise<boolean>;
  signUp: (username: string, password: string) => Promise<boolean>;
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

  const updateDisplayName = useCallback(
    async (name: string) => {
      const clean = name.trim();
      if (!supabase || !session) return { error: "not signed in" };
      if (!clean) return { error: "name can't be empty" };
      const { error } = await supabase.from("profiles").update({ display_name: clean }).eq("id", session.user.id);
      if (!error) setDisplayNameState(clean);
      return { error: error?.message ?? null };
    },
    [session]
  );

  const signIn = useCallback(async (username: string, password: string) => {
    if (!supabase || !username.trim() || !password) return false;
    const { error } = await supabase.auth.signInWithPassword({ email: asEmail(username), password });
    setError(error?.message ?? null);
    return !error;
  }, []);

  const signUp = useCallback(async (username: string, password: string) => {
    if (!supabase || !username.trim() || !password) return false;
    const { error } = await supabase.auth.signUp({ email: asEmail(username), password });
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
    displayName,
    error,
    signIn,
    signUp,
    signOut,
    updateDisplayName,
  };
}
