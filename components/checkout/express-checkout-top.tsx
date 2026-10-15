"use client";

import { useCallback, useRef, useState, type ComponentProps } from "react";
import {
  ExpressCheckoutElement,
  useCheckout,
} from "@stripe/react-stripe-js/checkout";
import type {
  StripeCheckoutSession,
  StripeExpressCheckoutElementAvailablePaymentMethodsChangeEvent,
  StripeExpressCheckoutElementConfirmEvent,
} from "@stripe/stripe-js";
import type { CartFieldsFragment } from "@headkit/sdk";
import { isCheckoutSessionDead } from "@/lib/checkout-session-status";
import { CheckoutFormStepEnum } from "@/components/checkout/utils";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import {
  selectShippingAction,
  updateCustomerAddressAction,
} from "@/lib/cart-actions";
import { ensureCheckoutStockAction } from "@/lib/checkout-stock";
import { shippingDisplayTotal } from "@/lib/cart-prices";
import {
  eceShippingRateId,
  type EceShippingAddressChangeEvent,
  type EceShippingChangeDecision,
  type EceShippingRateChangeEvent,
  type ExpressCheckoutShippingEventProps,
} from "@/lib/stripe-ece-shipping-preview";
import {
  cartPricedForDelivery,
  cartRateForStripeShippingOption,
  walletConfirmPlan,
  walletConfirmRefusal,
  walletMayWriteShipping,
  walletRepriceRefusal,
  walletSheetDestination,
  walletUnserviceableRefusal,
  type WalletCartState,
  type WalletConfirmRefusal,
  type WalletDestination,
  type WalletShippingOptionMappingItem,
} from "@/lib/wallet-shipping";

/**
 * Stripe's own Checkout-mode element, widened by the two preview props it
 * WIRES at runtime and omits from its declared type.
 *
 * `lib/stripe-ece-shipping-preview.ts` carries the three readings behind this
 * — above all `dist/checkout.js:734`, which proves the props are attached.
 * This is the whole of the type escape, it is one line wide, and it introduces
 * no `any`: every handler below is checked against the preview's own shapes.
 */
const ExpressCheckoutElementWithShippingEvents =
  ExpressCheckoutElement as React.ComponentType<
    ComponentProps<typeof ExpressCheckoutElement> &
      ExpressCheckoutShippingEventProps
  >;

const ACCEPT: EceShippingChangeDecision = { type: "accept" };
const REJECT: EceShippingChangeDecision = { type: "reject" };

/**
 * What the page shows beneath the sheet when a shipping change was rejected.
 *
 * These events carry no `paymentFailed`, so the only thing the SHEET is told
 * is "rejected" — Apple Pay then says it cannot ship to the address, which is
 * right for the unserviceable case and uninformative for a failed write. The
 * inline copy is for the buyer who closes the sheet and carries on, so it
 * points at the page rather than at the address.
 */
const SHEET_UNSERVICEABLE_MESSAGE =
  "We cannot work out a delivery cost for that address. Please check it, or continue on the checkout page.";
const SHEET_UPDATE_FAILED_MESSAGE =
  "We could not update delivery for that choice. Please continue on the checkout page.";

/**
 * The cart state {@link shouldMountExpressCheckout} reads.
 *
 * Structural and all-optional on purpose: the live value is
 * `CartFieldsFragment`, which guarantees both fields, but the decision needs
 * only these two and a permissive shape keeps a test from building a whole
 * cart fragment to express "needs shipping, nothing selected".
 *
 * An alias of `WalletCartState` rather than a second declaration — the mount
 * gate and the confirm plan read the same two fields and must not be able to
 * drift apart on what a cart IS.
 */
export type ExpressCheckoutCartState = WalletCartState;

