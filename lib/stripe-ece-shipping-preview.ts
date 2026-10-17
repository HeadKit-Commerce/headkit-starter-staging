/**
 * The Stripe PRIVATE-PREVIEW shipping events for the Express Checkout Element
 * on a Checkout Session (`ui_mode=custom`), typed locally because the shipped
 * packages do not type them yet.
 *
 * ## Why a local declaration at all
 *
 * The preview ("Event handlers for Express Checkout Element with Checkout
 * Sessions") is ahead of both published type packages, and the three readings
 * that matter were taken from the INSTALLED code rather than inferred:
 *
 * - `@stripe/stripe-js@9.16.0`'s `StripeCheckoutExpressCheckoutElement`
 *   (`dist/stripe-js/checkout.d.ts:542-667`) enumerates `on()` overloads for
 *   `ready`, `focus`, `blur`, `escape`, `loaderror`, `confirm` and `cancel`
 *   and NO shipping event. The Elements-mode element
 *   (`dist/stripe-js/elements/express-checkout.d.ts:144-181`) declares both.
 * - `@stripe/react-stripe-js@6.10.0` STRIPS both props from the
 *   Checkout-subpath component: `dist/checkout.d.ts:473`/`:477` declare them,
 *   but on the ROOT Elements interface, and the exported component's props are
 *   `dist/checkout.d.ts:828` —
 *   `Omit<RootExpressCheckoutElementProps, "options" | "onClick" |
 *   "onShippingAddressChange" | "onShippingRateChange">`. So passing either is
 *   a TS2322 against the declared type.
 * - **It nevertheless WIRES them at runtime.** The same subpath's
 *   `createElementComponent` calls
 *   `useAttachEvent(element, 'shippingaddresschange', onShippingAddressChange)`
 *   and the `shippingratechange` twin (`dist/checkout.js:734-735`), and
 *   `useAttachEvent` is `element.on(...)` with an `element.off(...)` cleanup.
 *   So the props reach the element; only the TYPE refuses them.
 *
 * Hence {@link ExpressCheckoutShippingEventProps}: the minimum widening that
 * lets the real component take the two handlers, with no `any` anywhere and no
 * fork of either package. When Stripe ships the types, delete this module and
 * take theirs.
 *
 * ## Where the event SHAPES come from
 *
 * Read out of Stripe.js's own `custom-checkout` chunk
 * (`https://js.stripe.com/v3/fingerprinted/js/custom-checkout-<hash>.js`,
 * 2026-10-14), which is where the Checkout-mode element decides whether a
 * handler runs at all:
 *
 * ```js
 * // shippingaddresschange
 * var h = p.rawPaymentPage.feature_flags?.checkout_ece_shipping_events
 *   ? getDecider(t)?.("shippingaddresschange") : null;
 * if (h) w({ …, callDecider: (e) => h({
 *     name: l,
 *     address: {city: u.city||"", state: u.state||"", postal_code: u.postal_code||"", country: u.country},
 *     runServerUpdate: e }) });
 * else { …Stripe's own default address update… }
 *
 * // shippingratechange
 * callDecider: (e) => f({ rate: {id: i.id, amount: i.amount, displayName: i.displayName},
 *                         runServerUpdate: e })
 * ```
 *
 * Three consequences are load-bearing and each is a decision this module
 * records rather than a guess:
 *
 * 1. **The rate arrives as `event.rate`, not `event.shippingRate`.** The
 *    Elements-mode public type spells it `shippingRate`
 *    (`express-checkout.d.ts:594-598`) and so does some preview
 *    correspondence, so {@link EceShippingRateChangeEvent} declares BOTH as
 *    optional and {@link eceShippingRateId} reads `rate` first. A preview that
 *    renames the field must not silently become "no rate id", which is a
 *    refused rate change on every wallet.
 * 2. **The address is PARTIAL — no `line1`, no `line2`.** Apple Pay and Google
 *    Pay withhold the street until the buyer authorises, which is why the
 *    cart write driven from this event must be a pricing write (city,
 *    postcode, country) and nothing else.
 * 3. **`runServerUpdate` here is the EVENT-SCOPED one and is NOT the global
 *    `checkout.runServerUpdate`.** It resolves to `void`, THROWS on failure
 *    (its own 18 s timeout included — `timeoutMs:18e3` in that chunk), and on
 *    success re-retrieves the payment page so the refreshed session is what
 *    Stripe hands the wallet. Calling the global one inside a handler
 *    deadlocks, because the whole decider run is already enqueued on the
 *    update queue; Stripe's preview note forbids it outright.
 */

/**
 * The event-scoped server-update wrapper.
 *
 * Resolves with nothing: unlike `checkout.runServerUpdate` there is no
 * `{type, session}` result to read, so a handler learns success from the
 * absence of a throw and must read any figure it needs from its own work.
 */
export type EceRunServerUpdate = (
  work: () => Promise<unknown>,
) => Promise<void>;

/**
 * What a shipping handler must return.
 *
 * `accept` refreshes the wallet with the session's current line items and
 * shipping options; `reject` (and any throw, and any other value — Stripe
 * warns and treats it as a reject) stops the sheet advancing.
 */
export type EceShippingChangeDecision = { type: "accept" } | { type: "reject" };

/** The partial address the wallet reports as the buyer picks one. */
export interface EcePartialAddress {
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

/** `shippingaddresschange` as the preview emits it. */
export interface EceShippingAddressChangeEvent {
  name?: string | null;
  address?: EcePartialAddress | null;
  runServerUpdate: EceRunServerUpdate;
}

/** `shippingratechange` as the preview emits it. See note 1 above. */
export interface EceShippingRateChangeEvent {
  /** The spelling Stripe.js actually sends in Checkout mode. */
  rate?: { id?: string | null } | null;
  /** The spelling the public Elements-mode type uses. Read second. */
  shippingRate?: { id?: string | null } | null;
  runServerUpdate: EceRunServerUpdate;
}

/**
 * The two props the Checkout-subpath `<ExpressCheckoutElement>` wires at
 * runtime and omits from its declared type.
 */
export interface ExpressCheckoutShippingEventProps {
  onShippingAddressChange?: (
    event: EceShippingAddressChangeEvent,
  ) => Promise<EceShippingChangeDecision>;
  onShippingRateChange?: (
    event: EceShippingRateChangeEvent,
  ) => Promise<EceShippingChangeDecision>;
}

/**
 * The Stripe shipping-option id the buyer selected in the sheet, or `null`.
 *
 * `rate` first, `shippingRate` second — note 1 above. A blank or absent id is
 * `null` rather than `""`, so a caller cannot look it up in a mapping and
 * match an empty key.
 */
export function eceShippingRateId(
  event: EceShippingRateChangeEvent | null | undefined,
): string | null {
  const id = event?.rate?.id ?? event?.shippingRate?.id;
  return typeof id === "string" && id.trim().length > 0 ? id.trim() : null;
}
