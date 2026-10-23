/**
 * ONE owner for "the shopper paid, and WooCommerce refused the order over a
 * DETAIL they can still fix".
 *
 * A finalize after a successful payment can be refused with a
 * `woocommerce_rest_invalid_*` 400/401 — a billing country the store does not
 * sell to (a wallet's card carries its own billing address), a missing receipt
 * email, a postcode WooCommerce rejects. Commerce classifies that as
 * RECOVERABLE (`internal/provider/woocommerce/checkout_validation.go`): the
 * payment stands, nothing is refunded, and the SAME draft order finalises once
 * it has the detail. The order return page used to `throw` it, and a shopper
 * holding a charged card got the error boundary.
 *
 * This module is the whole decision — which throws count, which field they
 * name, whether the shopper can fix it in place, which form that implies, and
 * every sentence they read. `components/checkout/complete-order.tsx` renders
 * it; both return pages detect it; `completeOrderAction` re-finalises.
 *
 * # The line against `lib/order-refusal.ts`
 *
 * That module owns `ORDER_REFUSED` (terminal, refunded). This one owns
 * `ORDER_VALIDATION` (recoverable, still paid). Every surface classifies
 * refusal first and validation second, so a code belongs to exactly one, and
 * the two screens say opposite things about the money on purpose.
 *
 * # The contract (`services/commerce/graph/order_validation.go`)
 *
 * The GraphQL error's `extensions` carry:
 *
 * - `code`             — `"ORDER_VALIDATION"`
 * - `reason`           — the WooCommerce code
 * - `field`            — `billing_email`, `billing_country`,
 *   `shipping_country`, `<billing|shipping>_<attribute>`, a bare
 *   `<attribute>` when commerce could not tell the side, or `unknown`
 * - `message`          — WooCommerce's own sentence
 * - `allowedCountries` — the country refusals only
 *
 * The code is the ONLY classifier. There is no fallback that matches
 * WooCommerce's prose: a message is translated merchant copy, never a
 * contract, and an untyped throw keeps the page's existing last resort (the
 * processing screen), which is safe.
 *
 * # `shipping_country` is NOT recoverable, and that is a decision
 *
 * Every other field is something the shopper can correct and we would then
 * accept. A country the store does not ship to is not: re-asking for an
 * address we would still refuse is a loop, and changing where a paid order is
 * delivered is not ours to do here. So it renders WooCommerce's sentence, the
 * money sentence and the contact line, and NO form.
 * {@link orderValidationIsRecoverable} is the only place that rule lives.
 *
 * NEVER render `reason` or a session id. They go to {@link logOrderValidation}.
 */

import {
  errorExtensionBags,
  extensionString,
  extensionStringList,
  firstErrorMessage,
} from "./graphql-error-extensions";
import { allCountryCodes, countryName, countryNameList } from "./country-names";
import type { OrderRefusal } from "./order-refusal";

/** The `extensions.code` commerce sets when WooCommerce rejected a detail. */
export const ORDER_VALIDATION_CODE = "ORDER_VALIDATION";

/** Reason used when commerce named no code. */
export const UNNAMED_ORDER_VALIDATION_REASON = "order_validation";

/** The address attributes commerce can name (`validationAddressAttributes`). */
export const ORDER_VALIDATION_ATTRIBUTES = [
  "first_name",
  "last_name",
  "address_1",
  "address_2",
  "city",
  "state",
  "postcode",
  "country",
  "phone",
  "email",
] as const;

export type OrderValidationAttribute =
  (typeof ORDER_VALIDATION_ATTRIBUTES)[number];

/**
 * A recoverable (or blocked) post-payment validation failure, in the one shape
 * the screen renders.
 */
export interface OrderValidationFailure {
  /** The WooCommerce code. Never render it. */
  reason: string;
  /** Which side of the address pair WooCommerce rejected. */
  side: "billing" | "shipping";
  /** Which attribute, or null when commerce could not name one. */
  attribute: OrderValidationAttribute | null;
  /** WooCommerce's shopper-facing sentence, when it sent one. */
  message?: string | null;
  /** ISO-2 codes the store accepts. Empty unless WooCommerce sent them. */
  allowedCountries: string[];
}