/**
 * Whether the Express / wallet block may be mounted at all.
 *
 * ## Two conditions, and the second one is now NARROW
 *
 * **The step.** Express stays available on every pay-capable step, Payment
 * included. Checkout Session `createPaymentElement` shows wallets when the
 * session has `card` and the platform supports them
 * (`wallets.applePay/googlePay` default `auto`). That is independent of
 * Express — Shopify Checkout and Stripe hosted checkout keep both. The
 * PaymentIntents PE+ECE de-dupe note does not apply to this Custom Checkout
 * Session path.
 * https://docs.stripe.com/js/custom_checkout/create_payment_element
 *
 * **The cart.** A cart that needs shipping mounts the element whatever its
 * delivery state — including when Local Pickup / Click & Collect is selected.
 * Platform #681 puts pickup locations on the session shipping menu (at $0,
 * selected first), so the wallet sheet can offer the same choice as monolithic
 * WooCommerce Apple Pay / Google Pay. The undercharge an unpriced cart used
 * to produce is closed INSIDE the sheet, by the two preview shipping handlers
 * below, with the confirm-time floor and price-and-refuse fallback
 * (`walletConfirmPlan`, `lib/wallet-shipping.ts`) behind them for an account
 * the preview is off for.
 *
 * ## This is a DELIBERATE REVERSAL of the gate PR #273 shipped
 *
 * That gate required a SELECTED, PRICED DELIVERY rate before mounting. It was
 * correct about the money and it closed live order 283750, but it cost
 * one-tap on two populations, and the second one was never at risk:
 *
 * - every paid-shipping cart, which is the point — but the wallet was hidden
 *   at the TOP of the page, which is where one-tap is worth most;
 * - **every free-shipping cart, whose amount was already right.** Measured
 *   (research `261010-bs-applepay-shipping-callbacks` finding 3c): an
 *   over-threshold cart with no address is indistinguishable from a
 *   sub-threshold one in the Store API payload — both return the two pickup
 *   rows, no delivery rate, nothing selected, `total_shipping: 0` — and the
 *   free-shipping threshold is an `advanced_free_shipping` plugin setting that
 *   is not surfaced anywhere in the cart response. So nothing here could
 *   separate them, and the safe gate hid the button for the store's
 *   highest-value traffic.
 *
 * Pricing from the sheet's own address (and in-sheet rate choice, including
 * Local Pickup) resolves both: the button is visible to everyone, and the
 * amount is made correct before anything is charged.
 *
 * ## Local Pickup is in-sheet, like monolithic WooCommerce
 *
 * Core `local_pickup` and Blocks `pickup_location` rates appear in the
 * wallet's shipping picker after commerce syncs the full menu (#681). Selecting
 * one re-selects that rate on the cart and re-syncs; confirming a $0-shipping
 * pickup cart is allowed. Keeping Express mounted while pickup is selected
 * also stops the element from disappearing mid-sheet when the buyer picks a
 * store in Apple Pay / Google Pay.
 *
 * A cart that needs no shipping at all (`needsShipping: false` — gift cards,
 * virtual products) mounts as it always did. There is no shipping to drop on
 * it and nothing to price.
 *
 * ## Fail-safe on an unknown cart
 *
 * An absent cart, or a cart whose `needsShipping` is neither `true` nor
 * `false`, does NOT mount. The decision has to be made before the element can
 * report anything, the confirm path cannot price what it cannot read, and the
 * cheap failure is a hidden button.
 *
 * Mounting is also what keeps the empty-state contract intact for free: the
 * element never mounts, so `onAvailablePaymentMethodsChange` never fires,
 * `hasWallet` stays false, and no heading, divider or inline error renders. The
 * gate lives at this ONE decision point for that reason — a second copy inside
 * the component could disagree with it.
 */
export function shouldMountExpressCheckout(
  step: CheckoutFormStepEnum,
  cart: ExpressCheckoutCartState | null | undefined,
): boolean {
  const payCapableStep =
    step === CheckoutFormStepEnum.CONTACT ||
    step === CheckoutFormStepEnum.DELIVERY_METHOD ||
    step === CheckoutFormStepEnum.ADDRESS ||
    step === CheckoutFormStepEnum.PAYMENT;
  if (!payCapableStep) return false;
  if (cart?.needsShipping === false) return true;
  if (cart?.needsShipping !== true) return false;
  return true;
}

