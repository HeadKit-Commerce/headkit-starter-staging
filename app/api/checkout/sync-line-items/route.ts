import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCartToken } from "@/lib/cart";
import { getAuthToken } from "@/lib/auth-cookie";
import { createServerHeadkit } from "@/lib/sdk.server";
import {
  CART_ITEM_UNAVAILABLE,
  isCartItemUnavailableError,
} from "@/lib/cart-issues";
import { holdRefusalFromError } from "@/lib/stock-hold";

/**
 * POST /api/checkout/sync-line-items
 *
 * Called by Stripe's runServerUpdate during checkout. Syncs WooCommerce cart
 * line items to the Stripe Checkout Session. Cart token is read from cookies.
 *
 * The hk-auth-token cookie is forwarded as authToken so the underlying
 * GetCart is AUTH-flavored: WC flavor-locks the session customer blob to the
 * request's WP user, so a token-only read of a logged-in shopper's session
 * would see (and destructively persist) the guest flavor — pushing the
 * default-zone shipping rate to Stripe instead of the shopper's selection.
 * Mechanism: .planning/debug/stripe-shipping-desync-logged-in.md
 */
export async function POST(request: Request) {
  let sessionId: string | undefined;
  try {
    const body = await request.json();
    sessionId = body?.sessionId as string | undefined;
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const cartToken = await getCartToken();
    if (!cartToken) {
      return NextResponse.json(
        { error: "No active cart session" },
        { status: 401 },
      );
    }

    const authToken = getAuthToken(await cookies());
    const result = await createServerHeadkit(
      cartToken,
      undefined,
      authToken,
    ).payments.syncCheckoutSessionLineItems(sessionId);
    return NextResponse.json({
      ok: result.ok,
      shippingOptionMapping: result.shippingOptionMapping ?? null,
    });
  } catch (err) {
    // The store now reports a cart line it will not sell; commerce refused
    // (CART_ITEM_UNAVAILABLE). 409 like a dead session, but with the code and
    // the issues, so CheckoutForm corrects the named lines in place and shows
    // one alert per item (checkout plan v3 §2.2) instead of running the
    // one-shot auto-recreate, which the same gate would refuse. Read here
    // because only the server still sees the GraphQL extensions.
    if (isCartItemUnavailableError(err)) {
      const refusal = holdRefusalFromError(err);
      return NextResponse.json(
        {
          ok: false,
          code: CART_ITEM_UNAVAILABLE,
          issues: refusal?.status === "refused" ? refusal.issues : [],
        },
        { status: 409 },
      );
    }
    // ENG-784 (D7): a sync failure against a session another tab expired must
    // be distinguishable from a transient error — but by SERVER-SIDE status
    // retrieve, never by sniffing Stripe error strings. Non-open status →
    // 409 {ok:false, sessionStatus}: the un-swallowed signal that drives
    // handleSessionExpired in CheckoutForm. Anything else stays a 500, which
    // the client sync effect keeps swallowing as transient.
    if (sessionId) {
      try {
        const session =
          await createServerHeadkit().payments.getCheckoutSession(sessionId);
        if (session.status !== "open") {
          return NextResponse.json(
            { ok: false, sessionStatus: session.status },
            { status: 409 },
          );
        }
      } catch {
        /* status retrieve failed — fall through to the transient 500 */
      }
    }
    console.error("[sync-line-items]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
