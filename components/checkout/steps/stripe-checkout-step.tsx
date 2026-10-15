"use client";

import { useCallback, useRef, useState } from "react";
import {
  PaymentElement,
  BillingAddressElement,
  useCheckout,
  CurrencySelectorElement,
} from "@stripe/react-stripe-js/checkout";
import type { AddressInput } from "@headkit/sdk";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCheckoutActions } from "@/app/checkout/checkout-actions-context";
import { writeBillingAddressCookie } from "@/lib/checkout-billing-cookie";
import { isCheckoutSessionDead } from "@/lib/checkout-session-status";
import { buildCheckoutBillingAddressElementOptions } from "@/lib/checkout-address-seed";

interface StripePaymentStepProps {
  /**
   * ENG-801: render billing on the payment step with Stripe's native
   * syncAddressCheckbox ("billing same as shipping"). Only true on
   * Ship-to-Home (the flow that collected a shipping address). Click & Collect
   * and no-shipping flows collect billing at the BillingAddressStep instead.
   */
  showBillingSameAsShipping?: boolean;
  /**
   * Shipping address (from the delivery step) used to restore
   * billing = shipping on the session after an uncheck → re-check.
   */
  shippingAddress?: AddressInput | null;
  /**
   * ENG-784: the active Checkout Session id, used on a confirm error to ask
   * the SERVER whether the session is dead (status !== "open" — D7, never
   * error-string sniffing).
   */
  sessionId?: string;
  /**
   * ENG-784: called when a confirm error traces to a dead session — triggers
   * the one-shot auto-recreate with the cart-changed notice.
   */
  onSessionExpired?: () => void;
  /**
   * Raised for the duration of `checkout.confirm()` so the parent can unmount
   * the delivery step's ShippingAddressElement, which stays mounted-but-hidden
   * through the Payment step (`keepMountedWhenInactive`). Stripe REJECTS
   * confirm() while any Address Element is mounted once
   * `updateShippingAddress()` has been called on the session — see the
   * component docblock.
   */
  onConfirmingChange?: (confirming: boolean) => void;
}

/** Billing value tracked from BillingAddressElement change events (ENG-801).
 * Note: the element does not return phone — the session phone is already set
 * from the shipping phone at the delivery step (accepted limitation). */
type BillingValue = {
  firstName: string;
  lastName: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
};

/** Normalize an address for same-vs-distinct comparison on Pay. */
function addressCompareKey(addr: {
  line1?: string | null | undefined;
  address1?: string | null | undefined;
  city?: string | null | undefined;
  state?: string | null | undefined;
  country?: string | null | undefined;
  postalCode?: string | null | undefined;
  postcode?: string | null | undefined;
}): string {
  return [
    (addr.line1 ?? addr.address1 ?? "").trim().toLowerCase(),
    (addr.city ?? "").trim().toLowerCase(),
    (addr.state ?? "").trim().toLowerCase(),
    (addr.country ?? "").trim().toLowerCase(),
    (addr.postalCode ?? addr.postcode ?? "").trim().toLowerCase(),
  ].join("|");
}

function isDistinctBilling(
  billing: BillingValue | null,
  shipping: AddressInput | null | undefined,
): boolean {
  if (!billing?.line1?.trim() || !shipping?.address1?.trim()) return false;
  return (
    addressCompareKey(billing) !==
    addressCompareKey({
      line1: shipping.address1,
      city: shipping.city,
      state: shipping.state,
      country: shipping.country,
      postalCode: shipping.postcode,
    })
  );
}