/**
 * Express / wallet checkout (Apple Pay / Google Pay / Link) mounted at the TOP
 * of the checkout page, above the contact/email step. This is Stripe's canonical
 * placement so a buyer can pay in one tap and skip the form entirely.
 *
 * ## Shipping: the sheet re-prices IN-SHEET, through a Stripe PRIVATE PREVIEW
 *
 * A Checkout Session's `amount_total` is what a wallet confirm charges.
 * Commerce's `buildCheckoutLineItemParams` (platform #681) emits the FULL
 * shipping menu with the SELECTED rate first — ENG-780's charge-total
 * invariant still holds because Stripe auto-applies index 0 only. This element
 * mounts from the CONTACT step onward, before the buyer has entered any
 * address or chosen a delivery method, so the session went out with
 * `shipping_options: []` and `amount_total` equal to the item total — while
 * `shipping_address_collection` still made the sheet ask for, and return, a
 * real address.
 *
 * Live order 283750 on www.bikesociety.com.au is the evidence:
 * `pi_3UOsaCDMTJOcMWX61EfkyUbL`, `wallet.type: apple_pay`, session
 * `shipping_options: []`, `shipping_cost: null`, `amount_total: 2995` against
 * a WooCommerce order total of 4195, with a real AU shipping address
 * collected. The capture guard logged
 * `_headkit_amount_mismatch captured=2995 order_total=4195` and held the
 * order; the merchant was short the $12.00 delivery. Order 283749 is the
 * control: also a wallet payment (`wallet_type: link`) but on a free-shipping
 * cart, so there was nothing to drop and it charged correctly. The fault needs
 * wallet AND non-zero shipping together.
 *
 * It is now closed where it belongs — INSIDE the sheet, before the buyer
 * authorises anything — by Stripe's private preview "Event handlers for
 * Express Checkout Element with Checkout Sessions". Two async handlers run on
 * the element:
 *
 * - **`shippingaddresschange`** writes the sheet's (PARTIAL — see below)
 *   destination to the WooCommerce cart and re-syncs the session, so the
 *   sheet's own total becomes what WooCommerce will bill. A destination
 *   WooCommerce prices no delivery for is REJECTED, which is what makes the
 *   wallet say the address is unserviceable instead of quoting a wrong figure.
 * - **`shippingratechange`** maps the Stripe shipping-option id the buyer
 *   picked back to a WooCommerce rate id, selects that rate on the cart and
 *   re-syncs.
 *
 * Both do their work inside the EVENT-SCOPED `event.runServerUpdate`, never
 * the global `checkout.runServerUpdate` (that one deadlocks — the whole
 * decider run is already enqueued on Stripe's update queue, and the preview
 * note forbids it), and both return `{type: "accept"}` or `{type: "reject"}`.
 * `lib/stripe-ece-shipping-preview.ts` owns the event shapes, the local type
 * extension the shipped packages still need, and the readings behind both.
 *
 * ## THE PREVIEW IS A PER-ACCOUNT FLAG, AND IT CAN BE OFF
 *
 * The gate is `feature_flags.checkout_ece_shipping_events` in the Stripe.js
 * init response (`POST /v1/payment_pages/{cs}/init`). Read out of Stripe.js's
 * own `custom-checkout` chunk, 2026-10-14 — the handler runs only when the
 * flag is on:
 *
 * ```js
 * var h = p.rawPaymentPage.feature_flags?.checkout_ece_shipping_events
 *   ? getDecider(t)?.("shippingaddresschange") : null;
 * if (h) { …run our handler… } else { …Stripe's own default address update… }
 * ```
 *
 * Three things follow, and the third is why the confirm-time workaround below
 * is KEPT rather than deleted:
 *
 * 1. **Registering a handler is safe with the flag off.** The Checkout-mode
 *    element validates both event names (`["click", "shippingaddresschange",
 *    "shippingratechange"]` are in its accepted list and route to the decider
 *    registry), so nothing throws; the handler simply never fires and Stripe
 *    runs its own address update, which re-prices NOTHING on this store.
 * 2. **The account's default `client_only` shipping-update permission is
 *    enough.** `permissions[update_shipping_details]` appears in that chunk in
 *    exactly one place that touches this: with the flag ON *and*
 *    `server_only`, the element forces every payment method to unavailable
 *    until a `shippingaddresschange` decider exists. Under `client_only` —
 *    what `createCheckoutSession` (`app/checkout/actions.ts`) creates, since it
 *    passes no permissions — nothing is hidden and the deciders still fire on
 *    the flag alone. So no commerce change was needed to ship this.
 * 3. **Flag off ⇒ the confirm arrives on an unpriced cart, exactly as before.**
 *    The buyer must never be charged a total they did not see, so the
 *    confirm-time floor and the price-and-refuse fallback below stay as the
 *    last line of defence. Verified on acct_14lXTNDMTJOcMWX6 in TEST mode
 *    (`feature_flags.checkout_ece_shipping_events: true`, 2026-10-14);
 *    **LIVE mode is unconfirmed**, which alone makes deleting the fallback
 *    unacceptable.
 *
 * ## What the sheet's address IS, and why the cart write blanks the street
 *
 * `shippingaddresschange` carries `city`, `state`, `postal_code` and
 * `country` and **no `line1`** — Apple Pay and Google Pay withhold the street
 * until the buyer authorises. `city` + `postcode` + `country` are exactly what
 * WooCommerce needs before it selects any delivery rate (research
 * `261010-bs-applepay-shipping-callbacks` finding 3a), so that is enough to
 * price with.
 *
 * The write still sends every field, `address1: ""` included, because
 * `update-customer` MERGES field by field (finding 4): omitting `address1`
 * would leave a street the buyer typed on the page standing beside a NEW
 * suburb and postcode — a composite address that WooCommerce accepts, prices,
 * and that `resolveCheckoutAddresses` (`lib/checkout-address-sources.ts`)
 * would then treat as usable, because its `isUsableAddress` test is a
 * non-empty `address1`. Shipping a parcel to a half-stale address is strictly
 * worse than a blank street on a cart nothing ships from: the two Stripe
 * finalize paths read the SESSION's own
 * `collected_information.shipping_details` and the checkout cookies and never
 * the cart (`buildFinalizeAddresses` in `lib/finalize-address.ts` takes no
 * cart source at all), and the full street arrives there from the sheet at
 * confirm.
 *
 * ## The confirm path: one tap, with the old workaround kept behind it
 *
 * With the handlers live the session is already priced for the sheet's
 * destination by the time the buyer authorises, so `walletConfirmPlan` answers
 * `{action: "confirm"}` and the FIRST tap pays. Behind that:
 *
 * - **Stage 1, `walletConfirmRefusal` (`lib/wallet-shipping.ts`), is the
 *   FLOOR.** It refuses a confirm where the cart bills shipping and the
 *   session charges none — "charging the wrong amount is worse than refusing
 *   the payment" (ENG-789). It is what catches a flag-off account, a handler
 *   whose sync did not land, and the measured trap that **an explicit rate
 *   choice does not survive an address change** (choose Express at 1818,
 *   change state, and WooCommerce silently re-selects Standard at 1091 —
 *   finding 3b). Drift can go either way and a presence gate covers both
 *   directions.
 * - **The price-and-refuse fallback** still runs when the confirm arrives on
 *   an UNPRICED cart, which with the handlers live means they never fired:
 *   the destination is written, the session re-synced, and **the attempt is
 *   REFUSED** so the buyer approves the new figure on a fresh tap. An open
 *   wallet sheet displays the amount it was built with and never re-reads the
 *   session, so confirming after a re-price — candidate 4 in the research —
 *   charges more than the buyer saw. Refusing with `reason: "fail"` dismisses
 *   the sheet, and because that is a device behaviour this code cannot
 *   observe, a re-price ALSO bumps the element's `key`: Stripe's element is
 *   destroyed and recreated, so no stale sheet can survive to re-authorise
 *   against a figure that has moved.
 *
 * Mechanism 2 (the server-side amount verification at manual capture that
 * produced `_headkit_amount_mismatch` and saved 283750) is untouched and
 * remains authoritative for drift in either direction.
 *
 * ## What this does NOT do
 *
 * It does not re-price a cart that is ALREADY priced for delivery when the
 * buyer never touches the address in the sheet. That residual is pre-existing
 * and unchanged: the finalize posts the sheet's address and WooCommerce
 * re-prices for it, which is a no-op across AU (every AU destination costs the
 * same — finding 3b) and lands on mechanism 2 if the buyer's sheet address is
 * in another country.
 *
 * After an in-sheet address write + sync, commerce (#681) puts every available
 * rate on the session with the selected one first, so the sheet's shipping
 * picker offers the same menu as monolithic WooCommerce Apple Pay / Google Pay
 * (delivery and Local Pickup, capped at Stripe's five-option limit).
 * `shippingratechange` maps the Stripe id the buyer picks back through
 * `shippingOptionMapping` and re-selects that rate on the cart — pickup
 * included.
 *
 * ## Interaction with ENG-784 — why `keepCheckoutSession: true` is SAFE here
 *
 * Mechanism 1 (expire-before-mutate in `withCartRetry`) exists so an in-flight
 * payment can never confirm against a pre-mutation amount. EVERY cart write in
 * this file opts out of it — the two shipping handlers and the confirm-time
 * fallback alike — and five things make that safe rather than merely
 * convenient:
 *
 * 1. **There is no in-flight payment to protect.** `checkout.confirm()` is
 *    never called on an attempt that mutates: a shipping handler runs while
 *    the sheet is open and UNAUTHORISED, and the confirm-time fallback refuses
 *    the attempt it priced. So the window mechanism 1 guards is empty by
 *    construction.
 * 2. **The re-sync is in the same awaited sequence as the mutation**, so the
 *    session's `amount_total` is brought up to the post-mutation cart total
 *    before the buyer can tap again, and the refreshed session is read back to
 *    check that it landed.
 * 3. **A failed re-sync degrades to a REFUSAL, never an undercharge.** It
 *    leaves the session priced below the cart, which is precisely the state
 *    the stage-1 floor refuses — and it refuses the next tap too.
 * 4. **Expiring instead would be strictly worse.** The default would kill the
 *    very session the next tap must confirm against, forcing a provider
 *    remount through the dead-session recovery path — which is deliberately
 *    ONE-SHOT per session id (`handleSessionExpired` in `CheckoutForm`), so a
 *    second re-price could leave the buyer with a dead session and no
 *    recovery, mid-sheet.
 * 5. **The storefront's own sync effect is not a substitute.** It skips the
 *    CONTACT step entirely (`CheckoutForm`'s line-items effect returns early
 *    there), and CONTACT is where this block matters most. `setCartData` is
 *    still called so the page agrees with the cart, and the effect's later
 *    sync is an idempotent duplicate on the steps that run it — but the
 *    in-handler sync is the load-bearing one.
 *
 * Mechanism 2 (the amount verification at manual capture that produced
 * `_headkit_amount_mismatch` and saved 283750) is untouched and remains
 * authoritative for drift in either direction.
 *
 * ## Failure signaling (ENG-789)
 *
 * Every confirm failure path calls `event.paymentFailed(...)` so the wallet
 * sheet itself shows the failure state instead of silently closing while the
 * error only appears inline on the page beneath. The inline message is kept as
 * the on-page fallback. **It is called exactly once per event, on every path**,
 * including a thrown or timed-out re-price: a sheet left spinning is worse
 * than any refusal, so the re-price races a timeout
 * (`REPRICE_TIMEOUT_MS`) chosen to land inside `runServerUpdate`'s own 20 s
 * budget. This store's WordPress origin is rate-limited near 1.8 req/s and has
 * had outages, so a hung write is a real state rather than a defensive one.
 *
 * Single-instance rule: exactly one ExpressCheckoutElement may exist per
 * CheckoutProvider. This is THE instance — it stays mounted on Payment so
 * Express buttons do not disappear while Payment Element also shows wallets.
 * The `key` bump after a re-price replaces it rather than adding a second.
 *
 * Empty state: the element renders nothing when the device/browser has no
 * available wallet. Whenever this component renders at all the element stays
 * mounted (so it can report availability), but the surrounding label + divider
 * only render once `onAvailablePaymentMethodsChange` reports at least one
 * method — so unsupported browsers see no empty gap or dangling "Or" divider.
 * The same `hasWallet` flag gates the inline error block, which is why the
 * mount gate above needs no second empty-state rule of its own: an unmounted
 * component reports no method, so nothing around it renders either.
 */
