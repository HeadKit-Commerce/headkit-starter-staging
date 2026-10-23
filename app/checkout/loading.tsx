import { CheckoutLoadingShell } from "@/components/checkout/checkout-pending-shell";

/**
 * Instant route fallback. Step titles and payment icons are known; the order
 * summary uses cart context when the shopper already had a bag (client nav).
 * Once the page streams past the cart read, {@link CheckoutPendingShell} takes
 * over with the server-validated cart while the Stripe session mints.
 */
export default function CheckoutLoading(): React.ReactElement {
  return <CheckoutLoadingShell />;
}