function toAttribute(value: string): OrderValidationAttribute | null {
  return (ORDER_VALIDATION_ATTRIBUTES as readonly string[]).includes(value)
    ? (value as OrderValidationAttribute)
    : null;
}

/**
 * Parse commerce's `field` into a side and an attribute. A bare attribute
 * (side unresolved) and `unknown` are read as BILLING: billing is the half of
 * the pair the shopper can change after paying without changing where the
 * order goes, and the finalize decides either way.
 */
export function parseValidationField(field: string): {
  side: "billing" | "shipping";
  attribute: OrderValidationAttribute | null;
} {
  const value = field.trim().toLowerCase();
  for (const side of ["billing", "shipping"] as const) {
    const prefix = `${side}_`;
    if (value.startsWith(prefix)) {
      return { side, attribute: toAttribute(value.slice(prefix.length)) };
    }
  }
  return { side: "billing", attribute: toAttribute(value) };
}

/** Upper-case ISO-2 codes only, de-duplicated, order preserved. */
function normalizeCountryCodes(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!/^[A-Za-z]{2}$/.test(value)) continue;
    const code = value.toUpperCase();
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * The validation failure a thrown finalize carries, or null. Null means "not a
 * detail the shopper can be asked about" — a transient failure, an
 * already-finalized order, or an `ORDER_REFUSED` the refusal classifier owns —
 * and every caller keeps what it did before for it.
 */
export function orderValidationFromError(
  error: unknown,
): OrderValidationFailure | null {
  for (const bag of errorExtensionBags(error)) {
    if (bag["code"] !== ORDER_VALIDATION_CODE) continue;
    return {
      reason: extensionString(bag, "reason") || UNNAMED_ORDER_VALIDATION_REASON,
      ...parseValidationField(extensionString(bag, "field")),
      message: extensionString(bag, "message") || null,
      allowedCountries: normalizeCountryCodes(
        extensionStringList(bag, "allowedCountries"),
      ),
    };
  }
  return null;
}

/** Whether the shopper can complete this order themselves. */
export function orderValidationIsRecoverable(
  failure: OrderValidationFailure,
): boolean {
  return !(failure.side === "shipping" && failure.attribute === "country");
}

/** Which form the screen draws. */
export type OrderValidationFormShape =
  | "billing-address"
  | "email"
  | "single-field"
  | "none";

/**
 * The form shape for a failure.
 *
 * A rejected COUNTRY re-collects the whole billing block: the shopper is about
 * to invoice from a different country, so the suburb, state and postcode that
 * went with the old one are no longer right either. An unnamed attribute takes
 * the whole block too — it is the shape that can satisfy any requirement we
 * could not name. Any other single attribute is one field, on its own side.
 */
export function orderValidationFormShape(
  failure: OrderValidationFailure,
): OrderValidationFormShape {
  if (!orderValidationIsRecoverable(failure)) return "none";
  if (failure.attribute === "email") return "email";
  if (failure.attribute === null || failure.attribute === "country") {
    return "billing-address";
  }
  return "single-field";
}

/** The fields a correction can carry, in the order a shopper reads them. */
export const COMPLETE_ORDER_FIELDS = [
  "firstName",
  "lastName",
  "address1",
  "address2",
  "city",
  "state",
  "postcode",
  "country",
  "phone",
  "email",
] as const;

export type CompleteOrderField = (typeof COMPLETE_ORDER_FIELDS)[number];

const ATTRIBUTE_TO_FIELD: Record<OrderValidationAttribute, CompleteOrderField> =
  {
    first_name: "firstName",
    last_name: "lastName",
    address_1: "address1",
    address_2: "address2",
    city: "city",
    state: "state",
    postcode: "postcode",
    country: "country",
    phone: "phone",
    email: "email",
  };

