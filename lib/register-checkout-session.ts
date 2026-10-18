/**
 * Registers `sessionId` as the shopper's ACTIVE Checkout Session (ENG-784
 * mechanism 1) through `POST /api/checkout/active-session`.
 *
 * Deliberately a `fetch`, never a Server Action: a cookie written by an action
 * re-renders the calling route, and on /checkout that re-render creates a
 * second Stripe Checkout Session per view. The route's header has the measured
 * cost. Rejects on a non-2xx answer; callers treat registration as best-effort
 * (mechanism 2, amount verification at manual capture, still protects the
 * charge).
 */
export async function registerActiveCheckoutSession(
  sessionId: string,
): Promise<void> {
  const res = await fetch("/api/checkout/active-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`active-session registration failed (${res.status})`);
  }
}
