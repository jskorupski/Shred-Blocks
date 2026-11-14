/**
 * Optional, offline-safe, zero-impact usage analytics loader (`ANALYTICS-01`).
 *
 * Design invariants:
 * 1. **Fork-Clean Opt-In**: Disabled (`0` timers, `0` listeners, `0` external requests) unless
 *    `VITE_GA_MEASUREMENT_ID` (or `VITE_CF_BEACON_TOKEN`) is supplied at build time.
 * 2. **Game Performance First**: Never runs during boot, shader warm-up, modal pre-warming, or active
 *    pointer drags. Defers until `window.load` + `2,000ms` + `requestIdleCallback` with `fetchPriority="low"`.
 * 3. **100% Offline & Blocker Safe**: Skips script creation while `navigator.onLine === false` (attaching
 *    a passive one-shot `online` listener instead) and swallows all network/blocker/CSP errors silently.
 * 4. **Privacy-Minimal (`LUDO-CORE-01`)**: Built-in visit/engagement counts only; disables Google Signals
 *    and ad personalization, and never reads or transmits player save data.
 */

declare const __SHREDBLOCKS_GA_ID__: string | undefined;
declare const __SHREDBLOCKS_CF_TOKEN__: string | undefined;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export const ANALYTICS_BOOT_SETTLE_MS = 2_000;
export const GA4_SCRIPT_ID = 'sb-ga4-script';
export const CF_BEACON_SCRIPT_ID = 'sb-cf-beacon-script';

const GA_MEASUREMENT_ID_RE = /^G-[A-Z0-9]{4,20}$/i;
const CF_BEACON_TOKEN_RE = /^[a-f0-9]{32}$/i;

export interface AnalyticsRuntimeConfig {
  gaId: string;
  cfBeaconToken: string;
}

/** Validates a GA4 Measurement ID (`G-XXXXXXXXXX`), returning `''` for unset or malformed values. */
export function normalizeGaMeasurementId(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || !GA_MEASUREMENT_ID_RE.test(trimmed)) return '';
  return trimmed.toUpperCase();
}

/** Validates a 32-hex Cloudflare Web Analytics beacon token, returning `''` if unset or malformed. */
export function normalizeCfBeaconToken(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || !CF_BEACON_TOKEN_RE.test(trimmed)) return '';
  return trimmed.toLowerCase();
}

/** Reads compile-time analytics identifiers injected by `vite.config.ts`. */
export function getCompiledAnalyticsConfig(): AnalyticsRuntimeConfig {
  const rawGa = typeof __SHREDBLOCKS_GA_ID__ === 'string' ? __SHREDBLOCKS_GA_ID__ : '';
  const rawCf = typeof __SHREDBLOCKS_CF_TOKEN__ === 'string' ? __SHREDBLOCKS_CF_TOKEN__ : '';
  return {
    gaId: normalizeGaMeasurementId(rawGa),
    cfBeaconToken: normalizeCfBeaconToken(rawCf),
  };
}

/**
 * Injects configured async analytics `<script>` tags into `<head>` with silent error isolation.
 * Exposed for deterministic unit testing.
 */
export function injectAnalyticsScriptsNow(config: AnalyticsRuntimeConfig = getCompiledAnalyticsConfig()): {
  gaInjected: boolean;
  cfInjected: boolean;
} {
  const gaId = normalizeGaMeasurementId(config.gaId);
  const cfBeaconToken = normalizeCfBeaconToken(config.cfBeaconToken);
  let gaInjected = false;
  let cfInjected = false;

  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.head) {
    return { gaInjected, cfInjected };
  }

  if (gaId) {
    try {
      if (!document.getElementById(GA4_SCRIPT_ID)) {
        const dataLayer = window.dataLayer ?? [];
        window.dataLayer = dataLayer;
        if (typeof window.gtag !== 'function') {
          window.gtag = function gtag(..._args: unknown[]): void {
            // gtag.js requires genuine IArguments entries in window.dataLayer (plain arrays are ignored).
            dataLayer.push(arguments);
          };
        }
        window.gtag('js', new Date());
        window.gtag('config', gaId, {
          send_page_view: true,
          allow_google_signals: false,
          allow_ad_personalization_signals: false,
        });

        const gaScript = document.createElement('script');
        gaScript.id = GA4_SCRIPT_ID;
        gaScript.async = true;
        gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
        if ('fetchPriority' in gaScript) {
          (gaScript as HTMLScriptElement & { fetchPriority: string }).fetchPriority = 'low';
        }
        gaScript.onerror = () => {
          gaScript.remove();
        };
        document.head.appendChild(gaScript);
        gaInjected = true;
      }
    } catch {
      // Never allow analytics initialization to throw or affect the game.
    }
  }

  if (cfBeaconToken) {
    try {
      // Skip if Cloudflare's proxy already auto-injected beacon.min.js into HTML at the edge.
      const existingCf =
        document.getElementById(CF_BEACON_SCRIPT_ID) ??
        document.querySelector('script[src*="cloudflareinsights.com/beacon"]');
      if (!existingCf) {
        const cfScript = document.createElement('script');
        cfScript.id = CF_BEACON_SCRIPT_ID;
        cfScript.async = true;
        cfScript.src = 'https://static.cloudflareinsights.com/beacon.min.js';
        cfScript.setAttribute('data-cf-beacon', JSON.stringify({ token: cfBeaconToken }));
        if ('fetchPriority' in cfScript) {
          (cfScript as HTMLScriptElement & { fetchPriority: string }).fetchPriority = 'low';
        }
        cfScript.onerror = () => {
          cfScript.remove();
        };
        document.head.appendChild(cfScript);
        cfInjected = true;
      }
    } catch {
      // Never allow analytics initialization to throw or affect the game.
    }
  }

  return { gaInjected, cfInjected };
}

/**
 * Schedules low-priority analytics initialization strictly after boot, idle UI pre-warming,
 * online connectivity verification, and pointer inactivity.
 */
export function scheduleIdleAnalyticsInit(
  isInteractiveBusy: () => boolean = () => false,
  config: AnalyticsRuntimeConfig = getCompiledAnalyticsConfig()
): void {
  const gaId = normalizeGaMeasurementId(config.gaId);
  const cfBeaconToken = normalizeCfBeaconToken(config.cfBeaconToken);
  if (!gaId && !cfBeaconToken) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  let initialized = false;
  let waitingForOnline = false;

  const scheduleIdleAttempt = (delayMs: number) => {
    window.setTimeout(() => {
      if (initialized) return;
      const runInIdle = () => {
        if (initialized) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          if (!waitingForOnline) {
            waitingForOnline = true;
            window.addEventListener(
              'online',
              () => {
                waitingForOnline = false;
                scheduleIdleAttempt(1_000);
              },
              { once: true, passive: true }
            );
          }
          return;
        }
        if (isInteractiveBusy()) {
          scheduleIdleAttempt(ANALYTICS_BOOT_SETTLE_MS);
          return;
        }
        initialized = true;
        injectAnalyticsScriptsNow({ gaId, cfBeaconToken });
      };

      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(runInIdle, { timeout: 5_000 });
      } else {
        window.setTimeout(runInIdle, 250);
      }
    }, delayMs);
  };

  if (document.readyState === 'complete') {
    scheduleIdleAttempt(ANALYTICS_BOOT_SETTLE_MS);
  } else {
    window.addEventListener(
      'load',
      () => {
        scheduleIdleAttempt(ANALYTICS_BOOT_SETTLE_MS);
      },
      { once: true, passive: true }
    );
  }
}
