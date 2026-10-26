/**
 * First paint while Afterpay (or another redirect method) has returned and
 * the bag is being checked. Stripe's bridge only shows its own spinner for
 * a moment; this is the page the shopper actually waits on.
 */
export function CheckingStock(): React.ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 text-center"
    >
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      />
      <p className="text-sm">Checking stock availability</p>
    </div>
  );
}
