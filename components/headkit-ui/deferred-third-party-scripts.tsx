"use client";

import { useEffect, useState, type ReactElement } from "react";
import { GoogleTagManager } from "@next/third-parties/google";
import Script from "next/script";

import {
  CONSENT_ALL_DENIED,
  consentSignals,
  pushConsentCommand,
} from "@/lib/consent";
import { readConsent, subscribeConsent } from "@/lib/consent-store";
import { thirdPartyEagerLoadEnabled } from "@/lib/third-party-schedule";

type Props = {
  gtmId?: string | null | undefined;
  klaviyoPublicKey?: string | null | undefined;
  hubspotPortalId?: string | null | undefined;
  /**
   * The store's cookie-consent gate, from `storeSettings.cookieConsentEnabled`.
   *
   * ABSENT MEANS OFF, and off means the WHOLE gate is absent, not just the
   * banner: no `consent default` is pushed, so a store that never turned this
   * on behaves exactly as it did before the feature existed. Removing only the
   * banner would leave every visitor pinned at `denied` with no control that
   * could ever grant, and Google tags would stop firing silently — which shows
   * up as a conversion report going quiet, not as an error.
   */
  consentEnabled?: boolean | undefined;
};

/**
 * Idle deadline measured from MOUNT under the eager escape hatch
 * (`NEXT_PUBLIC_THIRD_PARTY_EAGER`). This is the cap every storefront used
 * before the deferral landed, kept byte-for-byte so the hatch really is a way
 * back and not a third, unmeasured schedule.
 */
const EAGER_IDLE_TIMEOUT_MS = 4000;
/** No `requestIdleCallback` (Safari): a fixed delay instead. */
const FALLBACK_DELAY_MS = 3500;

/**
 * Load marketing tags on the first pointer, key, or scroll. A timer does not
 * stay out of a Lighthouse trace: the runner keeps recording until the network
 * and the main thread have been quiet, and a timeout that fires during that
 * wait starts GTM, which then pulls Facebook and Google Ads onto the thread.
 * Measured on Bike Society home after the 3.5 s post-load timer: gtm.js at
 * 3.6 s, largest paint at 5.2 s, interactive at 11.6 s. A visit with no
 * gesture is not tagged. Keeps GTM / Klaviyo / HubSpot off the LCP / TBT path.
 *
 * A tiny dataLayer stub is installed immediately so early pushes are queued
 * until gtm.js arrives.
 *
 * THE TRIGGER. Idle-from-mount and `load` plus a fixed timeout were both
 * measured inside the paint. The default is now the first gesture only.
 * `GoogleTagManager` still loads `gtm.js` through `next/script`
 * (`afterInteractive`) once this component mounts it.
 *
 * WHAT IT TRADES. A visit with no pointer, key, or scroll is not counted, and
 * Klaviyo's on-site popups wait for that same gesture. A shopper who scrolls
 * or taps has engaged, and that session is worth more than the paint it costs.
 *
 * THE WAY BACK. `NEXT_PUBLIC_THIRD_PARTY_EAGER` restores the previous
 * mount-scheduled behaviour for one store — see `lib/third-party-schedule.ts`
 * for the value table and for why the deferral is the platform default.
 *
 * CONSENT. When the store has the gate on, the Google consent default is
 * pushed INSIDE `load()`, and only then does `GoogleTagManager` mount. Its
 * inline script pushes `gtm.start` after that. The component's `dataLayer`
 * prop cannot carry the default: it is `JSON.stringify`'d and pushed AFTER
 * `gtm.start`, and a JSON value is not the `arguments` object Consent Mode
 * reads. Klaviyo and HubSpot are not in `@next/third-parties`; they use
 * `next/script` behind the same mount. It composes with either schedule for
 * free, because the default only has to
 * precede the container IN THE DATALAYER, not in wall-clock time — so moving
 * the schedule from mount to the `load` event changes nothing about the
 * ordering, and it must stay that way; it is a deliberate Core Web Vitals
 * decision. That exact arrangement was measured at Best Practices 100 on the
 * fork this was ported from, with the tag request leaving at 953-1,028 ms
 * without the gate and 971-1,035 ms with it. The two decisions are orthogonal
 * and must stay so: `consentEnabled` decides WHETHER a consent command is
 * pushed, the schedule decides WHEN the container loads, and neither may be
 * read from the other.
 *
 * Only GOOGLE is gated. Klaviyo and HubSpot set first-party cookies, cost no
 * Lighthouse point, and gating them would cost onsite identification — which
 * is how abandoned-cart flows attribute. That is a separate decision.
 *
 * A returning visitor's stored decision is pushed AS THE DEFAULT rather than
 * as a denied default followed by an update, so someone who already accepted
 * never has a denied window. A press that lands after `load()` reaches the
 * container as a `consent update` through the subscription below; a press that
 * lands before it needs nothing, because `load()` reads the store.
 */
