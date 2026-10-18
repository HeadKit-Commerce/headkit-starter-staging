import { NextResponse } from "next/server";
import { setCheckoutSessionCookie } from "@/lib/checkout-session-cookie";

/**
 * POST /api/checkout/active-session
 *
 * Records the shopper's ACTIVE Stripe Checkout Session in the httpOnly
 * `hk-checkout-session` cookie (ENG-784 mechanism 1 — see
 * `lib/checkout-session-cookie.ts` for what reads it).
 *
 * A Route Handler, NOT a Server Action, and that is the whole point: a cookie
 * written by a Server Action makes Next re-render the route the action was
 * called from. The checkout page registers its session from a mount effect,
 * so as an action every /checkout view ran the full server render twice — a
 * second cart read, a second `createCheckoutSession` and a second Stripe
 * Checkout Session that nothing ever used (`x-action-revalidated: 1`, ~84 KB
 * of RSC payload). A fetch to a Route Handler sets the cookie and re-renders
 * nothing, the same reason `/api/checkout/sync-line-items` is one.
 *
 * The id is client-supplied, as it always was through the action. That is
 * safe because the cookie is only ever handed back to the ownership-guarded
 * `expireCheckoutSession` mutation, which refuses a session the cart token did
 * not create. JSON is required so a cross-site form POST (which cannot send
 * `application/json` without a CORS preflight this route never answers) cannot
 * set it at all.
 */
const SESSION_ID = /^[A-Za-z0-9_]{1,255}$/;

export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "application/json required" },
      { status: 415 },
    );
  }
  const body = (await request.json().catch(() => null)) as {
    sessionId?: unknown;
  } | null;
  const sessionId = body?.sessionId;
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) {
    return NextResponse.json(
      { error: "sessionId is required" },
      { status: 400 },
    );
  }
  await setCheckoutSessionCookie(sessionId);
  return new NextResponse(null, { status: 204 });
}
