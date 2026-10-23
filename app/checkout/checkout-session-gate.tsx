import { redirect } from "next/navigation";
import { correctCartAtEntry, type EntryCart } from "@/lib/checkout-stock-entry";
import { isCartItemUnavailableError } from "@/lib/cart-issues";
import { bagUrl, type StockAlert } from "@/lib/stock-hold";
import {
  createCheckoutSessionAction,
  type CheckoutSessionResult,
} from "./actions";
import { CheckoutPageContent } from "./checkout-page-content";
import type { CartFieldsFragment } from "@headkit/sdk";
import { getFullCartAction } from "@/lib/cart-actions";
import { getFloatVal } from "@/lib/utils";
import { createServerHeadkit } from "@/lib/sdk.server";
import { CheckoutTestModeBanner } from "@/components/checkout/test-mode-banner";
import { isOfflineOnlyCart } from "@/lib/payment-gateways";
import {
  checkoutBannerMessage,
  checkoutFailurePath,
  logCheckoutFailure,
} from "@/lib/checkout-failure";

type CheckoutSessionProp = {
  clientSecret: string;
  sessionId: string;
  publishableKey: string;
  stripeAccountId?: string | null;
  testMode?: boolean;
  shippingOptionMapping?: Array<{
    rateId: string;
    stripeShippingRateId: string;
  }> | null;
};

export type CheckoutSessionGateProps = {
  cart: EntryCart;
  stockAlerts: StockAlert[];
  returnUrl: string;
  successBaseUrl?: string;
  customerEmail?: string;
  isAuthenticated: boolean;
  bnplMessagingEnabled: boolean;
  arrivedFromFailure: boolean;
  /** Incoming `?error=` reason, for loop-guard banner copy. */
  error?: string;
};

/**
 * Mints the Stripe Checkout Session (and loads pickup locations) behind the
 * page's Suspense boundary so {@link CheckoutPendingShell} can paint the
 * known cart + step titles first.
 */
export async function CheckoutSessionGate({
  cart: entryCart,
  stockAlerts,
  returnUrl,
  successBaseUrl,
  customerEmail,
  isAuthenticated,
  bnplMessagingEnabled,
  arrivedFromFailure,
  error,
}: CheckoutSessionGateProps): Promise<React.ReactElement> {
  let cart = entryCart;

  let checkoutSession: CheckoutSessionProp | null = null;
  // ENG-838: settled-free carts must NOT create a session on view — see page.tsx.
  const zeroTotal = getFloatVal(cart.totals.totalPrice ?? "0") <= 0;
  const shippingSettled =
    !cart.needsShipping ||
    (cart.shippingRates ?? []).some((pkg) =>
      (pkg?.shippingRates ?? []).some((rate) => rate?.selected),
    );
  const isSettledFreeCart = zeroTotal && shippingSettled;
  const offlineOnly = isOfflineOnlyCart(cart.paymentMethods);

  let sessionFailure: "invalid_session" | "session_creation_failed" | null =
    null;

  const createSession = async (
    forCart: EntryCart,
  ): Promise<
    | { ok: true; session: CheckoutSessionResult }
    | { ok: false; error: unknown }
  > => {
    try {
      const session = await createCheckoutSessionAction(
        returnUrl,
        undefined,
        forCart.needsShipping ? ["AU", "NZ"] : [],
        successBaseUrl,
      );
      return { ok: true, session };
    } catch (err) {
      return { ok: false, error: err };
    }
  };

  const sessionPromise =
    !isSettledFreeCart && !offlineOnly
      ? createSession(cart)
      : Promise.resolve(null);

  const pickupPromise = (async () => {
    try {
      const sdk = createServerHeadkit();
      const apiLocs = await sdk.pickupLocations.list();
      return apiLocs.map((l) => ({
        name: l.name,
        address: l.address,
        city: l.city,
        state: l.state,
        stateCode: l.stateCode ?? "",
        postcode: l.postcode,
        country: l.country,
        countryCode: l.countryCode ?? "",
        shippingMethodId: l.shippingMethodId,
      }));
    } catch {
      return [] as Array<{
        name: string;
        address: string;
        city: string;
        state: string;
        stateCode: string;
        postcode: string;
        country: string;
        countryCode: string;
        shippingMethodId: string;
      }>;
    }
  })();

  const [created, pickupLocations] = await Promise.all([
    sessionPromise,
    pickupPromise,
  ]);

  if (created) {
    let result = created;
    if (!result.ok && isCartItemUnavailableError(result.error)) {
      const latest = await getFullCartAction();
      if (!latest || latest.itemsCount === 0) {
        redirect(bagUrl([...stockAlerts, { kind: "unnamed" }]));
      }
      cart = await correctCartAtEntry(latest, stockAlerts);
      result = await createSession(cart);
    }
    if (!result.ok) {
      if (isCartItemUnavailableError(result.error)) {
        redirect(bagUrl([...stockAlerts, { kind: "unnamed" }]));
      }
      sessionFailure = "session_creation_failed";
      logCheckoutFailure(
        sessionFailure,
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
      );
    } else {
      const session = result.session;
      if (
        !session.clientSecret ||
        !session.sessionId ||
        !session.publishableKey
      ) {
        sessionFailure = "invalid_session";
        logCheckoutFailure(sessionFailure, {
          hasClientSecret: !!session.clientSecret,
          hasSessionId: !!session.sessionId,
          hasPublishableKey: !!session.publishableKey,
        });
      } else {
        checkoutSession = {
          clientSecret: session.clientSecret,
          sessionId: session.sessionId,
          publishableKey: session.publishableKey,
          stripeAccountId: session.stripeAccountId ?? null,
          testMode: session.testMode === true,
          shippingOptionMapping: session.shippingOptionMapping ?? null,
        };
      }
    }
  }

  if (sessionFailure && !arrivedFromFailure) {
    redirect(checkoutFailurePath(sessionFailure));
  }

  const heldSessionFailure =
    sessionFailure &&
    checkoutBannerMessage(sessionFailure) !== checkoutBannerMessage(error)
      ? checkoutBannerMessage(sessionFailure)
      : null;

  return (
    <>
      {checkoutSession ? (
        <CheckoutTestModeBanner
          publishableKey={checkoutSession.publishableKey}
          {...(checkoutSession.testMode !== undefined
            ? { testMode: checkoutSession.testMode }
            : {})}
        />
      ) : null}
      {heldSessionFailure && (
        <div className="mx-auto max-w-6xl px-4 pt-6">
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
          >
            <p className="text-sm text-red-700">{heldSessionFailure}</p>
          </div>
        </div>
      )}
      <CheckoutPageContent
        initialStockAlerts={stockAlerts}
        initialCart={cart as unknown as CartFieldsFragment}
        checkoutSession={checkoutSession}
        pickupLocations={pickupLocations}
        returnUrl={returnUrl}
        {...(successBaseUrl && { successBaseUrl })}
        {...(customerEmail && { customerEmail })}
        isAuthenticated={isAuthenticated}
        allowedCountries={["AU", "NZ"]}
        bnplMessagingEnabled={bnplMessagingEnabled}
      />
    </>
  );
}