/**
 * Whether Stripe reported at least one wallet the buyer can actually use.
 *
 * `event.paymentMethods` is an OBJECT keyed by wallet
 * (`{link?: {available}, applePay?: {available}, …}`), not a list and not a
 * boolean, so the obvious `Boolean(event.paymentMethods)` is `true` for
 * `{applePay: {available: false}, googlePay: {available: false}}` — every
 * wallet unavailable, and still truthy. That rendered the "Express checkout"
 * heading and the "OR" divider around a zero-height element: a label and a rule
 * framing nothing.
 *
 * Nobody has seen it, which is exactly why it is worth fixing now: the stores
 * this ships to have Link available, so `hasWallet` has always been
 * legitimately true. It surfaces the first time a buyer arrives with Link
 * disabled on the account and no platform wallet — a browser/store combination
 * no one has happened to test.
 *
 * Exported for test; there is no other caller.
 */
export function hasAvailableWallet(
  paymentMethods: StripeExpressCheckoutElementAvailablePaymentMethodsChangeEvent["paymentMethods"],
): boolean {
  return Object.values(paymentMethods ?? {}).some((m) => m?.available === true);
}

/**
 * How long the re-price may take before the attempt is refused anyway.
 *
 * `paymentFailed` must be called on every path — a wallet sheet left spinning
 * is worse than any refusal — and the re-price is two network hops to an
 * origin this store rate-limits near 1.8 req/s and that has had outages, so a
 * hung write is a real state rather than a defensive one. 15 s sits inside
 * `runServerUpdate`'s own 20 s budget, so the timeout fires first and the
 * refusal is this module's rather than Stripe's.
 */
