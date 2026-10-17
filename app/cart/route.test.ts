import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * `/cart?wck_rebuild_cart=` is a Klaviyo email link, so it must answer a
 * redirect a browser follows with a GET, never be cached (the cart cookie is
 * per shopper), and hand the key to the rebuild action untouched.
 */

const rebuildCartFromKlaviyoAction = vi.fn(async () => ({
  success: true as const,
  cart: { items: [{}] },
}));
vi.mock("@/lib/cart-actions", () => ({ rebuildCartFromKlaviyoAction }));

const { GET } = await import("./route");

describe("GET /cart", () => {
  it("rebuilds from the link's key and sends the shopper to checkout", async () => {
    const res = await GET(
      new NextRequest(
        "https://shop.example/cart?wck_rebuild_cart=KEY%3D&_kx=abc",
      ),
    );
    expect(rebuildCartFromKlaviyoAction).toHaveBeenCalledWith("KEY=");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "https://shop.example/checkout?_kx=abc",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("without a key it goes home and rebuilds nothing", async () => {
    rebuildCartFromKlaviyoAction.mockClear();
    const res = await GET(new NextRequest("https://shop.example/cart"));
    expect(rebuildCartFromKlaviyoAction).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://shop.example/");
  });
});
