/**
 * The `hk-checkout-data` cookie: the email and SHIPPING address the checkout
 * writes before payment (`app/checkout/CheckoutForm.tsx`), read server-side by
 * the order return page and by `completeOrderAction`, which must rebuild the
 * exact address pair that page sent. One parser so the two cannot disagree.
 */

export const CHECKOUT_DATA_COOKIE = "hk-checkout-data";

export interface StoredCheckoutData {
  email?: string;
  shippingAddress?: {
    firstName: string;
    lastName: string;
    address1: string;
    address2?: string;
    city: string;
    state: string;
    postcode: string;
    country: string;
    phone?: string;
  };
}

/** Parses a raw cookie value. `{}` when absent or malformed. */
export function parseCheckoutDataCookie(
  raw: string | undefined,
): StoredCheckoutData {
  if (!raw) return {};
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as unknown;
    return value && typeof value === "object"
      ? (value as StoredCheckoutData)
      : {};
  } catch {
    return {};
  }
}
