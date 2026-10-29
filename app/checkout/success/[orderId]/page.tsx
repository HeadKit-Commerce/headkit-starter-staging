import type { Metadata, ResolvingMetadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import {
  getOrderAction,
  getCheckoutSessionAction,
  processCheckoutOrderAction,
} from "@/app/checkout/actions";
import { ClearCart } from "@/components/checkout/clear-cart";
import { PaymentProcessing } from "@/components/checkout/payment-processing";
import { OrderRefused } from "@/components/checkout/order-refused";
import { CompleteOrder } from "@/components/checkout/complete-order";
import { checkoutFailurePath } from "@/lib/checkout-failure";
import {
  logOrderRefusal,
  orderRefusalFromError,
  orderRefusalFromSession,
} from "@/lib/order-refusal";
import {
  logOrderValidation,
  logUnexpectedFinalizeFailure,
  orderValidationFromError,
} from "@/lib/order-validation";
import { buildStripeOrderPaymentData } from "@/lib/checkout-payment-data";
import { buildFinalizeAddresses } from "@/lib/finalize-address";
import {
  CHECKOUT_DATA_COOKIE,
  parseCheckoutDataCookie,
} from "@/lib/checkout-data-cookie";
import { LineItemDisplay } from "@/components/checkout/line-item-display";
import {
  lineDisplayTotal,
  orderDiscountDisplayTotal,
  orderItemsDisplayTotal,
  shippingDisplayTotal,
  orderShippingLineDisplayTotal,
} from "@/lib/cart-prices";
import { PaymentMethodDisplay } from "@/components/checkout/payment-method-display";
import { needsCheckoutOrderProcessing } from "@/lib/checkout-success-utils";
import { getFloatVal, formatPrice, getStoreCurrency } from "@/lib/utils";
import { Ga4EcommerceEmitter } from "@/components/analytics/ga4-ecommerce-emitter";
import { buildPurchaseFromOrder } from "@/lib/ga4-ecommerce";
import {
  BILLING_ADDRESS_COOKIE,
  parseBillingAddressCookie,
} from "@/lib/checkout-billing-cookie";
import { getBranding } from "@/lib/branding";
import { normalizeCheckoutMode } from "@/lib/checkout-mode";
import { StockShortfallNotice } from "@/components/checkout/stock-shortfall-notice";
import {
  SHORTFALL_KEPT_LINE_TAG,
  refundMethodLabel,
  shortfallLineTag,
  shortfallMoneySummary,
  shortfallNetTax,
  shortfallStatusCopy,
  splitOrderLines,
  stockShortfallNotice,
  type StockShortfall,
} from "@/lib/stock-shortfall";

interface Props {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ key?: string; session_id?: string }>;
}

export async function generateMetadata(
  _props: Props,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const p = await parent;
  return { title: p.title, description: p.description };
}

