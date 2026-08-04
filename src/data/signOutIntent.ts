/** Did the player CLICK sign out, or did their session simply vanish?
 *
 *  Signing out clears this device's stats on purpose: the data is safe in the
 *  cloud, and the next account to log in here must not inherit them. But a session
 *  can also disappear with no such intent — a token refresh that fails, a session
 *  revoked server-side — and wiping the device then punishes the player for an
 *  infrastructure hiccup, with a stats page that reads empty until they happen to
 *  log back in.
 *
 *  A module-level flag is enough: the auth event that drops the session arrives in
 *  the same tab and the same page life as the click that asked for it. Anything
 *  persisted would risk outliving its meaning. */
let deliberate = false;

/** Call immediately BEFORE asking Supabase to sign out. */
export function markDeliberateSignOut(): void {
  deliberate = true;
}

/** Read and clear: the next session loss is judged on its own merits. */
export function consumeDeliberateSignOut(): boolean {
  const was = deliberate;
  deliberate = false;
  return was;
}