/** Wait for React to commit an unmount before Stripe confirm() (ENG-801). */
async function waitForBillingUnmount(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * Renders PaymentElement + confirm button inside a CheckoutProvider context.
 * Must be a child of <CheckoutProvider> (from @stripe/react-stripe-js/checkout).
 * Calls checkout.confirm() to finalise payment — on success Stripe handles the
 * redirect to the returnUrl configured on the session.
 *
 * ENG-801: on Ship-to-Home Stripe renders the native "billing same as shipping"
 * checkbox (syncAddressCheckbox on the Elements instance). The
 * BillingAddressElement stays mounted while the checkbox is visible; it is
 * unmounted immediately before checkout.confirm() because Stripe rejects
 * confirm() while a billing Address Element is mounted if
 * updateBillingAddress() was ever called on the session (the delivery step's
 * billing=shipping write already counts).
 *
 * BOTH Address Elements have to go, not just this one. The SHIPPING element
 * lives in the delivery step, which is deliberately kept mounted-but-hidden
 * through Payment (`keepMountedWhenInactive` in CheckoutForm) so Stripe has a
 * shipping element to sync the checkbox against. Stripe applies the same
 * confirm-time rule to it, naming the write it conflicts with:
 *
 *   "You called confirm() while the Address Element is mounted, but you
 *    previously also called updateShippingAddress(). … ensure the Address
 *    Element is not mounted by the time you call confirm()."
 *
 * That is the whole of the failure — confirm() resolves as an error, the card
 * is never presented, and the shopper stays on /checkout with no order. So the
 * unmount is signalled UP via `onConfirmingChange` as well as applied locally,
 * and both are committed (`waitForBillingUnmount`) before confirm() runs.
 */
export function StripePaymentStep({
  showBillingSameAsShipping = false,
  shippingAddress = null,
  sessionId,
  onSessionExpired,
  onConfirmingChange,
}: StripePaymentStepProps) {
  const checkoutState = useCheckout();
  const { actions } = useCheckoutActions();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [billingElementComplete, setBillingElementComplete] = useState(false);
  const [lastBillingValue, setLastBillingValue] = useState<BillingValue | null>(
    null,
  );
  // While true the BillingAddressElement is unmounted so confirm() can run
  // after updateBillingAddress() — Stripe rejects confirm() while a billing
  // Address Element is mounted if updateBillingAddress() was ever called on
  // the session (the delivery step's billing=shipping write already counts).
  const [hideBillingElement, setHideBillingElement] = useState(false);
  // Snapshot of the entered billing captured when the element is unmounted on
  // Pay; used as `contacts` prefill so a remount after a failed payment does
  // not lose what the customer typed (contacts is create-only — ENG-755).
  const [remountContacts, setRemountContacts] = useState<
    | {
        name: string;
        address: {
          line1: string;
          line2?: string;
          city: string;
          state: string;
          postal_code: string;
          country: string;
        };
      }[]
    | null
  >(null);
  // True only after a distinct billing address was SUCCESSFULLY pushed to the
  // session. Handles: uncheck → fill → Pay → updateBillingAddress succeeds →
  // confirm fails (e.g. declined card) → user re-checks → Pay must restore
  // billing = shipping before confirming (ENG-801).
  const billingOverriddenRef = useRef(false);

  const handleSubmit = useCallback(async () => {
    if (checkoutState.type !== "success") return;
    const { checkout } = checkoutState;

    setIsSubmitting(true);
    setError(null);
    try {
      if (showBillingSameAsShipping) {
        const distinct = isDistinctBilling(lastBillingValue, shippingAddress);

        if (distinct) {
          if (!actions || !billingElementComplete || !lastBillingValue?.line1) {
            setError("Please complete your billing address");
            return;
          }
          const name = [lastBillingValue.firstName, lastBillingValue.lastName]
            .filter(Boolean)
            .join(" ")
            .trim();
          const billingPayload = {
            ...(name ? { name } : {}),
            address: {
              line1: lastBillingValue.line1,
              ...(lastBillingValue.line2
                ? { line2: lastBillingValue.line2 }
                : {}),
              city: lastBillingValue.city,
              state: lastBillingValue.state,
              postal_code: lastBillingValue.postalCode,
              country: lastBillingValue.country,
            },
          };
          setRemountContacts([{ name, address: billingPayload.address }]);
          setHideBillingElement(true);
          onConfirmingChange?.(true);
          await waitForBillingUnmount();
          const res = await actions.updateBillingAddress(billingPayload);
          if (res.type === "error") {
            setError(res.error?.message ?? "Failed to update billing address");
            return;
          }
          billingOverriddenRef.current = true;
          writeBillingAddressCookie({
            firstName: lastBillingValue.firstName,
            lastName: lastBillingValue.lastName,
            address1: lastBillingValue.line1,
            address2: lastBillingValue.line2 ?? "",
            city: lastBillingValue.city,
            state: lastBillingValue.state,
            postcode: lastBillingValue.postalCode,
            country: lastBillingValue.country,
          });
        } else {
          setHideBillingElement(true);
          onConfirmingChange?.(true);
          await waitForBillingUnmount();

          if (billingOverriddenRef.current) {
            if (!actions || !shippingAddress?.address1) {
              setError(
                "Unable to restore your billing address. Please uncheck the box and enter a billing address.",
              );
              return;
            }
            const restoreName = [
              shippingAddress.firstName,
              shippingAddress.lastName,
            ]
              .filter(Boolean)
              .join(" ")
              .trim();
            const restoreRes = await actions.updateBillingAddress({
              ...(restoreName ? { name: restoreName } : {}),
              address: {
                line1: shippingAddress.address1 ?? "",
                ...(shippingAddress.address2
                  ? { line2: shippingAddress.address2 }
                  : {}),
                city: shippingAddress.city ?? "",
                state: shippingAddress.state ?? "",
                postal_code: shippingAddress.postcode ?? "",
                country: shippingAddress.country ?? "",
              },
            });
            if (restoreRes.type === "error") {
              setError(
                restoreRes.error?.message ?? "Failed to update billing address",
              );
              return;
            }
            billingOverriddenRef.current = false;
          }

          if (shippingAddress?.address1) {
            writeBillingAddressCookie({
              firstName: shippingAddress.firstName ?? "",
              lastName: shippingAddress.lastName ?? "",
              address1: shippingAddress.address1 ?? "",
              address2: shippingAddress.address2 ?? "",
              city: shippingAddress.city ?? "",
              state: shippingAddress.state ?? "",
              postcode: shippingAddress.postcode ?? "",
              country: shippingAddress.country ?? "",
              ...(shippingAddress.phone
                ? { phone: shippingAddress.phone }
                : {}),
            });
          }
        }
      }

      const result = await checkout.confirm();
      if (result.type === "error") {
        if (
          sessionId &&
          onSessionExpired &&
          (await isCheckoutSessionDead(sessionId))
        ) {
          onSessionExpired();
          return;
        }
        setError(result.error.message ?? "Payment failed. Please try again.");
      }
    } catch (err) {
      if (
        sessionId &&
        onSessionExpired &&
        (await isCheckoutSessionDead(sessionId))
      ) {
        onSessionExpired();
        return;
      }
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    } finally {
      setIsSubmitting(false);
      setHideBillingElement(false);
      onConfirmingChange?.(false);
    }
  }, [
    checkoutState,
    actions,
    showBillingSameAsShipping,
    billingElementComplete,
    lastBillingValue,
    shippingAddress,
    sessionId,
    onSessionExpired,
    onConfirmingChange,
  ]);

  if (checkoutState.type === "loading") {
    return (
      <div className="space-y-3 py-2" aria-hidden="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  if (checkoutState.type === "error") {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-sm text-red-700">
          {checkoutState.error.message ?? "Failed to load payment form."}
        </p>
      </div>
    );
  }

  const payAmount = checkoutState.checkout.total.total.amount.trim() || null;

  return (
    <div className="space-y-4">
      <CurrencySelectorElement />
      <PaymentElement
        options={{
          layout: {
            type: "accordion",
            defaultCollapsed: false,
            radios: "always",
            spacedAccordionItems: true,
          },
          fields: {
            billingDetails: {
              name: "never",
            },
          },
          // Checkout Session wallets default to `auto` (show when the session
          // has card and the platform supports them). Same as Shopify / Stripe
          // hosted checkout: Apple Pay / Google Pay stay in the Payment Element
          // while Express also shows them at the top of the page. Stripe allows
          // only ONE ExpressCheckoutElement per CheckoutProvider — that is the
          // top instance; this is Payment Element wallets, not a second ECE.
          wallets: { applePay: "auto", googlePay: "auto" },
        }}
      />
      {showBillingSameAsShipping && !hideBillingElement && (
        <BillingAddressElement
          // `remountContacts` ONLY — seeding this element from the shipping
          // address makes Stripe render a saved-address card instead of the
          // native billing-same-as-shipping checkbox (see the helper).
          options={buildCheckoutBillingAddressElementOptions({
            remountContacts,
          })}
          onChange={(event) => {
            if (event.complete && event.value) {
              const { address, firstName, lastName, name } = event.value;
              const first = (name?.split(" ")?.[0] || firstName) ?? "";
              const last = (name?.split(" ")?.[1] || lastName) ?? "";
              const addr = address ?? {};
              const value: BillingValue = {
                firstName: first,
                lastName: last,
                line1: addr.line1 ?? "",
                line2: addr.line2 ?? "",
                city: addr.city ?? "",
                state: addr.state ?? "",
                country: addr.country ?? "",
                postalCode: addr.postal_code ?? "",
              };
              setLastBillingValue(value);
              setBillingElementComplete(!!value.line1);
            } else {
              setBillingElementComplete(false);
            }
          }}
        />
      )}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      <Button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={isSubmitting}
        loading={isSubmitting}
        className="w-full"
      >
        {payAmount ? `Pay ${payAmount}` : "Pay Now"}
      </Button>
    </div>
  );
}
