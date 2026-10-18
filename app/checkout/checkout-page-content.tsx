"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  Suspense,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckoutForm } from "@/app/checkout/CheckoutForm";
import { Button } from "@/components/ui/button";
import { Cart } from "@/components/checkout/cart";
import { OfflinePaymentCheckout } from "@/components/checkout/offline-payment-checkout";
import { isOfflineOnlyCart } from "@/lib/payment-gateways";
import { cartItemsDisplayTotal } from "@/lib/cart-prices";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { getFloatVal, formatPrice, cn } from "@/lib/utils";
import { ChevronDownIcon } from "@/components/icon";
import type { CartFieldsFragment } from "@headkit/sdk";
import {
  createCheckoutSessionAction,
  getCheckoutAction,
  expireCheckoutSessionAction,
  updateCustomerAction,
} from "@/app/checkout/actions";
import { getFullCartAction } from "@/lib/cart-actions";
import { registerActiveCheckoutSession } from "@/lib/register-checkout-session";
import { cartNeedsAttention } from "@/lib/cart-issues";
import { Input } from "@/components/ui/input";
import { CartChangedBanner } from "@/components/checkout/cart-changed-banner";
import type { Step } from "@/app/checkout/CheckoutForm";
import { StockAlertsProvider } from "@/components/checkout/stock-alerts";
import type { StockAlert } from "@/lib/stock-hold";
function CheckoutErrorHandler({
  onError,
}: {
  onError: (error: string) => void;
}) {
  const searchParams = useSearchParams();

  useEffect(() => {
    const error = searchParams.get("error");
    if (error) {
      switch (error) {
        case "payment_failed":
          // Rendered by the dismissible <PaymentFailedBanner> on the checkout
          // page (ENG-789) — no inline duplicate here.
          break;
        case "cart_changed":
          // Rendered by the dismissible <CartChangedBanner> on the checkout
          // page (ENG-784) — no inline duplicate here.
          break;
        case "checkout_failed":
          onError(
            "There was an issue processing your order. Please try again.",
          );
          break;
        case "stripe_error":
          onError(
            "There was an issue with the payment processor. Please try again.",
          );
          break;
        default:
          onError("An error occurred. Please try again.");
      }
    }
  }, [searchParams, onError]);

  return null;
}

export type ShippingOptionMappingItem = {
  rateId: string;
  stripeShippingRateId: string;
};

export type CheckoutSessionProp = {
  clientSecret: string;
  sessionId: string;
  publishableKey: string;
  stripeAccountId?: string | null;
  /**
   * Commerce flag: session was created with platform test keys.
   * The banner also falls back to a `pk_test_` prefix.
   */
  testMode?: boolean;
  /** Maps cart rateId to Stripe shipping rate ID for updateShippingOption. */
  shippingOptionMapping?: ShippingOptionMappingItem[] | null;
};

export type PickupLocationItem = {
  name: string;
  address: string;
  city: string;
  state: string;
  /** ISO state code (e.g. NSW) — required for WooCommerce update-customer */
  stateCode: string;
  postcode: string;
  country: string;
  /** ISO 2-letter country code (e.g. AU) — required for Stripe */
  countryCode: string;
  shippingMethodId: string;
};

interface CheckoutPageContentProps {
  initialCart?: CartFieldsFragment | null;
  checkoutSession?: CheckoutSessionProp | null;
  pickupLocations?: PickupLocationItem[];
  returnUrl?: string;
  successBaseUrl?: string;
  /**
   * Logged-in shopper's email resolved server-side (CKA-04). Seeds the Contact
   * step's default email immediately on load so prefill does not wait on the
   * async cart fetch. Undefined for guests (unchanged).
   */
  customerEmail?: string;
  /**
   * True when the shopper is logged in (WP auth cookie present, resolved
   * server-side in page.tsx). Threads to CheckoutForm, which suppresses the
   * provider-level `defaultValues.email` prefill for authed shoppers — the
   * init-time prefill against a bound email-ful customer kills all elements
   * (ENG-783 fix2). Never derived from `customerEmail`.
   */
  isAuthenticated?: boolean;
  allowedCountries?: string[];
  /**
   * Commerce's `bnplMessagingEnabled` (see `lib/stripe-config.ts`), read
   * server-side in page.tsx. Only the FLAG travels: the publishable key and account
   * the badge renders against come from the checkout session, which is the
   * account the shopper is actually paying through.
   */
  bnplMessagingEnabled?: boolean;
  /**
   * The per-item alerts for lines the checkout page removed or reduced at
   * entry (checkout plan v3 §2, checkpoint C1). Shown above the steps.
   */
  initialStockAlerts?: StockAlert[];
}

