import { useEffect, useRef } from "react";

// Cloudflare Turnstile site key (public). When absent, CAPTCHA is OFF client-side
// and the widget renders nothing — so local/dev builds, and any deploy where you
// haven't enabled Supabase CAPTCHA, behave exactly as before. Set this ONLY once
// CAPTCHA is enabled in Supabase Auth, or every auth call will demand a token.
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
export const captchaEnabled = Boolean(TURNSTILE_SITE_KEY);

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
  reset: (id?: string) => void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

// Load the Turnstile script once, shared across every widget instance.
let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Turnstile failed to load"));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

interface Props {
  /** Fires with a fresh token when the challenge is solved, or null when it
   *  expires/errors. Tokens are single-use — remount (bump a `key`) after each
   *  auth attempt to get a new one. */
  onToken: (token: string | null) => void;
}

/** A Cloudflare Turnstile widget. Renders nothing when no site key is set. */
export function Turnstile({ onToken }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const host = ref.current;
    if (!host) return;
    let id: string | null = null;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile || !host) return;
        id = window.turnstile.render(host, {
          sitekey: TURNSTILE_SITE_KEY,
          callback: (t: string) => cb.current(t),
          "expired-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (id && window.turnstile) {
        try { window.turnstile.remove(id); } catch { /* already gone */ }
      }
    };
  }, []);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={ref} className="turnstile" />;
}
