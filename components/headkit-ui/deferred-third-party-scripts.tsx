"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { GoogleTagManager } from "@next/third-parties/google";
import Script from "next/script";

import {
  consentSignals,
  pushConsentCommand,
  type ConsentDecision,
} from "@/lib/consent";
import { readConsent, subscribeConsent } from "@/lib/consent-store";

type Props = {
  gtmId?: string | null | undefined;
  klaviyoPublicKey?: string | null | undefined;
  hubspotPortalId?: string | null | undefined;
  /**
   * Store cookie-consent gate. Absent means off: the visit is tagged with
   * no consent command and no gesture.
   */
  consentEnabled?: boolean | undefined;
};

function decisionAllowsTags(decision: ConsentDecision | null): boolean {
  if (!decision) return false;
  return decision.choices.analytics || decision.choices.advertising;
}

/**
 * Marketing tags for every storefront. One file; store differences are props.
 *
 * Google Tag Manager is `GoogleTagManager` from `@next/third-parties/google`.
 * https://nextjs.org/docs/app/guides/third-party-libraries
 *
 * The package loads `gtm.js` through `next/script` with the default
 * `afterInteractive` strategy (after some hydration, no `strategy` prop).
 * A visit is tagged with no gesture. When this store's cookie gate is on,
 * the container stays unmounted until the visitor accepts — a decline or
 * an unanswered banner does not tag the visit.
 *
 * The package's `dataLayer` prop is JSON and is pushed after `gtm.start`,
 * which Consent Mode does not read. The accept path pushes an `arguments`
 * default before this component mounts `GoogleTagManager`.
 *
 * Klaviyo and HubSpot are not in `@next/third-parties`. They use
 * `next/script` with `lazyOnload` on the same schedule as the container.
 */
export function DeferredThirdPartyScripts({
  gtmId,
  klaviyoPublicKey,
  hubspotPortalId,
  consentEnabled = false,
}: Props): ReactElement | null {
  const [accepted, setAccepted] = useState(false);
  const pushedDefault = useRef(false);

  useEffect(() => {
    if (!consentEnabled) return;

    const apply = (): void => {
      const decision = readConsent();
      const dataLayer = (window.dataLayer = window.dataLayer ?? []);
      if (!decision || !decisionAllowsTags(decision)) {
        if (pushedDefault.current && decision) {
          pushConsentCommand(
            dataLayer,
            "update",
            consentSignals(decision.choices),
          );
        }
        return;
      }
      if (!pushedDefault.current) {
        pushConsentCommand(
          dataLayer,
          "default",
          consentSignals(decision.choices),
        );
        pushedDefault.current = true;
        setAccepted(true);
        return;
      }
      pushConsentCommand(dataLayer, "update", consentSignals(decision.choices));
    };

    apply();
    return subscribeConsent(apply);
  }, [consentEnabled]);

  const mountTags = !consentEnabled || accepted;
  if (!mountTags) return null;
  if (!gtmId && !klaviyoPublicKey && !hubspotPortalId) return null;

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
