"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FORM_CONTROL_SURFACE } from "@/components/ui/form-control-surface";
import { OrderRefused } from "@/components/checkout/order-refused";
import { cn } from "@/lib/utils";
import { completeOrderAction } from "@/app/checkout/actions";
import { countryName } from "@/lib/country-names";
import type { OrderRefusal } from "@/lib/order-refusal";
import {
  allowedCountriesOrAll,
  blockedOrderBody,
  BLOCKED_ORDER_HEADING,
  COMPLETE_ORDER_HEADING,
  COMPLETE_ORDER_TRANSIENT_MESSAGE,
  completeOrderFormFields,
  completeOrderMoneySentence,
  completeOrderPrefill,
  completeOrderSide,
  orderValidationBody,
  orderValidationContactSentence,
  orderValidationIsRecoverable,
  type CompleteOrderCorrection,
  type CompleteOrderField,
  type CompleteOrderPrefill,
  type OrderValidationAddressLike,
  type OrderValidationFailure,
} from "@/lib/order-validation";

/**
 * The screen a shopper sees when they PAID and WooCommerce then refused the
 * order over one detail they can still fix (`ORDER_VALIDATION`). Before this,
 * the order return page threw that finalize error and the shopper got the
 * error boundary holding a charged card.
 *
 * Nothing is charged again from here: `completeOrderAction` re-finalises the
 * SAME paid session through the same mutation and the same `payment_data` the
 * return page sent. That is why the money sentence leads — a shopper looking at
 * a form after paying needs to be told, first, that this is not a second
 * payment.
 *
 * It reuses `payment-processing.tsx`'s shell, so the screens read as one page.
 * NO TECHNICAL DETAIL IS RENDERED — not the WooCommerce code, not the session
 * id, not the order key. Those are logged SERVER-side where the failure is
 * known. `lib/order-validation.ts` owns every sentence and the form-shape rule.
 *
 * A `shipping_country` failure is not correctable in place, so it renders with
 * no form. It deliberately does NOT reuse `OrderRefused`, whose second
 * paragraph says the payment was refunded — here it was not.
 */

export interface CompleteOrderProps {
  failure: OrderValidationFailure;
  /** The WooCommerce order the shopper already paid for, or "" (cart page). */
  orderId: string;
  /** Its key — sent to the action, NEVER rendered. */
  orderKey: string;
  /** The paid Stripe session. Sent to the action, NEVER rendered. */
  sessionId: string;
  /** The address pair the failed finalize SENT: the prefill sources. */
  shippingAddress?: OrderValidationAddressLike | null;
  billingAddress?: OrderValidationAddressLike | null;
  customerEmail?: string | null;
}

export function CompleteOrder(props: CompleteOrderProps): React.ReactElement {
  // A retry the store refused outright (the order became unplaceable while the
  // shopper typed): commerce has reversed the payment, so the form must give
  // way to the refused screen rather than invite another attempt.
  const [refusal, setRefusal] = useState<OrderRefusal | null>(null);
  if (refusal) return <OrderRefused refusal={refusal} />;

  const {
    failure,
    orderId,
    orderKey,
    sessionId,
    shippingAddress,
    billingAddress,
    customerEmail,
  } = props;
  const recoverable = orderValidationIsRecoverable(failure);
  const contact = orderValidationContactSentence(orderId);

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="bg-white rounded-lg shadow-lg p-8 space-y-6">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-16 h-16 mx-auto text-amber-500"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>

        <h1 className="text-2xl text-gray-900 text-center">
          {recoverable ? COMPLETE_ORDER_HEADING : BLOCKED_ORDER_HEADING}
        </h1>
        <p className="text-gray-600 text-center">
          {completeOrderMoneySentence()}
        </p>
        <p className="text-gray-600 text-center">
          {recoverable
            ? orderValidationBody(failure, orderId, billingAddress?.country)
            : blockedOrderBody(failure, orderId)}
        </p>

        {recoverable ? (
          <CompleteOrderForm
            failure={failure}
            orderId={orderId}
            orderKey={orderKey}
            sessionId={sessionId}
            prefill={completeOrderPrefill(failure, {
              shipping: shippingAddress ?? null,
              billing: billingAddress ?? null,
              customerEmail: customerEmail ?? null,
            })}
            onRefused={setRefusal}
          />
        ) : (
          <Button asChild variant="secondary" className="w-full">
            <Link href="/shop">Back to shop</Link>
          </Button>
        )}

        <p className="text-gray-600 text-sm text-center">
          {contact.lead}
          <Link href="/contact" className="underline">
            Contact us
          </Link>
          {contact.tail}
        </p>
      </div>
    </div>
  );
}

