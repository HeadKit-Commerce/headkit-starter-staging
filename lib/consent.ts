/**
 * The consent model: what a visitor can choose, what that means to Google, and
 * how the choice is written into the dataLayer.
 *
 * Everything here is PURE (no `window`, no storage) so it is testable in this
 * app's default `node` vitest environment. The browser half — reading and
 * writing the stored decision, and notifying subscribers — is
 * `lib/consent-store.ts`.
 *
 * PER-STORE, AND OFF UNLESS THE MERCHANT TURNS IT ON. Nothing in this module
 * runs unless `storeSettings.cookieConsentEnabled` is true; the root layout
 * and `DeferredThirdPartyScripts` both gate on it, and a store with the field
 * absent behaves exactly as it did before this feature existed. See
 * `lib/branding.ts` for how the flag is read and why absent means off.
 *
 * WHY THIS EXISTS AT ALL. Google's advertising tags set `test_cookie` on
 * `.doubleclick.net`, which fails Lighthouse's `third-party-cookies` audit and
 * `inspector-issues` with it — 6 of 26 weighted points. Under Consent Mode v2
 * with `ad_storage: "denied"` the request that sets it is never made; a
 * cookieless `pagead2.googlesyndication.com/ccm/collect` ping replaces it and
 * sets nothing.
 *
 * This code was built and measured on the Bike Society store fork
 * (`tigerheart-studios/bikesociety-v2` PR #75, merged 2026-09-23) before being
 * ported here. Five arms, fresh Chrome profile each, mobile emulation, against
 * a running storefront: Best Practices 0.77 with the tag ungated and the
 * cookie present; 1.00 with the denied default and no cookie; 1.00 after
 * declining; 0.77 again the moment consent is granted and the cookie comes
 * back. The last of those is the control that proves the gate is honest rather
 * than a trick — a visitor who accepts gets the cookie and the attribution,
 * and Lighthouse only ever sees the pre-choice state because it runs a clean
 * profile and never clicks anything. That PR body carries the full table, the
 * byte-identical `Set-Cookie`, and where the numbers stop.
 *
 * It is NOT a compliance feature and must not be described as one. Australian
 * and New Zealand law require no cookie banner. This exists so a European or
 * Californian tenant has the capability on day one — where Consent Mode v2 is
 * the operative requirement for a Google Ads advertiser — and so a store that
 * wants the Lighthouse points can have them.
 *
 * TWO RULES THAT FOLLOW FROM THAT MEASUREMENT AND ARE NOT NEGOTIABLE:
 *
 *  1. **The banner may never auto-accept** — not on a timer, not on scroll,
 *     not on any gesture that is not a press of the accept control. Any of
 *     those puts the grant inside Lighthouse's observation window and hands
 *     the points straight back. It is also the only honest design, so the
 *     constraint costs nothing.
 *  2. **Consent is never read on the server.** A `cookies()` / `headers()`
 *     read in the root layout is a request-time read, and AGENTS.md records
 *     what one costs there: every route loses its static shell. A consent
 *     banner is exactly the feature that invites that mistake. The measured
 *     cost on the fork was +1.4 s on a 27 KB page.
 */

/**
 * The href any anchor uses to re-open the banner. `ConsentBanner` claims every
 * `a[href="#cookie-settings"]` in the document through one delegated listener,
 * so a server-rendered link (the footer) and a WordPress menu item both work
 * with no client code of their own. It lives HERE rather than in the component
 * so a server component can name it without importing a client module.
 */
export const CONSENT_REOPEN_HREF = "#cookie-settings";

export const CONSENT_CATEGORIES = ["analytics", "advertising"] as const;

export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

/** What the visitor allowed, per category. */
export type ConsentChoices = Record<ConsentCategory, boolean>;

export type ConsentDecision = {
  /** Bumped when the categories change meaning; an older record is re-asked. */
  version: number;
  /** ISO timestamp of the press that made the decision. */
  at: string;
  choices: ConsentChoices;
};

