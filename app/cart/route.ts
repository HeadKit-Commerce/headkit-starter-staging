import { NextResponse, type NextRequest } from "next/server";
import { rebuildCartFromKlaviyoAction } from "@/lib/cart-actions";
import { cartRebuildDestination } from "@/lib/klaviyo-cart-rebuild";

/**
 * GET /cart?wck_rebuild_cart=<key> — a Klaviyo abandoned-checkout link.
 *
 * Rebuilds the shopper's cart through commerce and the theme, points the
 * `hk-cart-token` cookie at it (inside the action), and redirects: to
 * `/checkout` when anything could be rebuilt, home otherwise. See
 * `lib/klaviyo-cart-rebuild.ts` for the rules. The storefront has no cart page,
 * so `/cart` without a key also lands on the home page.
 *
 * A GET that writes a cart is what the link format requires; it only ever
 * replaces the cart of whoever follows the link.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const destination = await cartRebuildDestination(
    request.nextUrl.searchParams,
    rebuildCartFromKlaviyoAction,
  );
  const response = NextResponse.redirect(
    new URL(destination, request.url),
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}
