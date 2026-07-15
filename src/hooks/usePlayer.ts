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
  /** Whether this account appears on the public leaderboards (profiles.show_on_leaderboard).
   *  Defaults true; a player can opt out from the Account tab. */
  showOnLeaderboard: boolean;
  error: string | null;
  signIn: (username: string, password: string, captchaToken?: string) => Promise<boolean>;
  signUp: (username: string, password: string, captchaToken?: string) => Promise<boolean>;
  signOut: () => void;
  /** Update the public leaderboard name. */
  updateDisplayName: (name: string) => Promise<{ error: string | null }>;
  /** Opt in/out of appearing on the public leaderboards. */
  setShowOnLeaderboard: (on: boolean) => Promise<{ error: string | null }>;
}

// An account is just a NAME. Supabase Auth still needs an identifier in email
// shape, so we map the name to `<name>@cladensis.local` behind the scenes. This
// is never a real address, is never shown, and no email is ever collected. Admin
// is NOT keyed off this identifier (that would be spoofable by registering the
// admin's name): is_admin() reads an app_metadata role claim set with the service
// role, so the account name carries no privilege.
const PLAYER_DOMAIN = "@cladensis.local";

/** Name → the internal identifier Supabase Auth needs. Keeps only name-safe
 *  characters and appends our fixed internal domain. Exported so the curator
 *  sign-in maps names the same way as player sign-in. */
export const asEmail = (name: string) => {
  const v = name.trim().toLowerCase().split("@")[0].replace(/[^a-z0-9_.-]/g, "");
  return `${v || "player"}${PLAYER_DOMAIN}`;
};

/** Identifier → the display name: strip whatever internal domain it carries, so a
 *  name always shows cleanly regardless of which domain the account was made on. */
export const fromEmail = (e: string | undefined) => (e ? e.split("@")[0] : null);

export function usePlayer(): UsePlayer {
  const [session, setSession] = useState<Session | null>(null);
  const [displayName, setDisplayNameState] = useState<string | null>(null);
  const [showOnLeaderboard, setShowOnLbState] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Track the player's public profile: display name + leaderboard opt-in.
  useEffect(() => {
    if (!supabase || !session) { setDisplayNameState(null); setShowOnLbState(true); return; }
    let live = true;
    supabase
      .from("profiles")
      .select("display_name, show_on_leaderboard")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!live) return;
        setDisplayNameState(data?.display_name ?? null);
        // Default to visible when the column is absent (older DB) or unset.
        setShowOnLbState((data as { show_on_leaderboard?: boolean } | null)?.show_on_leaderboard ?? true);
      });
    return () => { live = false; };
  }, [session]);

  // Server-verified admin flag. is_admin() is SECURITY DEFINER and reads the
  // caller's app_metadata role claim (service-role-only), so it can't be spoofed
  // client-side. Non-admins (and signed-out players) resolve to false, which hides
  // admin-only affordances.
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

  // Opt in/out of the public leaderboards. Goes through the set_leaderboard_opt()
  // RPC (direct profiles writes are locked by RLS, same as the name setter).
  const setShowOnLeaderboard = useCallback(
    async (on: boolean) => {
      if (!supabase || !session) return { error: "not signed in" };
      const prev = showOnLeaderboard;
      setShowOnLbState(on); // optimistic
      const { error } = await supabase.rpc("set_leaderboard_opt", { p_on: on });
      if (error) { setShowOnLbState(prev); return { error: error.message }; }
      return { error: null };
    },
    [session, showOnLeaderboard]
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

  // Register with the creature handle the form prefilled. The handle is both the
  // login identifier and the initial leaderboard name — no email is ever used
  // (asEmail strips it). If the handle is already registered, Supabase (with
  // email-confirm disabled) returns an obfuscated user with no identities; we
  // treat that as a collision and retry with a numeric suffix. On success we set
  // the display name to the claimed handle so its casing shows on the board.
  const signUp = useCallback(async (username: string, password: string, captchaToken?: string) => {
    if (!supabase || !username.trim() || !password) return false;
    const base = username.trim();
    for (let attempt = 0; attempt < 6; attempt++) {
      const handle = attempt === 0 ? base : `${base}${attempt}`;
      const { data, error } = await supabase.auth.signUp({
        email: asEmail(handle),
        password,
        options: captchaToken ? { captchaToken } : undefined,
      });
      if (error) { setError(error.message); return false; }
      const taken = !data.session && (data.user?.identities?.length ?? 0) === 0;
      if (taken) continue; // handle already registered — try the next suffix
      setError(null);
      const { data: nm } = await supabase.rpc("set_display_name", { p_name: handle });
      setDisplayNameState((nm as string | null) ?? handle);
      return true;
    }
    setError("That name is taken — pick another and try again.");
    return false;
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
    showOnLeaderboard,
    error,
    signIn,
    signUp,
    signOut,
    updateDisplayName,
    setShowOnLeaderboard,
  };
}
