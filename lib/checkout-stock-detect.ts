/**
 * Pure helpers for recognising stock failures after Stripe has already
 * charged (success-page / poller paths). Kept free of `"use server"` so unit
 * tests and client components can import them.
 */

/** WooCommerce / HeadKit messages that mean the cart cannot be ordered. */
export function isStockFinalizeError(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err ?? "");
  return /out\s*of\s*stock|invalid_stock|insufficient\s*stock|not\s+enough\s+stock|woocommerce_rest_product_out_of_stock/i.test(
    msg,
  );
}
