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
   * pushed, and `GoogleTagManager` mounts on its own.
   */
  consentEnabled?: boolean | undefined;
};

/**
 * Marketing tags for every storefront. The file is shared; store differences
 * are props, not a fork.
 *
 * Google Tag Manager is `@next/third-parties/google` `GoogleTagManager`.
 * That component loads `gtm.js` with `next/script` after hydration:
 * https://nextjs.org/docs/app/guides/third-party-libraries
 *
 * Its `dataLayer` prop is `JSON.stringify`'d and pushed after `gtm.start`,
 * which Consent Mode does not read. When the gate is on, the default is
 * pushed as an `arguments` object before `GoogleTagManager` mounts.
 *
 * Klaviyo and HubSpot are not in `@next/third-parties`. They use
 * `next/script` with `afterInteractive` beside the Google component.
 */
export function DeferredThirdPartyScripts({
  gtmId,
  klaviyoPublicKey,
  hubspotPortalId,
  consentEnabled = false,
}: Props): ReactElement | null {
  const gate = Boolean(consentEnabled && gtmId);
  const [gtmReady, setGtmReady] = useState(!gate);

  useEffect(() => {
    if (!gtmId) return;
    window.dataLayer = window.dataLayer ?? [];
    if (!consentEnabled) {
      setGtmReady(true);
      return;
    }

    pushConsentCommand(
      window.dataLayer,
      "default",
      consentSignals(readConsent()?.choices ?? CONSENT_ALL_DENIED),
    );
    setGtmReady(true);

    return subscribeConsent(() => {
      const dataLayer = (window.dataLayer = window.dataLayer ?? []);
      pushConsentCommand(
        dataLayer,
        "update",
        consentSignals(readConsent()?.choices ?? CONSENT_ALL_DENIED),
      );
    });
  }, [gtmId, consentEnabled]);

  if (!gtmId && !klaviyoPublicKey && !hubspotPortalId) return null;

  return (
    <>
      {gtmId && gtmReady ? <GoogleTagManager gtmId={gtmId} /> : null}
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
