import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { correctCartAtEntry } from "@/lib/checkout-stock-entry";
import { hasBlockingCartIssues } from "@/lib/cart-issues";
import { bagUrl, type StockAlert } from "@/lib/stock-hold";
import { CheckoutSessionGate } from "./checkout-session-gate";
import type { CartFieldsFragment } from "@headkit/sdk";
import { getFullCartAction } from "@/lib/cart-actions";
import { getCustomer } from "@/lib/account-actions";
import { getAuthToken } from "@/lib/auth-cookie";
import { resolveCheckoutEmail } from "@/lib/checkout-email";
import { hostedCheckoutUrl } from "@/lib/hosted-checkout";
import { hostedCheckoutCookieOptions } from "@/lib/hosted-cart-sync";
import { getStoreCurrency } from "@/lib/utils";
import { Ga4EcommerceEmitter } from "@/components/analytics/ga4-ecommerce-emitter";
import { buildBeginCheckoutFromCart } from "@/lib/ga4-ecommerce";
import { PaymentFailedBanner } from "@/components/checkout/payment-failed-banner";
import { CartChangedBanner } from "@/components/checkout/cart-changed-banner";
import { CheckoutPendingShell } from "@/components/checkout/checkout-pending-shell";
import { getBranding } from "@/lib/branding";
import { normalizeCheckoutMode } from "@/lib/checkout-mode";
import { getStripeConfig } from "@/lib/stripe-config";
import {
  checkoutDeadEndPath,
  logCheckoutFailure,
} from "@/lib/checkout-failure";
import { normalizeSiteUrl, resolveSiteUrl } from "@/lib/site-url";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Nothing on this page may run before a real request. Every read below is
  // bound to the shopper's cookie-backed cart, and a null cart renders as a
  // terminal page. A client prefetch of `/checkout` runs a RUNTIME prerender
  // under Cache Components, which resolves `cookies()` and `searchParams` —
  // so without this line the prefetch started `cart.get()`, completed with the
  // fetch in flight, and Next's rejection of that fetch was swallowed into a
  // null cart and a logged "provider failure". `connection()` never resolves
  // in a `prerender-runtime` store (`next/dist/server/request/connection.js`),
  // so the prefetch stops here and no cart read starts. It is first on
  // purpose: the route is already fully dynamic, so no static shell is lost.
  // `lib/cart-actions.ts` rethrows the interruption as the backstop.
  await connection();

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
  // LOOP GUARD. A shopper who is already HERE because something failed must
  // not be redirected away again when this page's own session creation then
  // fails — that is `/checkout → /checkout` forever. One hop maximum: with an
  // `?error=` already on the URL, a session failure below renders in place
  // instead, and `CheckoutPageContent` shows the order summary beneath it.
  const arrivedFromFailure = typeof error === "string" && error.length > 0;

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
  // cart there simply shows empty.
  //
  // THIS IS THE ONE PLACE a dead end is decided. Every other surface routes a
  // failure to `/checkout` because none of them can see the cart; this gate
  // can, so the dead end is reached in exactly one hop, from here, and
  // `/checkout/error` never sends anyone back (`lib/checkout-failure.ts`).
  if (!cart) {
    logCheckoutFailure("empty_cart", {
      cart: "unreadable",
      arrivedWith: error,
    });
    redirect(checkoutDeadEndPath("empty_cart"));
  }
  if (cart.itemsCount === 0) {
    redirect(checkoutDeadEndPath("empty_cart"));
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

  // Stripe Custom Checkout briefly shows checkout.stripe.com?...&returned_from_redirect
  // before hopping to return_url. Prefer live store domain / request host over a
  // stale baked NEXT_PUBLIC_FRONTEND_URL so BNPL returns land on this storefront.
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host");
  const host = (forwardedHost ?? requestHeaders.get("host") ?? "")
    .split(",")[0]
    ?.trim();
  const proto = (requestHeaders.get("x-forwarded-proto") ?? "https")
    .split(",")[0]
    ?.trim();
  const requestOrigin =
    host && proto ? normalizeSiteUrl(`${proto}://${host}`) : "";
  const siteOrigin =
    resolveSiteUrl(
      storeSettings.domain,
      process.env.NEXT_PUBLIC_FRONTEND_URL,
    ) || requestOrigin;
  if (!siteOrigin) {
    throw new Error(
      "Checkout return URL has no origin (store domain, request host, and NEXT_PUBLIC_FRONTEND_URL are all empty)",
    );
  }
  const returnUrl = `${siteOrigin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
  const successBaseUrl = siteOrigin;

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

  const cartFragment = cart as unknown as CartFieldsFragment;

  return (
    <div className="bg-brand-bg">
      <Ga4EcommerceEmitter event={beginCheckoutEvent} />
      {/* Payment failed banner (ENG-789: retry after Afterpay/BNPL decline) */}
      {paymentFailed && <PaymentFailedBanner />}
      {/* Cart changed banner (ENG-784: session expired mid-redirect because
          the cart drifted; nothing was charged) */}
      {cartChanged && <CartChangedBanner />}
      {/* Cart + step chrome stream first; Stripe session mint stays behind
          Suspense so the shopper is not stuck on a full-page skeleton. */}
      <Suspense fallback={<CheckoutPendingShell cart={cartFragment} />}>
        <CheckoutSessionGate
          cart={cart}
          stockAlerts={stockAlerts}
          returnUrl={returnUrl}
          arrivedFromFailure={arrivedFromFailure}
          isAuthenticated={isAuthenticated}
          bnplMessagingEnabled={stripeConfig.bnplMessagingEnabled}
          {...(successBaseUrl && { successBaseUrl })}
          {...(customerEmail && { customerEmail })}
          {...(error && { error })}
        />
      </Suspense>
    </div>
  );
}