/**
 * Bumping this re-opens the banner for every returning visitor, so bump it
 * only when the CHOICES change meaning — a new category, or an existing one
 * starting to gate something materially different.
 */
export const CONSENT_VERSION = 1;

export const CONSENT_STORAGE_KEY = "headkit:consent";

export const CONSENT_ALL_DENIED: ConsentChoices = Object.freeze({
  analytics: false,
  advertising: false,
});

export const CONSENT_ALL_GRANTED: ConsentChoices = Object.freeze({
  analytics: true,
  advertising: true,
});

/**
 * The seven Google consent signals. All four of the v2 advertising/analytics
 * signals are gated; `security_storage` is always granted because it covers
 * spam and fraud protection, which is not a marketing purpose and which Google
 * documents as exempt.
 */
export type ConsentSignals = {
  ad_storage: "granted" | "denied";
  ad_user_data: "granted" | "denied";
  ad_personalization: "granted" | "denied";
  analytics_storage: "granted" | "denied";
  functionality_storage: "granted" | "denied";
  personalization_storage: "granted" | "denied";
  security_storage: "granted" | "denied";
};

function signal(granted: boolean): "granted" | "denied" {
  return granted ? "granted" : "denied";
}

/** Map the visitor's two categories onto Google's seven signals. */
export function consentSignals(choices: ConsentChoices): ConsentSignals {
  const ads = signal(choices.advertising);
  const analytics = signal(choices.analytics);
  return {
    ad_storage: ads,
    ad_user_data: ads,
    ad_personalization: ads,
    analytics_storage: analytics,
    // Neither is a Google *advertising* signal, but both are storage the
    // visitor did not ask for; they follow the analytics choice because that
    // is the category whose description covers "remembering what you did".
    functionality_storage: analytics,
    personalization_storage: analytics,
    security_storage: "granted",
  };
}

/** The signals for a visitor who has not chosen yet. */
export const CONSENT_DEFAULT_SIGNALS: ConsentSignals =
  consentSignals(CONSENT_ALL_DENIED);

function isConsentChoices(value: unknown): value is ConsentChoices {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return CONSENT_CATEGORIES.every(
    (category) => typeof record[category] === "boolean",
  );
}

/**
 * Parse a stored record. Anything unreadable, or written by an older
 * CONSENT_VERSION, is treated as "no decision" so the visitor is asked again —
 * never as an implied grant.
 */
export function parseStoredConsent(raw: string | null): ConsentDecision | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (record["version"] !== CONSENT_VERSION) return null;
  if (!isConsentChoices(record["choices"])) return null;
  return {
    version: CONSENT_VERSION,
    at: typeof record["at"] === "string" ? record["at"] : "",
    choices: {
      analytics: record["choices"].analytics,
      advertising: record["choices"].advertising,
    },
  };
}

export function serializeConsent(decision: ConsentDecision): string {
  return JSON.stringify(decision);
}

/**
 * Push a consent command into the dataLayer.
 *
 * THE SHAPE IS THE WHOLE POINT, and getting it wrong is a silent no-op.
 * The tag platform reads the consent API from `arguments` OBJECTS
 * specifically; a plain array is passed through as an ordinary dataLayer
 * message and ignored. Measured on the fork:
 * `dataLayer.push(["consent","default",{…}])` sets `test_cookie` on
 * `.doubleclick.net` anyway, with no error, no warning, and a dataLayer that
 * reads correctly in the console.
 *
 * This is the trap to reach for the local idiom on: `GoogleTagManager` pushes
 * `gtm.start` as a plain object from its inline script, and that is correct
 * for that message and wrong for this one. The loader pushes this command
 * before that component mounts, so the default precedes `gtm.start`.
 * `lib/consent.test.ts` asserts the pushed value is `arguments`-shaped, because
 * a test that only checks the payload's contents is green under the bug.
 */
export function pushConsentCommand(
  dataLayer: unknown[],
  command: "default" | "update",
  signals: ConsentSignals,
): void {
  function gtag(): void {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  }
  (gtag as (...args: unknown[]) => void)("consent", command, signals);
}
