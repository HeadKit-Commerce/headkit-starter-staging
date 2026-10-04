"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getStripePromise } from "@/lib/stripe-js-singleton";
import {
  Elements,
  PaymentMethodMessagingElement,
} from "@stripe/react-stripe-js";
import {
  buildCheckoutAppearance,
  buildCheckoutFonts,
} from "@/lib/stripe-appearance";

/**
 * Currencies the Payment Method Messaging Element accepts — the full 12-member
 * union from `StripePaymentMethodMessagingElementOptions["currency"]`
 * (`@stripe/stripe-js` `payment-method-messaging.d.ts`). This gate exists purely
 * to avoid downloading ~247 KB of Stripe.js on a storefront where no plan could
 * ever be eligible. Stripe still makes the final eligibility decision.
 */
const VALID_CURRENCIES = [
  "AUD",
  "CAD",
  "CHF",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "NOK",
  "NZD",
  "PLN",
  "SEK",
  "USD",
] as const;

type ValidCurrency = (typeof VALID_CURRENCIES)[number];

/**
 * Minimum painted height, in px, that counts as a real BNPL message rather than
 * an empty element — see {@link PaymentMethodMessaging}'s `painted` state.
 *
 * Chosen from measurement, not taste: a no-provider account paints 9 px, a real
 * one-line badge paints 40 px. 16 px sits above the sliver and below any single
 * line of rendered text, so it separates the two without clipping a genuine
 * message. Raise it only with a fresh measurement.
 */
const MIN_PAINTED_HEIGHT_PX = 16;

function isValidCurrency(currency: string): currency is ValidCurrency {
  return (VALID_CURRENCIES as readonly string[]).includes(currency);
}

export interface PaymentMethodMessagingProps {
  /** Price in major units for the CURRENTLY SELECTED variant (e.g. 9.99). */
  price: number;
  /** ISO 4217 currency code. */
  currency: string;
  publishableKey: string;
  /** Connect account id. Required for direct-charge platforms — see below. */
  stripeAccountId?: string | null | undefined;
  /** The store's dashboard toggle. */
  enabled: boolean;
  /** True when the product cannot be bought (out of stock). */
  disabled?: boolean;
}

/** Pure gate, exported for test. Cheap checks only — no Stripe involvement. */
export function shouldRenderMessaging(a: {
  publishableKey: string;
  currency: string;
  enabled: boolean;
  disabled?: boolean;
  /** Required so Shopify / no-Connect stores never download Stripe.js. */
  stripeAccountId?: string | null | undefined;
}): boolean {
  if (!a.enabled || a.disabled) return false;
  if (!a.publishableKey) return false;
  if (!a.stripeAccountId?.startsWith("acct_")) return false;
  return isValidCurrency(a.currency.toUpperCase());
}

/**
 * Stripe's Payment Method Messaging Element — the "4 interest-free payments of
 * $X" badge.
 *
 * TWO THINGS HERE ARE LATE-BOUND ON PURPOSE.
 *
 * 1. `paymentMethodTypes` is NOT passed. Stripe's docs: "If you use Dynamic
 *    payment methods, the Payment Method Messaging Element automatically pulls
 *    your payment method preferences from the Stripe Dashboard." Commerce runs
 *    dynamic payment methods, so omitting the option is what makes this badge
 *    reflect the MERCHANT's own enabled providers, currency and amount. Every
 *    previous HeadKit implementation passed ["klarna","afterpay_clearpay",
 *    "affirm"], which silently opted out of exactly that. The option is
 *    optional in `StripePaymentMethodMessagingElementOptions`, so it is simply
 *    omitted rather than passed as `undefined`.
 *
 * 2. `stripeAccount` IS passed. Commerce creates DIRECT charges on the connected
 *    account, and Stripe requires direct-charge platforms to identify the
 *    account that renders this element. Without it the badge would describe the
 *    PLATFORM's payment methods, not the merchant's.
 *
 * `countryCode` is deliberately omitted — it is optional and Stripe infers the
 * buyer's country, which is more accurate than anything we could pass.
 *
 * CORE WEB VITALS. Stripe.js is ~247 KB and this badge is decorative, so it must
 * never compete with hydration or LCP. An earlier integration was withdrawn for
 * exactly that reason; it used dynamic import + a Suspense skeleton but still
 * requested Stripe.js from a mount effect, i.e. in the initial burst.
 *
 * BE PRECISE ABOUT WHAT THE OBSERVER BUYS. It does NOT wait for a scroll. The
 * badge often sits under the price, above the fold, and `rootMargin` is 200px,
 * so `observe()` would otherwise fire on the first frame of hydration. The
 * effect waits for `load` (eager images, including LCP, are in that set) and
 * then an idle callback before it observes. A badge far down the page still
 * costs nothing until it is approached. It is not `next/script`: Stripe.js is
 * loaded by `loadStripe` from `@stripe/stripe-js/pure`, which does not inject
 * the script on import.
 *
 * EMPTY STATE. Stripe renders nothing when no plan is eligible — verified live:
 * an account with no eligible provider produces a host div of height 0 and no
 * iframe at all. So neither height NOR margin may be reserved up front; the
 * spacing below is applied only once Stripe has actually painted something.
 */