/** Everything the finalize will reject if blank. */
const REQUIRED_FIELDS: ReadonlySet<CompleteOrderField> = new Set([
  "firstName",
  "lastName",
  "address1",
  "city",
  "postcode",
  "country",
  "email",
]);

const FIELD_LABELS: Record<CompleteOrderField, string> = {
  firstName: "First name",
  lastName: "Last name",
  address1: "Address",
  address2: "Apartment, suite (optional)",
  city: "Suburb / city",
  state: "State / region",
  postcode: "Postcode",
  country: "Country",
  phone: "Phone (optional)",
  email: "Email",
};

/**
 * Whether a field must be filled. A single-field form always requires its one
 * field — WooCommerce named it — even one (state, phone) that is optional in
 * the full block, where not every country has a state.
 */
function isRequired(
  field: CompleteOrderField,
  fields: readonly CompleteOrderField[],
): boolean {
  if (fields.length === 1) return true;
  return REQUIRED_FIELDS.has(field);
}

function CompleteOrderForm({
  failure,
  orderId,
  orderKey,
  sessionId,
  prefill,
  onRefused,
}: {
  failure: OrderValidationFailure;
  orderId: string;
  orderKey: string;
  sessionId: string;
  prefill: CompleteOrderPrefill;
  onRefused: (refusal: OrderRefusal) => void;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState<CompleteOrderPrefill>(prefill);
  /**
   * What went wrong with the LAST attempt, shown beside the form the shopper
   * is still looking at, so a second refusal never discards what they typed.
   */
  const [notice, setNotice] = useState<string | null>(null);

  const fields = completeOrderFormFields(failure);
  const countries = allowedCountriesOrAll(failure);

  const set = (field: CompleteOrderField, value: string) =>
    setValues((previous) => ({ ...previous, [field]: value }));

  const submit = () => {
    const missing = fields.filter(
      (field) => isRequired(field, fields) && !values[field].trim(),
    );
    if (missing.length > 0) {
      setNotice(
        `${missing.map((field) => FIELD_LABELS[field].replace(" (optional)", "")).join(", ")} ${missing.length === 1 ? "is" : "are"} required.`,
      );
      return;
    }
    setNotice(null);
    const correction: CompleteOrderCorrection = {
      side: completeOrderSide(failure),
      fields: {},
    };
    for (const field of fields) {
      const value = values[field].trim();
      if (value) correction.fields[field] = value;
    }
    startTransition(async () => {
      const result = await completeOrderAction(
        orderId,
        orderKey,
        sessionId,
        correction,
      );
      if (result.ok) {
        router.push(result.path);
        return;
      }
      if (result.kind === "refused") {
        onRefused(result.refusal);
        return;
      }
      setNotice(
        result.kind === "validation"
          ? orderValidationBody(result.failure, orderId, values.country)
          : COMPLETE_ORDER_TRANSIENT_MESSAGE,
      );
    });
  };

  return (
    <form
      className="space-y-4 text-left"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {fields.map((field) => (
        <div key={field} className="space-y-1">
          <Label htmlFor={`complete-order-${field}`}>
            {fields.length === 1
              ? FIELD_LABELS[field].replace(" (optional)", "")
              : FIELD_LABELS[field]}
          </Label>
          {field === "country" ? (
            /* A NATIVE select rather than the Base UI `Select`: this is the
               last screen between a paid card and a lost order, and a control
               that needs a portal to reveal its options is one more thing that
               can fail here. `FORM_CONTROL_SURFACE` keeps it looking like every
               other control. */
            <select
              id="complete-order-country"
              name="country"
              autoComplete="country"
              className={cn(
                "flex h-10 w-full px-3 py-2 text-base md:text-sm",
                FORM_CONTROL_SURFACE,
              )}
              value={values.country}
              onChange={(event) => set("country", event.target.value)}
            >
              <option value="">Select a country</option>
              {countries.map((code) => (
                <option key={code} value={code}>
                  {countryName(code)}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`complete-order-${field}`}
              name={field}
              type={field === "email" ? "email" : "text"}
              value={values[field]}
              onChange={(event) => set(field, event.target.value)}
            />
          )}
        </div>
      ))}

      {notice ? (
        <p role="alert" className="text-sm text-red-600">
          {notice}
        </p>
      ) : null}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Completing your order…" : "Complete my order"}
      </Button>
    </form>
  );
}
