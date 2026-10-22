import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { correctCartAtEntry, type EntryCart } from "@/lib/checkout-stock-entry";
import {
  hasBlockingCartIssues,
  isCartItemUnavailableError,
} from "@/lib/cart-issues";
import { bagUrl, type StockAlert } from "@/lib/stock-hold";
import {
  createCheckoutSessionAction,
  type CheckoutSessionResult,
} from "./actions";
import { CheckoutPageContent } from "./checkout-page-content";
import type { CartFieldsFragment } from "@headkit/sdk";
import { getFullCartAction } from "@/lib/cart-actions";
import { getCustomer } from "@/lib/account-actions";
import { getAuthToken } from "@/lib/auth-cookie";
import { resolveCheckoutEmail } from "@/lib/checkout-email";
import { hostedCheckoutUrl } from "@/lib/hosted-checkout";
import { hostedCheckoutCookieOptions } from "@/lib/hosted-cart-sync";
import { getFloatVal, getStoreCurrency } from "@/lib/utils";
import { Ga4EcommerceEmitter } from "@/components/analytics/ga4-ecommerce-emitter";
import { buildBeginCheckoutFromCart } from "@/lib/ga4-ecommerce";
import { createServerHeadkit } from "@/lib/sdk.server";
import { PaymentFailedBanner } from "@/components/checkout/payment-failed-banner";
import { CartChangedBanner } from "@/components/checkout/cart-changed-banner";
import { CheckoutTestModeBanner } from "@/components/checkout/test-mode-banner";
import { getBranding } from "@/lib/branding";
import { normalizeCheckoutMode } from "@/lib/checkout-mode";
import { isOfflineOnlyCart } from "@/lib/payment-gateways";
import { getStripeConfig } from "@/lib/stripe-config";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // ENG-789: the checkout return page redirects failed/canceled payments
  // (e.g. Afterpay declines) back here with ?error=payment_failed for an
  // in-place retry. Reading searchParams keeps the page dynamic — it already
  // is (cookie-based cart fetch).
  const { error } = await searchParams;
  const paymentFailed = error === "payment_failed";
  // ENG-784: BNPL returns whose session was deliberately expired because the
  // cart drifted land here with ?error=cart_changed — cart intact, fresh
  // session minted below, honest banner on top.
  const cartChanged = error === "cart_changed";

  // Parallel: quote-mode needs branding; Shopify hosted redirect needs cart;
  // the checkout summary's BNPL badge needs the store's messaging toggle.
  //
  // Only `bnplMessagingEnabled` is taken from this config. The publishable key
  // and Connect account the badge renders against come from the checkout
  // SESSION below — checkout has always taken its key from there rather than
  // from `getStripeConfig()`, and the session's account is the one the shopper
  // is actually paying through.
  const [{ storeSettings }, cartResult, stripeConfig] = await Promise.all([
    getBranding(),
    getFullCartAction(),
    getStripeConfig(),
  ]);

  // HeadKit Quote stores use /quote instead of the payment checkout.
  if (normalizeCheckoutMode(storeSettings.checkoutType) === "quote") {
    const qs = error ? `?error=${encodeURIComponent(error)}` : "";
    redirect(`/quote${qs}`);
  }

  let cart = cartResult;

  // null  = no cart cookie (never had a cart, the cookie aged out, or the
  //         success page / sign-out deleted it) or the cart could not be read
  // empty = the shopper's cart has no lines
  // Both are "your cart is empty", as on stock WooCommerce: an expired guest
  // cart there simply shows empty. `session_expired` is kept for a genuinely
  // expired Stripe checkout session (the return pages), where it is true.
  if (!cart || cart.itemsCount === 0) {
    redirect("/checkout/error?reason=empty_cart");
  }

  // Shopify Checkout is authoritative: redirect to Storefront cart.checkoutUrl
  // instead of creating a Stripe Checkout Session (ADR 004 / ENG-836).
  // Primary CTA is cart-drawer → checkoutUrl; this remains a deep-link safety net.
  const shopifyCheckout = hostedCheckoutUrl(cart);
  if (shopifyCheckout) {
    // Server redirect has no client JS — stamp the pending cookie so a later
    // tab-focus sync still rotates the bag if they never click Continue.
    const cookieStore = await cookies();
    const { name, ...opts } = hostedCheckoutCookieOptions();
    cookieStore.set({ name, value: "1", ...opts });
    redirect(shopifyCheckout);
  }

  // Checkpoint C1: correct the cart before showing the page.
  const stockAlerts: StockAlert[] = [];
  cart = await correctCartAtEntry(cart, stockAlerts);

  // The store still reports a line it will not sell that could not be tied to
  // one cart line, so nothing above could correct it, and commerce refuses a
  // payment session for it. The bag is where the shopper can act on it: each
  // line there carries its own issue (components/headkit-ui/cart-item.tsx).
  if (hasBlockingCartIssues(cart)) {
    redirect(bagUrl([...stockAlerts, { kind: "unnamed" }]));
  }

  const returnUrl = `${process.env.NEXT_PUBLIC_FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const successBaseUrl = process.env.NEXT_PUBLIC_FRONTEND_URL;

  // CKA-04 prefill + ENG-801: resolve the shopper's email server-side SOLELY
  // to seed the Contact step prefill via the `customerEmail` prop below. The
  // session itself is created email-LESS — Stripe renders a session created
  // with `customer_email` as "prefilled and not editable", which locked the
  // ContactDetailsElement input on reload/recreate. The session receives the
  // email post-create via `actions.updateEmail` (one-shot push effect in
  // CheckoutSteps / contact-step submit), so the field stays editable.
  // A1: the authed Store API cart natively surfaces the WP billing email;
  // `getCustomer(authToken)` is a defensive fallback only when the cart has
  // none. Guest (no cookie / no email) → undefined → no prefill (unchanged).
  // The token/email are never logged (T-04.1-15).
  const authToken = getAuthToken(await cookies());
  // ENG-783: a logged-in shopper (WP auth cookie present) has a server-known
  // identity. CheckoutForm uses this to suppress the provider-level
  // `defaultValues.email` prefill — against a session with a bound email-ful
  // customer the init-time prefill triggers IntegrationError → loaderror on
  // all elements. The ContactDetailsElement itself always mounts; a bound
  // email-ful session displays the fixed email inside it.
  // Auth is the cookie ONLY — never inferred from `customerEmail` (a guest who
  // typed a billing email also has one).
  const isAuthenticated = !!authToken;
  let fallbackEmail: string | undefined;
  if (authToken && !cart.billingAddress?.email?.trim()) {
    const customer = await getCustomer(authToken);
    if (customer.success && customer.data?.email) {
      fallbackEmail = customer.data.email;
    }
  }
  const customerEmail = resolveCheckoutEmail(cart, fallbackEmail);

  let checkoutSession: {
    clientSecret: string;
    sessionId: string;
    publishableKey: string;
    stripeAccountId?: string | null;
    testMode?: boolean;
    shippingOptionMapping?: Array<{
      rateId: string;
      stripeShippingRateId: string;
    }> | null;
  } | null = null;
  // ENG-838: a settled-free cart ($0 total AND shipping settled — no shipping
  // needed, or a rate already selected) renders the no-payment confirm and
  // must NOT create a checkout session here: on the zero-total path the
  // server-side createCheckoutSession FINALIZES the WC order, so doing it
  // during SSR would place an order at page VIEW (and a reload would try to
  // finalize the consumed cart again → "This order cannot be paid for").
  // The finalize belongs to the Place-order click (placeFreeOrder). Mirrors
  // isZeroTotalCart in commerce and the free-branch condition in
  // checkout-page-content.tsx.
  const zeroTotal = getFloatVal(cart.totals.totalPrice ?? "0") <= 0;
  const shippingSettled =
    !cart.needsShipping ||
    (cart.shippingRates ?? []).some((pkg) =>
      (pkg?.shippingRates ?? []).some((rate) => rate?.selected),
    );
  const isSettledFreeCart = zeroTotal && shippingSettled;
  // A store whose only gateways are offline (bacs / cheque / cod) takes payment
  // outside the storefront, so there is no Stripe session to create and the
  // provider has no card capability to create one with. CheckoutPageContent
  // renders the offline form for exactly this cart — but it never gets the
  // chance if we throw here first, because the failure redirects to
  // /checkout/error. Same classifier, same condition, decided one level up.
  const offlineOnly = isOfflineOnlyCart(cart.paymentMethods);
  if (!isSettledFreeCart && !offlineOnly) {
    // Only request shipping-address collection when the cart actually needs
    // shipping. For digital/no-shipping carts the session must NOT require a
    // shipping address (the billing-only UI never sets one → confirm() would fail).
    // ENG-801: no email at create — see comment above `customerEmail`.
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
      } catch (error) {
        return { ok: false, error };
      }
    };

    let created = await createSession(cart);
    // Stock changed between the cart read above and the session create:
    // commerce refused BEFORE any payment (CART_ITEM_UNAVAILABLE). Correct the
    // cart again and try once more; redirect() stays outside any try, where its
    // control-flow throw cannot be caught.
    if (!created.ok && isCartItemUnavailableError(created.error)) {
      const latest = await getFullCartAction();
      if (!latest || latest.itemsCount === 0) {
        redirect(bagUrl([...stockAlerts, { kind: "unnamed" }]));
      }
      cart = await correctCartAtEntry(latest, stockAlerts);
      created = await createSession(cart);
    }
    if (!created.ok) {
      if (isCartItemUnavailableError(created.error)) {
        redirect(bagUrl([...stockAlerts, { kind: "unnamed" }]));
      }
      const message =
        created.error instanceof Error
          ? created.error.message
          : String(created.error);
      const params = new URLSearchParams({
        reason: "session_creation_failed",
        message,
      });
      redirect(`/checkout/error?${params.toString()}`);
    }
    const session = created.session;
    if (
      !session.clientSecret ||
      !session.sessionId ||
      !session.publishableKey
    ) {
      redirect("/checkout/error?reason=invalid_session");
    }
    checkoutSession = {
      clientSecret: session.clientSecret,
      sessionId: session.sessionId,
      publishableKey: session.publishableKey,
      stripeAccountId: session.stripeAccountId ?? null,
      testMode: session.testMode === true,
      shippingOptionMapping: session.shippingOptionMapping ?? null,
    };
  }

  let pickupLocations: Array<{
    name: string;
    address: string;
    city: string;
    state: string;
    stateCode: string;
    postcode: string;
    country: string;
    countryCode: string;
    shippingMethodId: string;
  }> = [];
  try {
    const sdk = createServerHeadkit();
    const apiLocs = await sdk.pickupLocations.list();
    pickupLocations = apiLocs.map((l) => ({
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
    // Fallback: checkout will use cart-derived list with empty addresses
  }

  // NO `min-h-screen` here. It forced this wrapper to a full 100vh BELOW the
  // header, so the page was always at least a viewport-and-a-header tall no
  // matter how little content the accordion had — measured as a void between
  // the last step card and the footer that GREW with the screen: gap =
  // viewportHeight - 642 (258px at 900px, 658px at 1300px). The remaining
  // `min-h-[700px]` in checkout-page-content.tsx keeps a constant ~103px of
  // floor, which does not scale.
  //
  // `bg-brand-bg` stays and is now the only reason the wrapper exists. It is
  // belt-and-braces rather than load-bearing: globals.css already paints
  // `body` with `var(--color-background, var(--background))`, and layout.tsx
  // sets BOTH of those and `--color-brand-bg` from the same branding value, so
  // the area below the wrapper was never a different colour.

  // GA4 `begin_checkout`. Built from the server-validated cart, at the only
  // point the route is guaranteed to have one: every empty / expired / hosted
  // -checkout path above has already redirected away, and stock auto-correction
  // has already re-fetched, so this is the cart the shopper is about to pay for.
  // Shopify carts never reach here (they redirect to the hosted checkout), which
  // is correct — that funnel is measured by Shopify.
  const beginCheckoutEvent = buildBeginCheckoutFromCart(
    cart as unknown as CartFieldsFragment,
    getStoreCurrency(),
  );

  return (
    <div className="bg-brand-bg">
      <Ga4EcommerceEmitter event={beginCheckoutEvent} />
      {checkoutSession ? (
        <CheckoutTestModeBanner
          publishableKey={checkoutSession.publishableKey}
          {...(checkoutSession.testMode !== undefined
            ? { testMode: checkoutSession.testMode }
            : {})}
        />
      ) : null}
      {/* Payment failed banner (ENG-789: retry after Afterpay/BNPL decline) */}
      {paymentFailed && <PaymentFailedBanner />}
      {/* Cart changed banner (ENG-784: session expired mid-redirect because
          the cart drifted; nothing was charged) */}
      {cartChanged && <CartChangedBanner />}
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
        bnplMessagingEnabled={stripeConfig.bnplMessagingEnabled}
      />
    </div>
  );
}