const REPRICE_TIMEOUT_MS = 15_000;

/**
 * `work`, or `onTimeout()`'s value if it has not settled within `ms`.
 *
 * The loser's rejection is swallowed deliberately: once the race is decided a
 * late failure has nowhere to be reported and would surface as an unhandled
 * rejection. A rejection that arrives FIRST still propagates, so the caller's
 * own failure handling is untouched.
 */
async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  work.catch(() => {});
  try {
    return await Promise.race([
      work,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(onTimeout()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The session's own formatted total — the exact string the next wallet sheet
 * will display — or `null` when it is not readable.
 *
 * Stripe's `StripeCheckoutAmount` promises `amount` as a `string`, but the
 * session arrives over the wire and the type is a hand-written declaration
 * rather than a validator. A quoted figure is a promise to the buyer about
 * what they are about to be charged, so an unreadable one must become "no
 * figure" and not `"undefined"` in a wallet sheet.
 */
function sessionTotalAmount(session: StripeCheckoutSession): string | null {
  const amount = session.total?.total?.amount;
  return typeof amount === "string" && amount.trim().length > 0 ? amount : null;
}

export function ExpressCheckoutTop({
  sessionId,
  onSessionExpired,
  shippingOptionMapping,
}: {
  /** ENG-784: active Checkout Session id for confirm-time dead-session checks. */
  sessionId?: string;
  /** ENG-784: called when a confirm failure traces to a dead session (D7). */
  onSessionExpired?: () => void;
  /**
   * The newest cart-rate → Stripe-shipping-option table the PAGE holds.
   *
   * Only a SEED: Stripe recreates those ids on every line-item sync, so a
   * table this component's own sync returned always wins over it. It exists
   * because a `shippingratechange` can be the first shipping event of all on a
   * cart that was already priced on the page, before any handler here has
   * synced anything.
   */
  shippingOptionMapping?: readonly WalletShippingOptionMappingItem[];
} = {}): React.ReactElement {
  const checkoutState = useCheckout();
  const { cartData, setCartData } = useCartContext();
  const [hasWallet, setHasWallet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a re-price so Stripe's element is destroyed and recreated —
  // the head of this file explains why a stale sheet must not survive one.
  const [elementKey, setElementKey] = useState(0);
  // One cart write at a time, shared by both shipping handlers and the
  // confirm-time fallback: two concurrent writes would race on the cart and
  // could leave the session synced against the loser. Stripe serialises its
  // own deciders on one update queue, so this only has to cover the
  // handler-versus-confirm case — and it costs a rejected change, never a
  // charge.
  const repricingRef = useRef(false);
  // The mapping the LAST sync returned, which is the only one whose Stripe
  // option ids are still live. Null until this component has synced once.
  const syncedMappingRef = useRef<WalletShippingOptionMappingItem[] | null>(
    null,
  );

  // ENG-784: a wallet confirm failure may mean the session was expired under
  // us (cart mutated in another tab → mechanism 1). Ask the SERVER for the
  // session status (D7 — never error-string sniffing); dead → one-shot
  // auto-recreate via onSessionExpired, alive → keep inline error handling.
  const recoverIfSessionDead = useCallback(async (): Promise<boolean> => {
    if (!sessionId || !onSessionExpired) return false;
    if (!(await isCheckoutSessionDead(sessionId))) return false;
    onSessionExpired();
    return true;
  }, [sessionId, onSessionExpired]);

  /**
   * Re-sync the Checkout Session's line items and shipping options to the
   * cart, and remember the shipping-option mapping that came back.
   *
   * THROWS on any non-ok response, because every caller runs inside a
   * `runServerUpdate` where a throw is how the change is refused — swallowing
   * it would leave the session priced below the cart with the sheet advancing.
   *
   * The mapping is best-effort by contrast: a body that will not parse must
   * not fail a sync that succeeded. The cost of losing it is a rejected
   * `shippingratechange`, not a wrong amount.
   */
  const syncSessionLineItems = async (): Promise<void> => {
    const response = await fetch("/api/checkout/sync-line-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    if (!response.ok) throw new Error("sync-line-items failed");
    try {
      const body = (await response.json()) as {
        shippingOptionMapping?: WalletShippingOptionMappingItem[] | null;
      };
      if (Array.isArray(body?.shippingOptionMapping)) {
        syncedMappingRef.current = body.shippingOptionMapping;
      }
    } catch {
      /* mapping unreadable — see above */
    }
  };

  /** Tell the sheet, and the page beneath it, that this attempt is refused. */
  const refuse = (
    event: StripeExpressCheckoutElementConfirmEvent,
    refusal: WalletConfirmRefusal,
  ): void => {
    event.paymentFailed({ reason: refusal.reason, message: refusal.message });
    setError(refusal.message);
  };

  /**
   * Write the sheet's destination to the cart, re-sync the session, and answer
   * with the refusal this attempt must end in.
   *
   * It NEVER returns "go ahead": pricing and confirming in one attempt charges
   * against a figure the buyer has not seen. The caller refuses whatever comes
   * back.
   *
   * The session is read back out of `runServerUpdate`'s own result rather than
   * assumed, and the stage-1 floor is re-run against it: if the sync did not
   * land, the session is still priced below the cart and no total may be
   * quoted.
   */
  const repriceFromSheet = async (
    checkout: Extract<
      ReturnType<typeof useCheckout>,
      { type: "success" }
    >["checkout"],
    destination: WalletDestination,
  ): Promise<WalletConfirmRefusal> => {
    // A holder rather than a `let`: TypeScript's control-flow analysis cannot
    // see that the callback ran, and would narrow a reassigned local back to
    // `null` after the await.
    const written: { cart: CartFieldsFragment | null } = { cart: null };
    const result = await checkout.runServerUpdate(async () => {
      // keepCheckoutSession: the session must SURVIVE this mutation — it is
      // the one the next tap confirms against, and the sync below brings it
      // up to the new total. The head of this file carries the five reasons
      // that makes this safe rather than a hole in ENG-784 mechanism 1.
      const update = await updateCustomerAddressAction(
        { shippingAddress: destination },
        { keepCheckoutSession: true },
      );
      if (!update.success) throw new Error(update.error);
      written.cart = update.cart;
      // Nothing to sync when WooCommerce priced no delivery for this
      // destination — the session is already right for a cart that gained no
      // shipping, and the caller reports the address instead.
      if (!cartPricedForDelivery(update.cart)) return;
      await syncSessionLineItems();
    });

    // The page must agree with the cart whatever happened next, and on the
    // steps that run it this also re-triggers CheckoutForm's own sync effect —
    // an idempotent duplicate of the sync above, and no substitute for it
    // (that effect returns early on CONTACT).
    if (written.cart) setCartData(written.cart);

    if (result.type === "error") return walletRepriceRefusal(null);
    if (!written.cart || !cartPricedForDelivery(written.cart)) {
      return walletUnserviceableRefusal();
    }
    const floor = walletConfirmRefusal({
      cartShippingCost: shippingDisplayTotal(written.cart),
      sessionShippingMinorUnits:
        result.session.shipping?.shippingOption.minorUnitsAmount ?? null,
    });
    if (floor) return walletRepriceRefusal(null);
    return walletRepriceRefusal(sessionTotalAmount(result.session));
  };

  /**
   * Run one shipping-sheet change against the cart and the session.
   *
   * The whole body of work happens inside the EVENT-SCOPED
   * `event.runServerUpdate` — never the global `checkout.runServerUpdate`,
   * which deadlocks here (the decider run is already enqueued on Stripe's
   * update queue) and which the preview note forbids outright. Stripe applies
   * its own 18 s timeout to that callback and THROWS when it expires, so this
   * needs no timeout of its own: a hung WordPress write surfaces as a
   * rejection rather than a sheet left spinning.
   *
   * On accept Stripe re-retrieves the session and rebuilds the sheet from its
   * line items and shipping options, which is why the sync has to be inside
   * the callback and not after it.
   */
  const runSheetShippingUpdate = async (
    runServerUpdate: (work: () => Promise<unknown>) => Promise<void>,
    work: () => Promise<{ cart: CartFieldsFragment | null }>,
  ): Promise<EceShippingChangeDecision> => {
    if (
      !sessionId ||
      repricingRef.current ||
      !walletMayWriteShipping(cartData)
    ) {
      // No session to re-price, a write already in flight, or a cart this
      // element must never write shipping to (unknown, or Click & Collect —
      // `walletMayWriteShipping` owns that rule and `walletConfirmPlan`
      // repeats it at confirm). Rejecting leaves the sheet where it is.
      setError(SHEET_UPDATE_FAILED_MESSAGE);
      return REJECT;
    }
    repricingRef.current = true;
    const written: { cart: CartFieldsFragment | null } = { cart: null };
    try {
      await runServerUpdate(async () => {
        const result = await work();
        written.cart = result.cart;
        if (!cartPricedForDelivery(result.cart)) {
          // WooCommerce priced no delivery for this destination (or lost the
          // rate). Throwing is what rejects the change, so the wallet says the
          // address is unserviceable instead of quoting a figure that does not
          // cover delivery.
          throw new Error("cart not priced for delivery");
        }
        await syncSessionLineItems();
      });
    } catch {
      setError(
        written.cart && !cartPricedForDelivery(written.cart)
          ? SHEET_UNSERVICEABLE_MESSAGE
          : SHEET_UPDATE_FAILED_MESSAGE,
      );
      return REJECT;
    } finally {
      repricingRef.current = false;
      // The page must agree with the cart whatever happened next — including
      // after a rejection, where the destination landed and the pricing did
      // not.
      if (written.cart) setCartData(written.cart);
    }
    setError(null);
    return ACCEPT;
  };

  /**
   * `shippingaddresschange` — price the cart for the destination the buyer
   * picked in the sheet, then let the sheet advance showing the new total.
   *
   * The address is PARTIAL (no `line1`) and the write is still a full replace
   * with `address1: ""`; the head of this file carries why that is the safe
   * direction rather than a lossy one.
   */
  const handleShippingAddressChange = async (
    event: EceShippingAddressChangeEvent,
  ): Promise<EceShippingChangeDecision> => {
    const destination = walletSheetDestination({
      name: event.name ?? "",
      address: event.address ?? null,
    });
    if (!destination) {
      // `city` + `postcode` + `country` are what WooCommerce needs before it
      // selects any rate (finding 3a), so a half destination buys nothing and
      // the cart must not be mutated for it.
      setError(SHEET_UNSERVICEABLE_MESSAGE);
      return REJECT;
    }
    return runSheetShippingUpdate(event.runServerUpdate, async () => {
      // keepCheckoutSession: the session must SURVIVE this mutation — it is
      // the one the sheet is about to confirm against, and the sync inside the
      // same callback brings it up to the new total.
      const update = await updateCustomerAddressAction(
        { shippingAddress: destination },
        { keepCheckoutSession: true },
      );
      if (!update.success) throw new Error(update.error);
      return { cart: update.cart };
    });
  };

  /**
   * `shippingratechange` — select the WooCommerce rate behind the Stripe
   * shipping option the buyer picked, then re-sync.
   *
   * The sheet reports a STRIPE option id and Stripe recreates those on every
   * sync, so the lookup table is the newest one this component synced, falling
   * back to the page's. `cartRateForStripeShippingOption` owns that rule and
   * refuses rather than guesses — selecting the wrong rate is a wrong-price
   * order.
   */
  const handleShippingRateChange = async (
    event: EceShippingRateChangeEvent,
  ): Promise<EceShippingChangeDecision> => {
    const selectable = cartRateForStripeShippingOption(
      syncedMappingRef.current ?? shippingOptionMapping,
      cartData?.shippingRates,
      eceShippingRateId(event),
    );
    if (!selectable) {
      setError(SHEET_UPDATE_FAILED_MESSAGE);
      return REJECT;
    }
    return runSheetShippingUpdate(event.runServerUpdate, async () => {
      const update = await selectShippingAction(
        selectable.packageId,
        selectable.rateId,
        { keepCheckoutSession: true },
      );
      if (!update.success) throw new Error(update.error);
      return { cart: update.cart };
    });
  };

  const handleConfirm = (
    event: StripeExpressCheckoutElementConfirmEvent,
  ): void => {
    if (checkoutState.type !== "success") {
      // Checkout state not ready — confirm cannot proceed at all. Signal the
      // wallet sheet so it shows a failure instead of silently closing.
      event.paymentFailed({ reason: "fail" });
      return;
    }
    const { checkout } = checkoutState;

    // Stock gate BEFORE any Stripe charge. Page-load validation is stale by
    // the time a wallet sheet confirms; without this, OOS carts pay Stripe
    // then land on the async "payment is processing" dead-end.
    void ensureCheckoutStockAction()
      .then((stock) => {
        if (!stock.ok) {
          if (stock.cart) setCartData(stock.cart);
          refuse(event, { reason: "fail", message: stock.message });
          if (stock.sessionExpired && onSessionExpired) {
            onSessionExpired();
          }
          return;
        }
        if (stock.cart) setCartData(stock.cart);

        // `checkout` IS the session (the hook's value spreads
        // `StripeCheckoutSession` over the actions), so this reads the live
        // session rather than a render-time copy.
        const plan = walletConfirmPlan({
          cart: stock.cart,
          cartShippingCost: shippingDisplayTotal(stock.cart),
          sessionShippingMinorUnits:
            checkout.shipping?.shippingOption.minorUnitsAmount ?? null,
          sheetShippingAddress: event.shippingAddress,
        });

        if (plan.action === "refuse") {
          refuse(event, plan.refusal);
          return;
        }

        if (plan.action === "price") {
          // No session id means the cart could be priced and the session could
          // not, which is the one state that must not be entered: it would leave
          // the session below the cart with nothing able to raise it. Refuse
          // WITHOUT mutating anything.
          if (!sessionId || repricingRef.current) {
            refuse(event, walletRepriceRefusal(null));
            return;
          }
          repricingRef.current = true;
          setError(null);
          void withTimeout(
            repriceFromSheet(checkout, plan.destination),
            REPRICE_TIMEOUT_MS,
            () => walletRepriceRefusal(null),
          )
            .catch(() => walletRepriceRefusal(null))
            .then((refusal) => {
              repricingRef.current = false;
              refuse(event, refusal);
              setElementKey((key) => key + 1);
            });
          return;
        }

        setError(null);
        void checkout
          .confirm({ expressCheckoutConfirmEvent: event })
          .then(async (result) => {
            if (result.type === "error") {
              event.paymentFailed({ reason: "fail" });
              if (await recoverIfSessionDead()) return;
              setError(
                result.error.message ?? "Payment failed. Please try again.",
              );
            }
          })
          .catch(async (err: unknown) => {
            event.paymentFailed({ reason: "fail" });
            if (await recoverIfSessionDead()) return;
            setError(
              err instanceof Error
                ? err.message
                : "An unexpected error occurred.",
            );
          });
      })
      .catch(() => {
        refuse(event, {
          reason: "fail",
          message:
            "We could not verify stock for this order. Please try again.",
        });
      });
  };

  const handleAvailablePaymentMethodsChange = (
    event: StripeExpressCheckoutElementAvailablePaymentMethodsChangeEvent,
  ): void => {
    setHasWallet(hasAvailableWallet(event.paymentMethods));
  };

  return (
    <div data-testid="express-checkout-section">
      {hasWallet && (
        <p className="mb-3 text-sm font-medium text-gray-700">
          Express checkout
        </p>
      )}
      {/* Always mounted so Stripe can report wallet availability; renders empty
          (zero height) when no wallet is supported on this device/browser. */}
      <div data-testid="express-checkout">
        <ExpressCheckoutElementWithShippingEvents
          // Destroy-and-recreate after a re-price. An open wallet sheet keeps
          // showing the amount it was built with, so a sheet that survived a
          // re-price could re-authorise against a figure that has moved — see
          // the head of this file.
          key={elementKey}
          options={{
            // Force the wallet buttons to render whenever the platform supports
            // them, instead of the default "auto" (which only shows when the
            // buyer is already signed in / Stripe deems it advantageous, and
            // never shows Apple Pay on desktop Chromium). "always" shows the
            // button even when the buyer isn't logged in, opening a sign-in /
            // add-card flow on tap.
            // https://docs.stripe.com/js/elements_object/create_express_checkout_element
            paymentMethods: {
              applePay: "always",
              googlePay: "always",
            },
            // The Checkout-subpath options type requires every key; leave the
            // rest at their Stripe defaults.
            buttonHeight: undefined,
            buttonTheme: undefined,
            buttonType: undefined,
            layout: undefined,
            paymentMethodOrder: undefined,
          }}
          onConfirm={handleConfirm}
          onAvailablePaymentMethodsChange={handleAvailablePaymentMethodsChange}
          // The two PREVIEW handlers. Registering them is inert on an account
          // without `checkout_ece_shipping_events` — the element accepts both
          // event names and simply never calls them — which is why the
          // confirm-time floor and fallback above stay in place.
          onShippingAddressChange={handleShippingAddressChange}
          onShippingRateChange={handleShippingRateChange}
        />
      </div>
      {hasWallet && error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {hasWallet && (
        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-gray-200" />
          <span className="text-xs uppercase tracking-wide text-gray-400">
            Or
          </span>
          <span className="h-px flex-1 bg-gray-200" />
        </div>
      )}
    </div>
  );
}
