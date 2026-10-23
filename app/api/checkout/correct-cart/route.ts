import { NextResponse } from "next/server";
import { applyCartCorrections } from "@/lib/cart-validation";
import { getFullCartAction } from "@/lib/cart-actions";
import { parseCorrections } from "@/lib/checkout-cart-correction";

/**
 * POST /api/checkout/correct-cart
 *
 * Applies the corrections a stock refusal calls for at C2/C3 (checkout plan v3
 * §2.2, `components/checkout/stock-alerts.tsx`): removes unavailable lines and
 * reduces short ones WITHOUT expiring the Checkout Session, and answers the
 * corrected cart.
 *
 * A Route Handler and not a Server Action, for the same reason as
 * `/api/checkout/active-session`. Every cart write here rotates the cart
 * cookie, and a Server Action that sets a cookie makes Next re-render the page
 * it was called from inside the action's response. On /checkout that
 * re-render is the whole entry path — a fresh Checkout Session minted for
 * nothing — and when the correction has EMPTIED the cart it ends in the
 * page's own no-cart redirect to /checkout/error, which wins over the hook's
 * hand-off to the bag.
 *
 * Body: `{ corrections: CartCorrection[] }`. 200 `{ ok: true, cart }`, or
 * `{ ok: false, cart }` when a correction failed (it stops at the first one),
 * with the cart re-read HERE — re-reading it through a Server Action would
 * reopen the re-render this route exists to avoid. `cart` is null when there
 * is none, which is what removing a cart's LAST line can produce: the gateway
 * may answer `CART_SESSION_EXPIRED` for an emptied session, so the cart is
 * gone either way. 400 for a malformed body.
 *
 * JSON is required, as on `/api/checkout/active-session`: it writes to the
 * shopper's cart, and a cross-site form POST cannot send `application/json`
 * without a CORS preflight this route never answers.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ ok: false }, { status: 415 });
  }
  const corrections = parseCorrections(await request.json().catch(() => null));
  if (!corrections) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const corrected = await applyCartCorrections(corrections).catch(() => null);
  if (corrected) return NextResponse.json({ ok: true, cart: corrected });
  const cart = await getFullCartAction().catch(() => null);
  return NextResponse.json({ ok: false, cart: cart ?? null });
}