export function PaymentMethodMessaging({
  price,
  currency,
  publishableKey,
  stripeAccountId,
  enabled,
  disabled = false,
}: PaymentMethodMessagingProps): React.ReactElement | null {
  const gate = shouldRenderMessaging({
    publishableKey,
    currency,
    enabled,
    disabled,
    stripeAccountId,
  });

  const hostRef = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);

  // Stripe.js is hundreds of kilobytes. An above-the-fold badge intersects on
  // the first frame of hydration, which pulls that script into the LCP window.
  // `load` already waited for the eager images, then idle lets the paint finish.
  useEffect(() => {
    if (!gate || near) return;
    const node = hostRef.current;
    if (!node) return;

    let cancelled = false;
    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let io: IntersectionObserver | undefined;

    const observe = (): void => {
      if (cancelled) return;
      if (typeof IntersectionObserver === "undefined") {
        setNear(true);
        return;
      }
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            setNear(true);
            io?.disconnect();
          }
        },
        { rootMargin: "200px" },
      );
      io.observe(node);
    };

    const start = (): void => {
      if (typeof window.requestIdleCallback === "function") {
        idleId = window.requestIdleCallback(observe, { timeout: 2000 });
      } else {
        timeoutId = setTimeout(observe, 1500);
      }
    };

    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
      if (
        idleId !== undefined &&
        typeof window.cancelIdleCallback === "function"
      ) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      io?.disconnect();
    };
  }, [gate, near]);

  /**
   * True once Stripe has painted a real MESSAGE into the host — not merely
   * something.
   *
   * Stripe decides eligibility server-side, and there are three distinct
   * outcomes, all measured live against the real API:
   *
   * | outcome                                   | iframe | host |
   * |-------------------------------------------|--------|------|
   * | request rejected (bad account, bad geo)   | none   |  0px |
   * | accepted, but NO provider enabled         |  9px   |  1px |
   * | accepted, Afterpay + Klarna eligible      | 48px   | 40px |
   *
   * The middle row is why a bare `> 0` test is wrong: an account with the
   * toggle on but no BNPL provider enabled paints a 9 px sliver that shows the
   * shopper nothing, yet would claim the full 24 px margin below. Since the
   * element is a cross-origin iframe we cannot inspect, painted height is the
   * only signal available — so the threshold has to sit between "sliver" and
   * "line of text" rather than at zero.
   */
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    // ResizeObserver delivers an initial callback on observe(), so the current
    // size is picked up without a synchronous setState in the effect body.
    const ro = new ResizeObserver(() =>
      setPainted(node.offsetHeight >= MIN_PAINTED_HEIGHT_PX),
    );
    ro.observe(node);
    return () => ro.disconnect();
  }, [gate, near, price]);

  const stripePromise = useMemo(() => {
    if (!gate || !near) return null;
    return getStripePromise(publishableKey, {
      ...(stripeAccountId ? { stripeAccount: stripeAccountId } : {}),
    });
  }, [gate, near, publishableKey, stripeAccountId]);

  const appearance = useMemo(() => buildCheckoutAppearance(), []);
  // Same pairing as checkout: the appearance names the brand family, this is
  // what lets the Stripe iframe load it. Without it the badge renders in the
  // system stack while the price above it renders in the brand face.
  const fonts = useMemo(() => buildCheckoutFonts(), []);

  if (!gate) return null;

  const normalizedCurrency = currency.toUpperCase();
  if (!isValidCurrency(normalizedCurrency)) return null;

  const hasAmount = price > 0;

  // The host div is always present once gated in, so the observer has something
  // to watch. It has no height of its own until Stripe fills it, and it carries
  // its bottom margin ONLY once Stripe has actually PAINTED something — see
  // {@link painted}. Keying the margin off `stripePromise` instead would still
  // reserve 24 px on an account with no eligible provider, which is the common
  // case and exactly what the collapsing empty state exists to avoid.
  return (
    <div
      ref={hostRef}
      data-testid="bnpl-messaging"
      className={painted ? "mb-6" : undefined}
    >
      {stripePromise && hasAmount ? (
        <Elements
          stripe={stripePromise}
          options={{
            appearance,
            fonts,
            currency: normalizedCurrency.toLowerCase(),
          }}
        >
          <PaymentMethodMessagingElement
            options={{
              amount: Math.round(price * 100),
              currency: normalizedCurrency,
            }}
          />
        </Elements>
      ) : null}
    </div>
  );
}
