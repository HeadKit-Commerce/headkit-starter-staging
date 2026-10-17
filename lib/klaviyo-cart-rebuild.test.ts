import { describe, expect, it, vi } from "vitest";
import {
  cartRebuildDestination,
  type CartRebuildOutcome,
} from "./klaviyo-cart-rebuild";

/**
 * Where `/cart?wck_rebuild_cart=` sends a shopper (checkout plan v3 §4.5), and
 * what it hands commerce. The key is base64 and may carry `+`, `/` and `=`;
 * an unencoded `+` in a link arrives as a space, which the THEME restores
 * (headkit-cart-rebuild.php), so the storefront passes the key on as received.
 */

const withItems = (n: number): CartRebuildOutcome => ({
  success: true,
  cart: { items: Array.from({ length: n }, () => ({})) },
});

describe("cartRebuildDestination", () => {
  it("rebuilds and resumes checkout when any line came back", async () => {
    const rebuild = vi.fn(async () => withItems(2));
    const to = await cartRebuildDestination(
      new URLSearchParams("wck_rebuild_cart=eyJh+b/c="),
      rebuild,
    );
    expect(to).toBe("/checkout");
    expect(rebuild).toHaveBeenCalledWith("eyJh b/c=");
  });

  it("keeps Klaviyo's _kx and utm attribution, and drops the key", async () => {
    const to = await cartRebuildDestination(
      new URLSearchParams(
        "utm_source=klaviyo&wck_rebuild_cart=KEY&_kx=abc.123&utm_campaign=ac",
      ),
      async () => withItems(1),
    );
    expect(to).toBe("/checkout?utm_source=klaviyo&_kx=abc.123&utm_campaign=ac");
  });

  it("goes home when nothing could be rebuilt", async () => {
    expect(
      await cartRebuildDestination(
        new URLSearchParams("wck_rebuild_cart=KEY"),
        async () => withItems(0),
      ),
    ).toBe("/");
  });

  it("goes home on a refused or failed rebuild", async () => {
    for (const rebuild of [
      async (): Promise<CartRebuildOutcome> => ({
        success: false,
        error: "CART_REBUILD_INVALID",
      }),
      async (): Promise<CartRebuildOutcome> => {
        throw new Error("network");
      },
    ]) {
      expect(
        await cartRebuildDestination(
          new URLSearchParams("wck_rebuild_cart=KEY&_kx=k"),
          rebuild,
        ),
      ).toBe("/?_kx=k");
    }
  });

  it("never calls commerce without a key", async () => {
    const rebuild = vi.fn(async () => withItems(1));
    for (const search of ["", "wck_rebuild_cart=", "wck_rebuild_cart=%20%20"]) {
      expect(
        await cartRebuildDestination(new URLSearchParams(search), rebuild),
      ).toBe("/");
    }
    expect(rebuild).not.toHaveBeenCalled();
  });
});