/** The fields the form renders for a failure. */
export function completeOrderFormFields(
  failure: OrderValidationFailure,
): CompleteOrderField[] {
  switch (orderValidationFormShape(failure)) {
    case "none":
      return [];
    case "email":
      return ["email"];
    case "single-field":
      return failure.attribute ? [ATTRIBUTE_TO_FIELD[failure.attribute]] : [];
    default:
      return [...COMPLETE_ORDER_FIELDS];
  }
}

/** Which side a correction patches. Email always lands on billing. */
export function completeOrderSide(
  failure: OrderValidationFailure,
): "billing" | "shipping" {
  const shape = orderValidationFormShape(failure);
  return shape === "single-field" ? failure.side : "billing";
}

/**
 * The countries the form's select offers: WooCommerce's list when it sent one,
 * else every country. The fallback never NARROWS — a select limited to a guess
 * would refuse a shopper the store would accept.
 */
export function allowedCountriesOrAll(
  failure: OrderValidationFailure,
): string[] {
  return failure.allowedCountries.length > 0
    ? failure.allowedCountries
    : allCountryCodes();
}

/** The heading on the recoverable screen. */
export const COMPLETE_ORDER_HEADING = "One more detail to complete your order";

/** The heading when the shopper cannot fix it themselves. */
export const BLOCKED_ORDER_HEADING = "We need to finish your order with you";

/**
 * What the shopper reads about THE MONEY — the opposite of
 * `lib/order-refusal.ts`'s: nothing has been refunded and nothing more will be
 * taken. `amount` is spliced in only when the caller has a figure it trusts.
 */
export function completeOrderMoneySentence(amount?: string): string {
  return amount
    ? `We've received your payment of ${amount}. Nothing more will be charged.`
    : "We've received your payment. Nothing more will be charged.";
}

/** "order #284474", or "your order" when there is no id to name. */
function orderNoun(orderId: string): string {
  const id = orderId.trim();
  return id ? `order #${id}` : "your order";
}

/**
 * WHY the order could not be placed, rewritten by field.
 *
 * The billing-country case must NOT be WooCommerce's own sentence: "we do not
 * allow orders from the provided country (…)" names no fix and reads as a
 * rejection of the shopper. The rewrite says which country was read off their
 * payment, which countries the store accepts, and that the order completes
 * once they give one. Email gets its own plain sentence for the same reason.
 * Everything else prefers WooCommerce's sentence — the merchant's wording
 * beats a guess at a postcode rule — and a generic line otherwise.
 *
 * There is no order id on the CART return page (WooCommerce refused before an
 * order existed), so every sentence names "your order" there rather than
 * inventing a number.
 */
export function orderValidationBody(
  failure: OrderValidationFailure,
  orderId: string,
  billingCountry?: string | null,
): string {
  const order = orderNoun(orderId);
  if (failure.side === "billing" && failure.attribute === "country") {
    const from = billingCountry?.trim()
      ? `is in ${countryName(billingCountry)}`
      : "is in a country we can't accept";
    const allowed =
      failure.allowedCountries.length > 0
        ? `we can only accept billing addresses in ${countryNameList(failure.allowedCountries)}`
        : "we can't accept billing addresses from there";
    return `The billing address on your payment ${from}, and ${allowed}. Enter a billing address we can accept and we'll complete ${order}.`;
  }
  if (failure.attribute === "email") {
    return `We need an email address for your receipt before we can complete ${order}.`;
  }
  const message = failure.message?.trim();
  if (message) return message;
  return `We need one more detail before we can complete ${order}.`;
}

/** What a BLOCKED shopper reads — no form, so the next move must be stated. */
export function blockedOrderBody(
  failure: OrderValidationFailure,
  orderId: string,
): string {
  const message = failure.message?.trim();
  if (message) return message;
  return `We couldn't complete ${orderNoun(orderId)} with the delivery address on it.`;
}

/** The line under both screens, recoverable or not. */
export function orderValidationContactSentence(orderId: string): {
  lead: string;
  tail: string;
} {
  const id = orderId.trim();
  return {
    lead: "Prefer a refund instead? ",
    tail: id ? ` and quote order #${id}.` : " and we'll sort it out for you.",
  };
}