export default async function Page({ params, searchParams }: Props) {
  const { orderId } = await params;
  const { key: orderKey, session_id: sessionId } = await searchParams;

  if (!orderId || !orderKey) return notFound();

  const cookieStore = await cookies();
  const storedData = parseCheckoutDataCookie(
    cookieStore.get(CHECKOUT_DATA_COOKIE)?.value,
  );

  const billingEmailFromCookie = storedData.email;

  // Fetch order first — needed for status gate and render.
  // Draft orders (checkout-draft) return 401 from the WooCommerce REST API;
  // when that happens with a sessionId present (payment confirmed), we defer
  // to the session-based processing path below which will transition the order
  // out of draft and then redirect to a clean URL where it becomes readable.
  let order: Awaited<ReturnType<typeof getOrderAction>> = null;
  let orderFetchFailed = false;
  try {
    order = await getOrderAction(orderId, orderKey, billingEmailFromCookie);
  } catch (orderErr) {
    const msg = orderErr instanceof Error ? orderErr.message : "";
    if (
      msg.includes("Invalid order") ||
      msg.includes("invalid_order") ||
      msg.includes("Invalid order ID or key") ||
      msg.includes("not found")
    ) {
      redirect("/checkout?reason=order_expired");
    }
    // Draft orders return 401/cannot_view — defer to session processing below.
    // When no sessionId is present (e.g. redirect after processCheckoutOrderAction
    // or direct navigation) we still surface a fallback rather than crashing.
    const isDraftError =
      msg.includes("cannot_view") || msg.includes("status 401");
    if (isDraftError) {
      orderFetchFailed = true;
    } else {
      throw orderErr;
    }
  }
  if (!order && !orderFetchFailed) return notFound();

  let effectiveOrderId = orderId;
  let effectiveOrderKey = orderKey;
  let billingEmail: string | undefined = billingEmailFromCookie;
  let paymentCardBrand: string | undefined;
  let paymentCardLast4: string | undefined;
  let paymentMethod: string | undefined;
  let paymentWalletType: string | undefined;

  if (sessionId) {
    let session: Awaited<ReturnType<typeof getCheckoutSessionAction>> | null =
      null;
    try {
      session = await getCheckoutSessionAction(sessionId);
    } catch {
      // Session fetch failed — continue with URL params
    }

    if (session) {
      // Checked before every branch below: when commerce has stamped a
      // post-payment order refusal, the shopper PAID and WooCommerce refused
      // the order, and the payment is already refunded or released. This URL
      // names an order that will never exist, so neither the status branching
      // nor the draft-order processing below applies — and the `unpaid`
      // branch's processing screen is the forever-spinner this closes.
      const refusal = orderRefusalFromSession(session);
      if (refusal) {
        logOrderRefusal(refusal);
        return <OrderRefused refusal={refusal} />;
      }

      // ENG-789: the backend rewrites the Stripe return_url to this
      // order-based URL once the draft order exists, so redirect-BNPL
      // failures (e.g. Afterpay "Fail test payment") land HERE — not on
      // /checkout/success. Mirror its status branching instead of 404ing:
      // - open    → payment failed/canceled; cart + draft order are intact,
      //             send the shopper back to checkout for an in-place retry.
      // - expired → session no longer payable.
      // - complete + unpaid → async method still settling; show pending UI,
      //             the webhook (async_payment_succeeded) finalizes the order.
      if (session.status === "open") {
        redirect("/checkout?error=payment_failed");
      }
      if (session.status === "expired") {
        // ENG-784: deliberate cart-changed expiry (mechanism 1 fired during a
        // BNPL redirect) → back to /checkout with the cart-changed banner
        // (cart intact, fresh session minted on load). Plain expiry is
        // recoverable too: the WooCommerce cart normally outlives the Stripe
        // session, and only `/checkout`'s null-cart gate decides a dead end.
        if (session.expiredReason === "cart_changed") {
          redirect("/checkout?error=cart_changed");
        }
        redirect(checkoutFailurePath("session_expired"));
      }
      if (session.paymentStatus === "unpaid") {
        // ENG-784: sessionId enables the client poller (poll-only, D4).
        return <PaymentProcessing sessionId={sessionId} />;
      }

      // Guard: session order must match URL (reject tampered requests).
      // Skip the deferred sentinel "0": in the WC 10.8 deferred-order flow the
      // session metadata order_id stays "0" when the SUCCESS PAGE (not the
      // webhook) wins the create race — it creates the real order but does not
      // write order_id back to the session metadata. "0" is not a real order to
      // compare against, so it must not trip the tamper check (was 404ing valid
      // orders).
      if (
        session.orderId &&
        session.orderId !== "0" &&
        session.orderId !== orderId
      ) {
        return notFound();
      }

      billingEmail =
        billingEmailFromCookie ?? session.customerEmail ?? undefined;
      paymentCardBrand = session.cardBrand ?? undefined;
      paymentCardLast4 = session.cardLast4 ?? undefined;
      paymentMethod = session.paymentMethod ?? undefined;
      paymentWalletType = session.walletType ?? undefined;

      if (session.orderId && session.orderKey) {
        effectiveOrderId = session.orderId;
        effectiveOrderKey = session.orderKey;
      }

      // When the order is still a draft (orderFetchFailed), treat it as needing
      // processing — the 401 from the REST API confirms it hasn't been processed yet.
      const needsProcessing =
        orderFetchFailed ||
        needsCheckoutOrderProcessing(
          order?.status ?? "checkout-draft",
          session.cartToken,
          session.orderId,
          session.orderKey,
        );

      if (needsProcessing) {
        // ENG-801: carry billing and shipping SEPARATELY. The hk-checkout-data
        // cookie holds a SHIPPING address and must only feed shippingAddress
        // (precedence: cookie, then session shipping_details, then billing
        // fallback). Billing comes from the checkout-written hk-billing-address
        // cookie first — the session's customer_details is STALE for up to
        // tens of seconds after updateBillingAddress()/confirm(), so it is
        // only the fallback (wallet/express flows write no billing cookie).
        const billingCookie = parseBillingAddressCookie(
          cookieStore.get(BILLING_ADDRESS_COOKIE)?.value,
        );
        // Bounded re-poll only when NO billing cookie and the session has no
        // billing at all (e.g. wallet flows).
        let sessionAddr = session;
        if (!billingCookie && !sessionAddr.billingAddress?.address1) {
          for (let attempt = 0; attempt < 6; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            try {
              const refreshed = await getCheckoutSessionAction(sessionId);
              if (refreshed.billingAddress?.address1) {
                sessionAddr = refreshed;
                break;
              }
            } catch {
              /* transient — keep polling */
            }
          }
        }
        // `lib/finalize-address.ts` owns the pair and, above all, the
        // country/state/postcode rule: fall back across every source, then
        // OMIT the field rather than send "" — an empty country is a
        // woocommerce_rest_invalid_address_country 400 AFTER the charge.
        const { billingAddress, shippingAddress } = buildFinalizeAddresses(
          {
            billingCookie,
            sessionBilling: sessionAddr.billingAddress,
            shippingCookie: storedData.shippingAddress ?? null,
            sessionShipping: sessionAddr.shippingAddress,
          },
          {
            billingEmail: billingEmail ?? "",
            phonePolicy: "omit-empty",
            context: "checkout/success/[orderId]",
          },
        );

        // `lib/checkout-payment-data.ts` owns these keys — a contract with the
        // theme, and `completeOrderAction` re-finalises this same order from
        // the same builder, so a retry cannot drift a key from this attempt.
        const paymentData = buildStripeOrderPaymentData(sessionId, session);

        try {
          await processCheckoutOrderAction(
            session.cartToken as string,
            // Use the URL-derived order id/key (always valid — validated at the
            // top of the page), NOT session.orderId/orderKey which stay "0"/null
            // in the WC 10.8 deferred flow when the SUCCESS page won the create
            // race (the webhook never wrote them back). Passing null crashed the
            // finalize with a GraphQL non-null violation (KNOWN BUG).
            effectiveOrderId,
            effectiveOrderKey,
            {
              orderKey: effectiveOrderKey,
              billingAddress,
              shippingAddress,
              ...(billingEmail ? { billingEmail } : {}),
              paymentMethod: "headkit-payments",
              paymentData,
            },
          );
        } catch (orderErr) {
          const msg = orderErr instanceof Error ? orderErr.message : "";
          if (
            msg.includes("order expired") ||
            msg.includes("not found") ||
            msg.includes("Invalid order")
          ) {
            redirect("/checkout?reason=order_expired");
          }
          // We are on the return page AFTER a successful charge, with a valid
          // order URL — the order already exists. The bare /checkout/success
          // route or the Stripe webhook may have ALREADY finalized it, so a
          // re-finalize here fails with an ownership / already-paid error. That
          // is NOT a checkout failure: fall through to the confirmation render
          // instead of crashing to the error boundary (KNOWN BUG,
          // checkout-purchase.spec.ts ~L263). Checked FIRST: none of these
          // carries a code, and the branches below would otherwise read an
          // already-placed order as a failure.
          const alreadyFinalized =
            msg.includes("different customer") ||
            msg.includes("invalid_user") ||
            msg.includes("already paid") ||
            msg.includes("cannot be paid") ||
            msg.includes("must not be null");

          // The shopper has PAID. From here nothing may reach the error
          // boundary. Three dispositions, in this order: a refusal is terminal
          // and refunded, a validation failure is still paid and still
          // placeable, and a code belongs to exactly one of them.
          if (!alreadyFinalized) {
            const refusal = orderRefusalFromError(orderErr);
            if (refusal) {
              logOrderRefusal(refusal);
              return <OrderRefused refusal={refusal} />;
            }
            const validationFailure = orderValidationFromError(orderErr);
            if (validationFailure) {
              logOrderValidation(validationFailure);
              return (
                <CompleteOrder
                  failure={validationFailure}
                  orderId={String(effectiveOrderId || orderId)}
                  orderKey={String(effectiveOrderKey || orderKey)}
                  sessionId={sessionId}
                  /* The pair we actually SENT: its country is the one
                     WooCommerce rejected, and its shipping half is what the
                     form opens with. */
                  shippingAddress={shippingAddress}
                  billingAddress={billingAddress}
                  customerEmail={billingEmail ?? null}
                />
              );
            }
            // Nobody classified it and the shopper is holding a charged card,
            // so the LAST resort is the processing screen with its poller (the
            // webhook may yet place this order) and a line naming the order, so
            // a support thread starts from a fact. Never a throw.
            logUnexpectedFinalizeFailure(orderErr);
            return (
              <PaymentProcessing
                sessionId={sessionId}
                orderId={String(effectiveOrderId || orderId)}
              />
            );
          }
        }
        // Success OR already-finalized → route to the clean confirmation URL
        // (no session_id) for the deterministic order render. Kept OUTSIDE the
        // try/catch: redirect() signals via a thrown NEXT_REDIRECT and a catch
        // around it would swallow the navigation (the ISSUE-001 trap).
        redirect(
          `/checkout/success/${String(effectiveOrderId || orderId)}?key=${encodeURIComponent(String(effectiveOrderKey || orderKey))}`,
        );
      }
    }
  }

  const { storeSettings } = await getBranding();
  const isQuoteMode =
    normalizeCheckoutMode(storeSettings.checkoutType) === "quote" ||
    paymentMethod === "headkit-quote" ||
    (order?.paymentMethodTitle ?? "").toLowerCase().includes("quote");

  if (!order) {
    if (orderFetchFailed) {
      // Order is still transitioning (checkout-draft) or credentials are restricted —
      // show a minimal confirmation so the user isn't left with a crash.
      return (
        <>
          <ClearCart />
          <div className="mt-5 px-5 md:px-10">
            <h1 className="text-3xl mb-[10px] text-primary">
              {isQuoteMode
                ? "Your quote request was submitted."
                : "Your order is confirmed."}
            </h1>
            <p className="text-lg">
              {isQuoteMode ? (
                <>
                  Quote <span className="font-bold">#{orderId}</span> has been
                  received. We will follow up with pricing shortly.
                </>
              ) : (
                <>
                  Order <span className="font-bold">#{orderId}</span> has been
                  received. You will receive a confirmation email shortly.
                </>
              )}
            </p>
            <div className="mt-8">
              <Link
                href="/"
                className="inline-block rounded-lg bg-primary px-6 py-2.5 text-center text-sm font-medium text-on-primary hover:opacity-80"
              >
                Continue Shopping
              </Link>
            </div>
          </div>
        </>
      );
    }
    return notFound();
  }

  const currency = order.currency.code;
  const billing = order.billingAddress;
  const shipping = order.shippingAddress;
  const shippingLines = order.shippingLines ?? [];

  const shippingCost = shippingDisplayTotal(order);

  const itemsSubtotal = orderItemsDisplayTotal(order.items, order);
  const discount = orderDiscountDisplayTotal(order.items, order);

  // Click & Collect: WooCommerce copies the billing address into the order's
  // shipping fields even for pickup, but native Woo hides that address and shows
  // the pickup location instead (ShippingController: woocommerce_order_hide_shipping_address
  // + woocommerce_order_shipping_to_display). Mirror that here — suppress the
  // customer address on pickup orders and render the store collection address.
  const isPickupLine = (methodId: string) =>
    methodId === "pickup_location" || methodId === "local_pickup";
  const isPickupOrder = shippingLines.some((l) => isPickupLine(l.methodId));

  // GA4 `purchase` — the event the GTM container's 12 Google Ads conversion
  // labels trigger on. Built here, on the server, from the same order object
  // and the same tax-inclusive helpers the totals block below renders, so the
  // reported revenue is by construction the number printed on the page.
  //
  // Quote mode is deliberately excluded: a quote request is not a transaction
  // and must not create a conversion.
  //
  // The `orderFetchFailed` fallback render above emits nothing — it has no
  // order to report. That path is reached only while a draft order is still
  // transitioning, and it resolves to this render on the redirect that follows.
  const purchaseEvent = isQuoteMode
    ? null
    : buildPurchaseFromOrder(
        order,
        shippingCost,
        getStoreCurrency(),
        order.stockShortfall,
      );

  // Items that sold out after payment (checkout plan v3 §3): the theme
  // refunded them and the order carries the record. Null for every order
  // without one — and for a quote — and that order renders exactly as before.
  const refundMethod = refundMethodLabel(order.paymentMethodTitle);
  const shortfallNotice = isQuoteMode
    ? null
    : stockShortfallNotice(order.stockShortfall, currency, refundMethod);
  const shortfall = shortfallNotice ? (order.stockShortfall ?? null) : null;
  const shortfallCopy = shortfall
    ? shortfallStatusCopy(shortfall, { isPickup: isPickupOrder })
    : null;
  const shortfallTax = shortfall
    ? shortfallNetTax(
        shortfall,
        getFloatVal(order.totals.totalPrice),
        getFloatVal(order.totals.totalTax),
      )
    : 0;

  const hasShippingMethod = shippingLines.length > 0;
  const hasShippingAddress =
    !isPickupOrder &&
    !!(
      shipping?.address1?.trim() ||
      (shipping?.city?.trim() && shipping?.country?.trim())
    );
  const showShippingSection = hasShippingMethod || hasShippingAddress;

  if (shortfall && shortfallNotice?.fullyRefunded && shortfallCopy) {
    // Every line sold out and the whole order — shipping included — was
    // refunded. Nothing here may say the order is confirmed: the notice is the
    // page's heading, and the status line says the order will not ship. No
    // emitter is mounted: `purchaseEvent` is null for a fully refunded order
    // (`buildPurchaseFromOrder`), so there is no conversion to send.
    return (
      <>
        <ClearCart />
        <div className="grid grid-cols-12 gap-x-1 gap-y-5 md:gap-8 mt-5 px-5 md:px-10">
          <div className="col-span-12">
            <StockShortfallNotice notice={shortfallNotice} headingLevel={1} />
          </div>

          <div className="col-span-12 md:col-span-7 flex flex-col gap-6">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-lg">
                Order <span className="font-bold">#{order.orderNumber}</span>
                {" · "}
                <span
                  data-testid="stock-shortfall-status"
                  className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-sm font-semibold uppercase tracking-[0.02em] text-gray-800"
                >
                  {shortfallCopy.statusLabel}
                </span>
              </p>
              <p className="text-base text-gray-800">{shortfallCopy.subline}</p>
            </div>

            <ShortfallNextSteps text={shortfallCopy.nextSteps} />

            <div className="flex flex-col gap-3 md:flex-row">
              <Link
                href="/"
                className="inline-block rounded-lg bg-primary px-6 py-2.5 text-center text-sm font-medium text-on-primary hover:opacity-80"
              >
                Continue Shopping
              </Link>
              <Link
                href="/contact"
                className="inline-block rounded-lg border border-primary px-6 py-2.5 text-center text-sm font-medium text-primary hover:opacity-80"
              >
                Contact Us
              </Link>
            </div>
          </div>

          <div className="col-span-12 md:col-span-4">
            <div className="space-y-[20px] mb-10">
              <ShortfallLineRows
                order={order}
                shortfall={shortfall}
                currency={currency}
              />
            </div>
            <ShortfallMoneyRows
              shortfall={shortfall}
              orderTotal={getFloatVal(order.totals.totalPrice)}
              paymentMethodLabel={refundMethod}
              currency={currency}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ClearCart />
      <Ga4EcommerceEmitter
        event={purchaseEvent}
        {...(purchaseEvent?.ecommerce.transaction_id
          ? { dedupeKey: `purchase_${purchaseEvent.ecommerce.transaction_id}` }
          : {})}
      />
      <div className="grid grid-cols-12 gap-x-1 gap-y-5 md:gap-8 mt-5 px-5 md:px-10">
        {/* Part of the order sold out after payment and was refunded: the
            notice comes first, and the rest of the page is the confirmation
            of what is still coming. */}
        {shortfallNotice && (
          <div className="col-span-12">
            <StockShortfallNotice notice={shortfallNotice} headingLevel={2} />
          </div>
        )}

        {/* Heading */}
        <div className="col-span-12 w-full">
          <h1 className="text-3xl mb-[10px] text-primary">
            Thanks, {billing.firstName || shipping.firstName}!
          </h1>
        </div>

        {/* Left column — order info */}
        <div className="col-span-12 md:col-span-7 grid grid-cols-7">
          <div className="col-span-12 md:col-start-1 md:col-span-5">
            <div className="mb-10">
              <p className="font-extrabold text-3xl">
                {isQuoteMode
                  ? "Your quote request was submitted."
                  : shortfall
                    ? "The rest of your order is confirmed."
                    : "Your order is confirmed."}
              </p>
              <p className="text-lg">
                {isQuoteMode
                  ? "We will follow up with pricing and assistance shortly."
                  : (shortfallCopy?.subline ??
                    "You will receive a confirmation email shortly.")}
              </p>
              <br />
              <p className="font-bold text-2xl">
                {isQuoteMode ? "Quote" : "Order"} #{order.orderNumber}
              </p>
            </div>

            <div className="text-xl">
              {/* Contact */}
              <div className="grid grid-cols-4 md:grid-cols-3 mb-5 items-baseline gap-1 md:gap-4 font-medium text-lg mt-[8px]">
                <div className="col-span-1">
                  <div className="font-extrabold">Contact</div>
                </div>
                <div className="col-span-3 md:col-span-2">{billing.email}</div>
              </div>

              {/* Shipping — consolidated address + method */}
              {showShippingSection && (
                <div className="grid grid-cols-4 md:grid-cols-3 mb-5 items-baseline gap-1 md:gap-4 font-medium text-lg mt-[8px]">
                  <div className="col-span-1">
                    <div className="font-extrabold">
                      {isPickupOrder ? "Pickup" : "Shipping"}
                    </div>
                  </div>
                  <div className="col-span-3 md:col-span-2 space-y-1">
                    {hasShippingMethod && (
                      <>
                        {shippingLines.map((line, i) => {
                          // TAX-INCLUSIVE, so this agrees with the Shipping row
                          // in the totals block below. It used to render the
                          // line's raw wc/v3 `total`, which is tax-EXCLUSIVE —
                          // the same delivery quoted twice on one page at two
                          // different numbers. `null` means the order carries
                          // several paid shipping lines and the inclusive
                          // amount cannot be split across them; the method
                          // title then prints on its own rather than carrying
                          // an invented figure. See
                          // `orderShippingLineDisplayTotal`.
                          const lineTotal = isQuoteMode
                            ? null
                            : orderShippingLineDisplayTotal(order, line);
                          return (
                            <div key={i}>
                              <div>
                                {lineTotal === null ? (
                                  line.methodTitle
                                ) : (
                                  <>
                                    {line.methodTitle} /{" "}
                                    {lineTotal === 0
                                      ? "Free"
                                      : formatPrice(lineTotal, currency)}
                                  </>
                                )}
                              </div>
                              {isPickupLine(line.methodId) &&
                                (line.pickupAddress || line.pickupDetails) && (
                                  <div className="mt-1 text-base text-gray-600">
                                    {line.pickupAddress && (
                                      <div>{line.pickupAddress}</div>
                                    )}
                                    {line.pickupDetails && (
                                      <div className="text-sm">
                                        {line.pickupDetails}
                                      </div>
                                    )}
                                  </div>
                                )}
                            </div>
                          );
                        })}
                      </>
                    )}
                    {hasShippingAddress && (
                      <div className="mt-2">
                        {shipping?.firstName} {shipping?.lastName}
                        <br />
                        {shipping?.address1}
                        <br />
                        {shipping?.address2 && (
                          <>
                            {shipping.address2}
                            <br />
                          </>
                        )}
                        {shipping?.city} {shipping?.state} {shipping?.postcode}
                        <br />
                        {shipping?.country}
                        {shipping?.phone && (
                          <>
                            <br />
                            {shipping.phone}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Billing address */}
              <div className="grid grid-cols-4 md:grid-cols-3 mb-5 items-baseline gap-1 md:gap-4 font-medium text-lg mt-[8px]">
                <div className="col-span-1">
                  <div className="font-extrabold">Billing Address</div>
                </div>
                <div className="col-span-3 md:col-span-2">
                  {billing.firstName} {billing.lastName}
                  <br />
                  {billing.address1}
                  <br />
                  {billing.address2 && (
                    <>
                      {billing.address2}
                      <br />
                    </>
                  )}
                  {billing.city} {billing.state} {billing.postcode}
                  <br />
                  {billing.country}
                  <br />
                  {billing.phone}
                </div>
              </div>

              {/* Payment / quote method */}
              <div className="grid grid-cols-4 md:grid-cols-3 mb-5 items-baseline gap-1 md:gap-4 font-medium text-lg mt-[8px]">
                <div className="col-span-1">
                  <div className="font-extrabold">
                    {isQuoteMode ? "Request" : "Payment"}
                  </div>
                </div>
                <div className="col-span-3 md:col-span-2">
                  {isQuoteMode ? (
                    <>
                      Quote request
                      <br />
                      <span className="text-base font-normal text-gray-600">
                        Pending pricing follow-up
                      </span>
                    </>
                  ) : (
                    <>
                      {/* A shortfall order names the method only: its gross
                          total is not what was charged, and the summary's
                          Total charged row already says what was. */}
                      {!shortfall && (
                        <>
                          {formatPrice(
                            getFloatVal(order.totals.totalPrice),
                            currency,
                          )}
                          <br />
                        </>
                      )}
                      <PaymentMethodDisplay
                        cardBrand={paymentCardBrand}
                        cardLast4={paymentCardLast4}
                        paymentMethod={paymentMethod}
                        walletType={paymentWalletType}
                        paymentMethodTitle={order.paymentMethodTitle}
                        fallback={order.status}
                      />
                    </>
                  )}
                </div>
              </div>
            </div>

            {shortfallCopy && (
              <div className="mt-3">
                <ShortfallNextSteps text={shortfallCopy.nextSteps} />
              </div>
            )}

            <div className="flex flex-col gap-3 mt-8 md:flex-row">
              <Link
                href="/"
                className="inline-block rounded-lg bg-primary px-6 py-2.5 text-center text-sm font-medium text-on-primary hover:opacity-80"
              >
                Continue Shopping
              </Link>
            </div>
          </div>
        </div>

        {/* Right column — line items + totals */}
        <div className="col-span-12 md:col-span-4">
          <div className="space-y-[20px] mb-10">
            {shortfall ? (
              <ShortfallLineRows
                order={order}
                shortfall={shortfall}
                currency={currency}
              />
            ) : (
              order.items.map((item, i) => (
                <LineItemDisplay
                  key={i}
                  name={item.name}
                  images={item.images}
                  variation={item.variation ?? []}
                  quantity={item.quantity}
                  lineTotal={lineDisplayTotal(
                    item.totals,
                    item.prices?.price,
                    order,
                  )}
                  currency={currency}
                  giftCard={item.giftCard ?? null}
                  addons={item.addons}
                  hideLineTotal={isQuoteMode}
                  hideAddonPrices={isQuoteMode}
                />
              ))
            )}
          </div>

          {!isQuoteMode && (
            <>
              {/* Totals. Subtotal, Discount and Shipping are all tax-INCLUSIVE,
                  so Subtotal − Discount + Shipping equals the inclusive Total
                  and the Subtotal equals the line rows printed above it; the
                  tax row beneath them is informational, not another addend.
                  Subtotal and Discount are summed from the LINES because an
                  order's cart-level `totalItemsTax` / `totalDiscountTax` are
                  hard-coded "0" upstream. */}
              <div className="flex gap-4 justify-between font-medium">
                <p>Subtotal</p>
                <p>{formatPrice(itemsSubtotal, currency)}</p>
              </div>

              {discount > 0 && (
                <div className="flex gap-4 justify-between font-medium mt-[8px]">
                  <p>Discount</p>
                  <p>−{formatPrice(discount, currency)}</p>
                </div>
              )}

              <div className="flex gap-4 justify-between font-medium mt-[8px]">
                <p>Shipping</p>
                <p>
                  {shippingCost === 0
                    ? "Free"
                    : formatPrice(shippingCost, currency)}
                </p>
              </div>

              {!shortfall && getFloatVal(order.totals.totalTax) > 0 && (
                <div className="flex gap-4 justify-between font-medium mt-[8px]">
                  <p>Includes tax</p>
                  <p>
                    {formatPrice(getFloatVal(order.totals.totalTax), currency)}
                  </p>
                </div>
              )}

              {shortfall ? (
                <>
                  <ShortfallMoneyRows
                    shortfall={shortfall}
                    orderTotal={getFloatVal(order.totals.totalPrice)}
                    paymentMethodLabel={refundMethod}
                    currency={currency}
                  />
                  {/* The tax inside Total charged, under it — not the
                      order's own totalTax, which is the tax on the original
                      total (`shortfallNetTax`). */}
                  {shortfallTax > 0 && (
                    <div
                      data-testid="stock-shortfall-tax"
                      className="flex gap-4 justify-between font-medium mt-[8px]"
                    >
                      <p>Includes tax</p>
                      <p>{formatPrice(shortfallTax, currency)}</p>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex gap-4 justify-between text-xl mt-[20px]">
                  <p className="font-medium">Total</p>
                  <p className="font-medium">
                    {formatPrice(
                      getFloatVal(order.totals.totalPrice),
                      currency,
                    )}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

type ConfirmedOrder = NonNullable<Awaited<ReturnType<typeof getOrderAction>>>;

/** "What happens next" under a shortfall notice. */
function ShortfallNextSteps({ text }: { text: string }): React.ReactElement {
  return (
    <div className="rounded-lg bg-gray-100 px-5 py-4">
      <p className="font-semibold">What happens next</p>
      <p className="mt-1.5 text-base text-gray-800">{text}</p>
    </div>
  );
}

/**
 * The order's lines on a shortfall order: sold-out units struck through and
 * tagged with the refund, kept units tagged Confirmed. A line short by fewer
 * units than ordered renders twice — the kept units, then the sold-out ones.
 */
function ShortfallLineRows({
  order,
  shortfall,
  currency,
}: {
  order: ConfirmedOrder;
  shortfall: StockShortfall;
  currency: string;
}): React.ReactElement {
  const lineTotals = order.items.map((item) =>
    lineDisplayTotal(item.totals, item.prices?.price, order),
  );
  const splits = splitOrderLines(
    order.items.map((item, i) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      lineTotal: lineTotals[i] ?? 0,
    })),
    shortfall,
  );
  const soldOutTag = shortfallLineTag(shortfall.refundStatus);
  return (
    <>
      {order.items.flatMap((item, i) => {
        const split = splits[i];
        if (!split) return [];
        const common = {
          name: item.name,
          images: item.images,
          variation: item.variation ?? [],
          currency,
          giftCard: item.giftCard ?? null,
          addons: item.addons,
          hideLineTotal: false,
          hideAddonPrices: false,
        };
        const rows: React.ReactElement[] = [];
        if (split.keptQuantity > 0) {
          rows.push(
            <LineItemDisplay
              key={`${i}-kept`}
              {...common}
              quantity={split.keptQuantity}
              lineTotal={split.keptTotal}
              shortfallTag={{ kind: "kept", label: SHORTFALL_KEPT_LINE_TAG }}
            />,
          );
        }
        if (split.shortQuantity > 0) {
          rows.push(
            <LineItemDisplay
              key={`${i}-short`}
              {...common}
              quantity={split.shortQuantity}
              lineTotal={split.refundedTotal}
              shortfallTag={{ kind: "sold-out", label: soldOutTag }}
            />,
          );
        }
        return rows;
      })}
    </>
  );
}

/**
 * Paid / Refunded / Total charged, in place of the Total row. `Paid` is the
 * order total WooCommerce keeps on a refunded order; the refund is recorded
 * beside it, not netted into it.
 */
function ShortfallMoneyRows({
  shortfall,
  orderTotal,
  paymentMethodLabel,
  currency,
}: {
  shortfall: StockShortfall;
  orderTotal: number;
  paymentMethodLabel: string | null;
  currency: string;
}): React.ReactElement {
  const summary = shortfallMoneySummary(
    shortfall,
    orderTotal,
    paymentMethodLabel,
  );
  return (
    <div data-testid="stock-shortfall-summary">
      <div className="flex gap-4 justify-between font-medium mt-[8px]">
        <p>{summary.paidLabel}</p>
        <p>{formatPrice(summary.paid, currency)}</p>
      </div>
      <div className="flex gap-4 justify-between font-semibold mt-[8px] text-amber-700">
        <p>{summary.refundedLabel}</p>
        <p>−{formatPrice(summary.refunded, currency)}</p>
      </div>
      <div className="flex gap-4 justify-between text-xl mt-[20px] border-t border-gray-200 pt-[12px]">
        <p className="font-medium">{summary.chargedLabel}</p>
        <p className="font-medium">{formatPrice(summary.charged, currency)}</p>
      </div>
    </div>
  );
}
