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

type Props = {
  gtmId?: string | null | undefined;
  klaviyoPublicKey?: string | null | undefined;
  hubspotPortalId?: string | null | undefined;
  /**
   * Store cookie-consent gate. Absent means off: no consent default is
   * pushed.
   */
  consentEnabled?: boolean | undefined;
};

/**
 * Marketing tags for every storefront. One file; store differences are props.
 *
 * Google Tag Manager is `GoogleTagManager` from `@next/third-parties/google`.
 * https://nextjs.org/docs/app/guides/third-party-libraries
 *
 * That component loads `gtm.js` through `next/script` after hydration
 * (`afterInteractive`). Measured on the deployed stores, that starts the
 * container at about 250 ms, and the container then loads Facebook and
 * Google Ads before the hero paints. Largest paint went to 9–11 s.
 *
 * `next/script` documents `lazyOnload` as the strategy that waits until the
 * page has fetched its own resources and the browser is idle
 * (https://nextjs.org/docs/app/api-reference/components/script#lazyonload).
 * The package does not accept a `strategy` prop, and idle-after-load was
 * measured in the same gap as the largest paint. The component is therefore
 * mounted on the first pointer, key, or scroll: a real session that engages,
 * and not a timer that Lighthouse waits out and then records. A visit with
 * no gesture is not tagged.
 *
 * The package's `dataLayer` prop is JSON and is pushed after `gtm.start`,
 * which Consent Mode does not read. When the gate is on, the default is
 * pushed as an `arguments` object in the gesture handler, before this
 * component mounts `GoogleTagManager`.
 *
 * Klaviyo and HubSpot are not in `@next/third-parties`. They use
 * `next/script` with `lazyOnload` on that same gesture.
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

    const load = (): void => {
      if (loaded) return;
      loaded = true;
      cleanup();
      if (gtmId) {
        window.dataLayer = window.dataLayer ?? [];
        if (consentEnabled) {
          pushConsentCommand(
            window.dataLayer,
            "default",
            consentSignals(readConsent()?.choices ?? CONSENT_ALL_DENIED),
          );
        }
      }
      setReady(true);
    };

    const cleanup = (): void => {
      window.removeEventListener("pointerdown", load);
      window.removeEventListener("keydown", load);
      window.removeEventListener("scroll", load, true);
    };

    window.addEventListener("pointerdown", load, { once: true });
    window.addEventListener("keydown", load, { once: true });
    window.addEventListener("scroll", load, {
      once: true,
      capture: true,
      passive: true,
    });

    const unsubscribe =
      consentEnabled && gtmId
        ? subscribeConsent(() => {
            if (!loaded) return;
            const dataLayer = (window.dataLayer = window.dataLayer ?? []);
            pushConsentCommand(
              dataLayer,
              "update",
              consentSignals(readConsent()?.choices ?? CONSENT_ALL_DENIED),
            );
          })
        : null;

    return () => {
      cleanup();
      unsubscribe?.();
    };
  }, [gtmId, klaviyoPublicKey, hubspotPortalId, consentEnabled]);

  if (!ready) return null;

  return (
    <>
      {gtmId ? <GoogleTagManager gtmId={gtmId} /> : null}
      {klaviyoPublicKey ? (
        <Script
          id="headkit-klaviyo"
          strategy="lazyOnload"
          src={`https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=${encodeURIComponent(klaviyoPublicKey)}`}
        />
      ) : null}
      {hubspotPortalId ? (
        <Script
          id="hs-script-loader"
          strategy="lazyOnload"
          src={`https://js.hs-scripts.com/${encodeURIComponent(hubspotPortalId)}.js`}
        />
      ) : null}
    </>
  );
}