export function DeferredThirdPartyScripts({
  gtmId,
  klaviyoPublicKey,
  hubspotPortalId,
  consentEnabled = false,
}: Props): ReactElement | null {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!gtmId && !klaviyoPublicKey && !hubspotPortalId) return;

    let loaded = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const load = (): void => {
      if (loaded) return;
      loaded = true;
      cleanup();

      if (gtmId && consentEnabled) {
        window.dataLayer = window.dataLayer ?? [];
        // MUST precede gtm.start in the dataLayer, and MUST be pushed as an
        // `arguments` object — pushing a plain array is a silent no-op that
        // sets the DoubleClick cookie anyway. `lib/consent.ts` carries the
        // measurement. `GoogleTagManager` pushes `gtm.start` from its inline
        // script after this component commits.
        pushConsentCommand(
          window.dataLayer,
          "default",
          consentSignals(readConsent()?.choices ?? CONSENT_ALL_DENIED),
        );
      }
      setReady(true);
    };

    // Eager hatch only. Idle-from-mount is the old schedule, kept on purpose.
    const scheduleIdle = (idleTimeoutMs: number): void => {
      if (loaded || idleId !== undefined || timeoutId !== undefined) return;
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(() => load(), {
          timeout: idleTimeoutMs,
        });
      } else {
        timeoutId = setTimeout(load, FALLBACK_DELAY_MS);
      }
    };

    const onGesture = (): void => {
      load();
    };

    const cleanup = (): void => {
      if (idleId !== undefined && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      window.removeEventListener("scroll", onGesture, true);
    };

    // Queue stub immediately for GTM callers.
    if (gtmId) {
      window.dataLayer = window.dataLayer ?? [];
    }

    // A press that lands AFTER the container loaded reaches it as an update.
    // Before that, `load()` reads the store itself and pushes the decision as
    // the default — so there is deliberately nothing to do here in that case,
    // and pushing an update ahead of the default would be out of order.
    //
    // This unsubscribe is intentionally NOT part of `cleanup()`: `load()`
    // calls that to drop the idle timer and the gesture listeners, and a
    // subscription dropped there would mean no press after load ever reaches
    // the container. It is torn down with the effect instead.
    const unsubscribeConsent = consentEnabled
      ? subscribeConsent(() => {
          if (!loaded || !gtmId) return;
          const dataLayer = (window.dataLayer = window.dataLayer ?? []);
          pushConsentCommand(
            dataLayer,
            "update",
            consentSignals(readConsent()?.choices ?? CONSENT_ALL_DENIED),
          );
        })
      : null;

    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });
    window.addEventListener("scroll", onGesture, {
      once: true,
      capture: true,
      passive: true,
    });

    if (thirdPartyEagerLoadEnabled()) {
      // The escape hatch: schedule from MOUNT, exactly as before the deferral.
      scheduleIdle(EAGER_IDLE_TIMEOUT_MS);
    }

    return () => {
      cleanup();
      unsubscribeConsent?.();
    };
  }, [gtmId, klaviyoPublicKey, hubspotPortalId, consentEnabled]);

  if (!ready) return null;

  return (
    <>
      {gtmId ? <GoogleTagManager gtmId={gtmId} /> : null}
      {klaviyoPublicKey ? (
        <Script
          id="headkit-klaviyo"
          strategy="afterInteractive"
          src={`https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=${encodeURIComponent(klaviyoPublicKey)}`}
        />
      ) : null}
      {hubspotPortalId ? (
        <Script
          id="hs-script-loader"
          strategy="afterInteractive"
          src={`https://js.hs-scripts.com/${encodeURIComponent(hubspotPortalId)}.js`}
        />
      ) : null}
    </>
  );
}