/** The minimum of an address this module prefills a form from. */
export interface OrderValidationAddressLike {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  address1?: string | null | undefined;
  address2?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  postcode?: string | null | undefined;
  country?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
}

export type CompleteOrderPrefill = Record<CompleteOrderField, string>;

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * What the form opens with.
 *
 * For a BILLING correction, SHIPPING first: the rejected billing country came
 * off the payment method, while the address the shopper typed — where the
 * order is going — is almost always one the store accepts, so the form opens
 * nearly right. Billing is the fallback for a no-shipping cart. A shipping
 * correction opens from shipping alone.
 *
 * The COUNTRY is dropped unless it is one the select offers: seeding it with
 * the rejected country would re-submit the failure.
 */
export function completeOrderPrefill(
  failure: OrderValidationFailure,
  sources: {
    shipping?: OrderValidationAddressLike | null;
    billing?: OrderValidationAddressLike | null;
    customerEmail?: string | null;
  },
): CompleteOrderPrefill {
  const shippingSide = completeOrderSide(failure) === "shipping";
  const pick = (field: Exclude<CompleteOrderField, "email">): string => {
    const fromShipping = text(sources.shipping?.[field]);
    if (fromShipping || shippingSide) return fromShipping;
    return text(sources.billing?.[field]);
  };

  const country = pick("country").toUpperCase();
  const rejected =
    failure.attribute === "country" ? text(sources.billing?.country) : "";

  return {
    firstName: pick("firstName"),
    lastName: pick("lastName"),
    address1: pick("address1"),
    address2: pick("address2"),
    city: pick("city"),
    state: pick("state"),
    postcode: pick("postcode"),
    country:
      allowedCountriesOrAll(failure).includes(country) &&
      country !== rejected.toUpperCase()
        ? country
        : "",
    phone: pick("phone"),
    email: text(sources.customerEmail) || text(sources.billing?.email),
  };
}

/**
 * What the shopper corrected: a PATCH over one side of the address pair the
 * finalize would otherwise have sent. A patch rather than a whole address is
 * what makes the one-field forms possible — the server rebuilds the full pair
 * from the session and the checkout cookies exactly as the page does, then
 * overlays this. Empty values are dropped by the server, so a field the form
 * did not render can never blank one the session carried.
 *
 * Flat and free of any `@headkit/sdk` type: it crosses into a client
 * component.
 */
export interface CompleteOrderCorrection {
  side: "billing" | "shipping";
  fields: Partial<Record<CompleteOrderField, string>>;
}

/**
 * What `completeOrderAction` answers. Never a throw: it runs behind a button
 * on the one screen a shopper reaches holding a charged card, and an
 * unhandled rejection there is the error boundary this replaces.
 *
 * Four outcomes, because the screen does four different things: navigate to
 * the confirmation; show a NEW typed failure beside the form it keeps (the
 * second attempt was refused over another detail); swap to the refused screen
 * (the order became unplaceable meanwhile, and commerce has reversed the
 * payment — "try again" would be false); or say the store could not be
 * reached and keep the form.
 */
export type CompleteOrderResult =
  | { ok: true; path: string }
  | { ok: false; kind: "validation"; failure: OrderValidationFailure }
  | { ok: false; kind: "refused"; refusal: OrderRefusal }
  | { ok: false; kind: "transient" };

/** What the shopper reads when the store could not be reached at all. */
export const COMPLETE_ORDER_TRANSIENT_MESSAGE =
  "We couldn't reach the store. Please try again.";

/** The ONE log line for a validation failure: code and field, never a value. */
export function logOrderValidation(failure: OrderValidationFailure): void {
  console.error(
    "[order-validation]",
    failure.reason,
    `${failure.side}_${failure.attribute ?? "unknown"}`,
  );
}

/**
 * The ONE log line for a post-payment finalize failure nobody classified. The
 * screen that follows says nothing technical, so this is the only record.
 */
export function logUnexpectedFinalizeFailure(error: unknown): void {
  console.error("[finalize-unexpected]", firstErrorMessage(error));
}