/**
 * The checkout UI, inside the stock-alert area every checkpoint reports into
 * (components/checkout/stock-alerts.tsx).
 */
export function CheckoutPageContent({
  initialStockAlerts = [],
  ...props
}: CheckoutPageContentProps) {
  return (
    <StockAlertsProvider initialAlerts={initialStockAlerts}>
      <CheckoutPageBody {...props} />
    </StockAlertsProvider>
  );
}

function CheckoutPageBody({
  initialCart,
  checkoutSession: initialCheckoutSession,
  pickupLocations: pickupLocationsFromApi = [],
  returnUrl,
  successBaseUrl,
  customerEmail,
  isAuthenticated = false,
  allowedCountries = ["AU", "NZ"],
  bnplMessagingEnabled = false,
}: Omit<CheckoutPageContentProps, "initialStockAlerts">) {
  const router = useRouter();
  const { cartData, setCartData, toggleCart } = useCartContext();
  const [showCart, setShowCart] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [checkoutSession, setCheckoutSession] =
    useState<CheckoutSessionProp | null>(initialCheckoutSession ?? null);
  /** Step/email to restore after session recreate — keyed by sessionId so it
   * survives re-renders until the remounted checkout form consumes it. */
  const [sessionRestore, setSessionRestore] = useState<{
    sessionId: string;
    step: string;
    email: string;
  } | null>(null);
  const [isPlacingFreeOrder, setIsPlacingFreeOrder] = useState(false);
  // ENG-838: WooCommerce requires a FULL billing address even for a $0 order
  // (woocommerce_rest_invalid_address: first name, street, suburb, state,
  // postcode — and the email for woocommerce_rest_missing_email_address). The
  // free-order confirm collects a minimal billing form; email prefilled from
  // the server-resolved shopper email when known.
  const [freeOrderBilling, setFreeOrderBilling] = useState({
    email: customerEmail ?? "",
    firstName: "",
    lastName: "",
    address1: "",
    city: "",
    state: "",
    postcode: "",
    country: "AU",
  });
  const setBillingField = (field: string, value: string) =>
    setFreeOrderBilling((prev) => ({ ...prev, [field]: value }));
  // ENG-784: amber cart-changed notice for the LIVE refresh path (a dead
  // session detected mid-checkout and auto-recreated in place). The
  // ?error=cart_changed URL variant renders the same banner from page.tsx.
  const [showCartChangedNotice, setShowCartChangedNotice] = useState(false);

  // ENG-784 mechanism 1: record the ACTIVE session in the httpOnly
  // hk-checkout-session cookie so any cart mutation outside checkout expires
  // it before mutating. Through a Route Handler (see
  // `lib/register-checkout-session.ts`): the Server Action this used to be
  // re-rendered /checkout and created a second, orphaned Stripe session on
  // every view. Best-effort: a failed registration only disables mechanism 1;
  // mechanism 2 (amount verification at manual capture) still protects the
  // charge. One registration per session id, so the supersede path below can
  // wait for the same request the mount effect started.
  const registration = useRef<{
    sessionId: string;
    done: Promise<void>;
  } | null>(null);
  const registerSession = useCallback((sessionId: string): Promise<void> => {
    if (registration.current?.sessionId !== sessionId) {
      registration.current = {
        sessionId,
        done: registerActiveCheckoutSession(sessionId).catch(() => {}),
      };
    }
    return registration.current.done;
  }, []);

  const activeSessionIdForSupersede = checkoutSession?.sessionId ?? null;
  const refreshSession = useCallback(
    async (
      newEmail: string,
      nextStep: string,
      opts?: { notice?: "cart_changed" },
    ) => {
      if (!returnUrl) throw new Error("Return URL not configured");
      // ENG-784 supersede: capture the previous session BEFORE the swap so it
      // can be deliberately expired (reason SUPERSEDED) after the new session
      // is in place. NO SSR supersede-expiry happens on /checkout — a second
      // tab must not kill an in-flight redirect when the cart is unchanged.
      const previousSessionId = activeSessionIdForSupersede;
      // Cart is already updated by ContactFormStep before calling this.
      // ENG-801 recreate-then-updateEmail model: the recreated session is
      // created email-LESS by design (a `customer_email` set at create renders
      // the Stripe email field read-only). `newEmail` is only used to seed the
      // prefill (`setRestoredEmail` below → formData.email); the session
      // receives it post-create via the one-shot updateEmail push effect in
      // CheckoutSteps — no contact-step re-submit needed.
      // Only request shipping-address collection when the cart needs shipping —
      // otherwise the recreated session would require a shipping address that the
      // billing-only UI never sets, breaking confirm().
      const shippingCountries = cartData?.needsShipping ? allowedCountries : [];
      let session: Awaited<ReturnType<typeof createCheckoutSessionAction>>;
      try {
        session = await createCheckoutSessionAction(
          returnUrl,
          undefined,
          shippingCountries,
          successBaseUrl,
        );
      } catch (err) {
        // Commerce refuses a session for a cart the store will not sell
        // (CART_ITEM_UNAVAILABLE), but a Server Action error arrives here
        // without its code in production — so re-read the cart and, if it
        // needs the shopper's attention, reload checkout, which removes or
        // flags the line (lib/cart-issues.ts).
        const latest = await getFullCartAction().catch(() => null);
        if (cartNeedsAttention(latest)) {
          // Already on /checkout: a full reload re-runs its server render.
          window.location.reload();
          return;
        }
        throw err;
      }
      if (
        !session.clientSecret ||
        !session.sessionId ||
        !session.publishableKey
      ) {
        throw new Error("Failed to create checkout session");
      }
      setCheckoutSession({
        clientSecret: session.clientSecret,
        sessionId: session.sessionId,
        publishableKey: session.publishableKey,
        stripeAccountId: session.stripeAccountId ?? null,
        testMode: session.testMode === true,
        shippingOptionMapping: session.shippingOptionMapping ?? null,
      });
      const refreshedCart = await getFullCartAction();
      if (refreshedCart) setCartData(refreshedCart);
      setSessionRestore({
        sessionId: session.sessionId,
        step: nextStep,
        email: newEmail,
      });
      if (opts?.notice === "cart_changed") {
        setShowCartChangedNotice(true);
      }
      // ENG-784 supersede: the previous session is now unreachable from the
      // UI — expire it deliberately (SUPERSEDED) so it can never race the new
      // one. Fire-and-forget: the action swallows expire failures internally
      // (mechanism 2 backstops) and only clears the tracking cookie when it
      // still points at the superseded session. It waits for the NEW
      // session's registration first: the action reads the cookie its request
      // carried, so an expire sent before the registration landed would see
      // the old id, delete the cookie, and leave the new session unprotected.
      if (previousSessionId && previousSessionId !== session.sessionId) {
        const newSessionId = session.sessionId;
        void registerSession(newSessionId)
          .then(() =>
            expireCheckoutSessionAction(previousSessionId, "SUPERSEDED"),
          )
          .catch(() => {});
      }
    },
    [
      returnUrl,
      successBaseUrl,
      allowedCountries,
      cartData?.needsShipping,
      activeSessionIdForSupersede,
      setCartData,
      registerSession,
    ],
  );

  // PAY-05: free-order (zero-total) confirm. A cart with items but a $0 total
  // (100%-off coupon, gift, free sample) has no payment step. We capture the
  // draft order id/key, then trigger the SERVER-SIDE zero-total bypass
  // (createCheckoutSession finalizes the WC order WITHOUT a Stripe session),
  // then route to the existing success page. No Stripe / CheckoutProvider.
  const placeFreeOrder = useCallback(async () => {
    if (!returnUrl) {
      setErrorMessage("Return URL not configured");
      return;
    }
    const b = Object.fromEntries(
      Object.entries(freeOrderBilling).map(([k, v]) => [k, v.trim()]),
    ) as typeof freeOrderBilling;
    if (!b.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email)) {
      setErrorMessage("Please enter a valid email address for your order.");
      return;
    }
    if (!b.firstName || !b.address1 || !b.city || !b.state || !b.postcode) {
      setErrorMessage(
        "Please fill in your name and billing address — WooCommerce requires them even for a free order.",
      );
      return;
    }
    setIsPlacingFreeOrder(true);
    setErrorMessage("");
    try {
      // ENG-838: WooCommerce rejects a $0 checkout without a full billing
      // address + email — push them onto the cart session before finalizing
      // (the commerce zero-total finalize replays the session billing).
      await updateCustomerAction({ billingAddress: b });
      // ENG-838: WC 10.8+ defers draft-order creation to POST /checkout, so
      // GET /checkout typically reports orderId "0"/null at this point. The
      // pre-capture is only a fallback for pre-10.8 stores — its absence is
      // NOT an error; the finalize below returns the authoritative ids.
      const draft = await getCheckoutAction().catch(() => null);
      // Server-side zero-total bypass: finalizes the WC order, no Stripe.
      // Free orders never need shipping-address collection by Stripe.
      const res = await createCheckoutSessionAction(
        returnUrl,
        undefined,
        [],
        successBaseUrl,
      );
      // HI-02 (code review): trust the SERVER's zero-total decision, not the
      // client's possibly-stale cart total. If the cart total changed between
      // render and server eval, the server takes the PAID branch and returns a
      // real Stripe session (non-empty clientSecret/sessionId) expecting payment.
      // Routing such a result to /success would place an order with NO payment
      // collected, so stop and ask the user to refresh instead.
      if (res?.clientSecret || res?.sessionId) {
        setErrorMessage(
          "Your cart total changed and now requires payment. Please refresh and try again.",
        );
        setIsPlacingFreeOrder(false);
        return;
      }
      // Prefer the server-returned finalized ids — on WC 10.8+ they are the
      // ONLY source (no draft existed before the finalize). Fall back to the
      // pre-captured draft for pre-10.8 stores. "0" is a WC sentinel for
      // "no draft yet", never a real order id.
      const draftOrderId =
        draft?.orderId && draft.orderId !== "0" ? draft.orderId : null;
      const orderId = res?.orderId ?? draftOrderId;
      const orderKey = res?.orderKey ?? draft?.orderKey ?? null;
      if (!orderId || !orderKey) {
        // The order WAS placed server-side; only the confirmation routing is
        // missing. Don't imply failure — that invites a duplicate attempt.
        throw new Error(
          "Your order was placed, but its confirmation page could not be opened. Please check your order confirmation email.",
        );
      }
      router.push(
        `/checkout/success/${encodeURIComponent(
          orderId,
        )}?key=${encodeURIComponent(orderKey)}`,
      );
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : "Could not complete your free order. Please try again.",
      );
      setIsPlacingFreeOrder(false);
    }
  }, [returnUrl, successBaseUrl, router, freeOrderBilling]);

  useEffect(() => {
    toggleCart(false);
    window.scrollTo(0, 0);
    // The server render's cart is the one checkout entry CORRECTED (C1,
    // `correctCartAtEntry` in page.tsx), so it replaces whatever the context
    // already holds — e.g. a cart carried over from client navigation, read
    // before the correction. Adopting it only into an empty context showed the
    // removed line, its total and the old badge count beside the "has been
    // removed" alert (rehearsal S2; see also `CartCountSync`).
    if (initialCart) {
      setCartData(initialCart);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Register the active session (see `registerSession`). From an effect
  // because `cookies().set()` is illegal during an RSC render. Zero-total
  // checkouts have no session → no-op.
  const activeSessionId = checkoutSession?.sessionId;
  useEffect(() => {
    if (!activeSessionId) return;
    void registerSession(activeSessionId);
  }, [activeSessionId, registerSession]);

  const activeSessionIdForRestore = checkoutSession?.sessionId;
  const restoreForActiveSession =
    activeSessionIdForRestore &&
    sessionRestore?.sessionId === activeSessionIdForRestore
      ? sessionRestore
      : null;
  const initialStep = restoreForActiveSession?.step ?? null;
  // Prefer a restored email (after a session refresh); otherwise seed the
  // server-resolved logged-in email (CKA-04) so the Contact step prefills on
  // first paint. Guest → null (unchanged).
  const initialEmail = restoreForActiveSession
    ? restoreForActiveSession.email
    : (customerEmail ?? null);

  const hasItems = (cartData?.items.length ?? 0) > 0;
  const cartTotal = getFloatVal(cartData?.totals.totalPrice ?? "0");
  const currency = cartData?.currency.code ?? "AUD";
  const itemCount = cartData?.itemsCount ?? 0;

  // Genuinely-empty cart: no cart, or no items. NOT a $0-total cart-with-items.
  if (!cartData || !hasItems) {
    return (
      <div className="min-h-[700px] py-10 px-[20px] md:px-32 pb-[30px] md:py-[60px] text-center">
        <div className="w-[500px] max-w-full mx-auto">
          <p className="mb-4 font-bold leading-10">No products in your cart!</p>
          <p className="mb-10">
            Browse our selection to find something you love.
          </p>
          <Link href="/">
            <Button fullWidth onClick={() => toggleCart(false)}>
              Start shopping
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // PAY-05: free order — has items but a $0 total. No payment step; confirm
  // routes through the server-side zero-total bypass (no Stripe), distinct from
  // the empty-cart message above.
  //
  // ENG-838: the WC cart total EXCLUDES shipping until a rate is selected, so
  // a shippable cart with $0 items is NOT free yet — WC will attach a default
  // shipping rate at finalize and the order becomes payable. Only show the
  // no-payment confirm when shipping is settled: no shipping needed, or a rate
  // already selected (then the $0 total genuinely includes $0 shipping).
  // Mirrors the server's isZeroTotalCart guard — both must agree or the client
  // renders "No payment required" for an order the server refuses to finalize.
  const hasSelectedShippingRate = (cartData?.shippingRates ?? []).some((pkg) =>
    (pkg?.shippingRates ?? []).some((rate) => rate?.selected),
  );
  const shippingSettled = !cartData?.needsShipping || hasSelectedShippingRate;
  if (cartTotal <= 0 && shippingSettled) {
    return (
      <div className="min-h-[700px] py-10 px-[20px] md:px-32 pb-[30px] md:py-[60px] text-center">
        <div className="w-[500px] max-w-full mx-auto">
          <p className="mb-4 font-bold leading-10">No payment required</p>
          <p className="mb-2">
            Your order total is {formatPrice(0, currency)}. There&apos;s nothing
            to pay — confirm to place your order.
          </p>
          <p className="mb-10 text-sm text-gray-500">
            {itemCount} {itemCount === 1 ? "item" : "items"} in your order.
          </p>
          {/* ENG-838: WC requires a full billing address + email even for $0
              orders (woocommerce_rest_invalid_address). Minimal plain-input
              form — no Stripe session exists on the free path, so the
              Stripe-element address components cannot be used here. */}
          <div className="mb-6 space-y-3 text-left">
            <div>
              <label
                htmlFor="free-order-email"
                className="mb-1 block text-sm font-medium"
              >
                Email for your order confirmation
              </label>
              <Input
                id="free-order-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={freeOrderBilling.email}
                onChange={(e) => setBillingField("email", e.target.value)}
                disabled={isPlacingFreeOrder}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="free-order-first-name"
                  className="mb-1 block text-sm font-medium"
                >
                  First name
                </label>
                <Input
                  id="free-order-first-name"
                  autoComplete="given-name"
                  value={freeOrderBilling.firstName}
                  onChange={(e) => setBillingField("firstName", e.target.value)}
                  disabled={isPlacingFreeOrder}
                />
              </div>
              <div>
                <label
                  htmlFor="free-order-last-name"
                  className="mb-1 block text-sm font-medium"
                >
                  Last name
                </label>
                <Input
                  id="free-order-last-name"
                  autoComplete="family-name"
                  value={freeOrderBilling.lastName}
                  onChange={(e) => setBillingField("lastName", e.target.value)}
                  disabled={isPlacingFreeOrder}
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="free-order-address1"
                className="mb-1 block text-sm font-medium"
              >
                Street address
              </label>
              <Input
                id="free-order-address1"
                autoComplete="address-line1"
                value={freeOrderBilling.address1}
                onChange={(e) => setBillingField("address1", e.target.value)}
                disabled={isPlacingFreeOrder}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="free-order-city"
                  className="mb-1 block text-sm font-medium"
                >
                  Suburb
                </label>
                <Input
                  id="free-order-city"
                  autoComplete="address-level2"
                  value={freeOrderBilling.city}
                  onChange={(e) => setBillingField("city", e.target.value)}
                  disabled={isPlacingFreeOrder}
                />
              </div>
              <div>
                <label
                  htmlFor="free-order-state"
                  className="mb-1 block text-sm font-medium"
                >
                  State
                </label>
                <Input
                  id="free-order-state"
                  autoComplete="address-level1"
                  placeholder="VIC"
                  value={freeOrderBilling.state}
                  onChange={(e) => setBillingField("state", e.target.value)}
                  disabled={isPlacingFreeOrder}
                />
              </div>
              <div>
                <label
                  htmlFor="free-order-postcode"
                  className="mb-1 block text-sm font-medium"
                >
                  Postcode
                </label>
                <Input
                  id="free-order-postcode"
                  autoComplete="postal-code"
                  value={freeOrderBilling.postcode}
                  onChange={(e) => setBillingField("postcode", e.target.value)}
                  disabled={isPlacingFreeOrder}
                />
              </div>
            </div>
          </div>
          {errorMessage && (
            <div className="text-red-500 text-center mb-4">{errorMessage}</div>
          )}
          <Button
            fullWidth
            onClick={placeFreeOrder}
            disabled={isPlacingFreeOrder}
          >
            {isPlacingFreeOrder ? "Placing order…" : "Place order"}
          </Button>
        </div>
      </div>
    );
  }

  // Offline gateways (bacs / cheque / cod) take payment outside the storefront,
  // so there is no Stripe session to create. When the store offers one and does
  // NOT offer Stripe, the Stripe flow below is unreachable for this shopper —
  // drive the offline form instead. A store offering both keeps Stripe as the
  // default path; the offline choice is a follow-up, not a silent downgrade.
  if (isOfflineOnlyCart(cartData.paymentMethods)) {
    return <OfflinePaymentCheckout cart={cartData} />;
  }

  return (
    <div className="headkit-checkout min-h-[700px] py-10">
      <Suspense fallback={null}>
        <CheckoutErrorHandler onError={setErrorMessage} />
      </Suspense>

      {/* ENG-784: live cart-changed notice (dead session auto-recreated in
          place). Keyed so a subsequent recreate re-shows a dismissed banner. */}
      {showCartChangedNotice && (
        <CartChangedBanner key={checkoutSession?.sessionId ?? "notice"} />
      )}

      {errorMessage && (
        <div className="text-red-500 text-center mb-4 px-[20px] md:px-[40px]">
          {errorMessage}
        </div>
      )}

      {checkoutSession ? (
        <CheckoutForm
          checkoutSession={checkoutSession}
          pickupLocationsFromApi={pickupLocationsFromApi}
          isAuthenticated={isAuthenticated}
          {...(returnUrl && { onRefreshSession: refreshSession })}
          {...(initialStep && { initialStep: initialStep as Step })}
          {...(initialEmail && { initialEmail })}
          cartSidebar={
            <div className="px-[20px] py-[17px] md:py-0 border-y border-[#d6d6d6] md:border-0">
              {/* Mobile toggle */}
              <div
                className="md:hidden flex justify-between cursor-pointer"
                onClick={() => setShowCart(!showCart)}
              >
                <span className="font-medium">
                  {itemCount} {itemCount === 1 ? "item" : "items"}
                </span>
                <span className="font-medium flex items-center">
                  {formatPrice(cartItemsDisplayTotal(cartData), currency)}
                  <ChevronDownIcon
                    className={cn(
                      "mt-[2px] ml-[10px] h-[24px] w-[12px] transition-transform",
                      { "rotate-180": showCart },
                    )}
                  />
                </span>
              </div>

              {/* Cart contents */}
              <div
                className={cn("hidden md:block transition-all", {
                  "block! mt-[20px]": showCart,
                })}
              >
                <Cart
                  showDisplayShipping={true}
                  bnpl={{
                    publishableKey: checkoutSession.publishableKey,
                    stripeAccountId: checkoutSession.stripeAccountId ?? null,
                    enabled: bnplMessagingEnabled,
                  }}
                />
              </div>
            </div>
          }
        />
      ) : null}
    </div>
  );
}
