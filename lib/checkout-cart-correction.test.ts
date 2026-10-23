import { afterEach, describe, expect, it, vi } from "vitest";
import { requestCartCorrection } from "./checkout-cart-correction";

/** The browser half of `/api/checkout/correct-cart`. */

const corrections = [{ itemKey: "k1", action: "remove" as const, quantity: 0 }];

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(impl: () => Promise<Response>): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("requestCartCorrection", () => {
  it("posts the corrections as JSON to the route handler", async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({ ok: true, cart: { itemsCount: 1 } }),
    );
    await expect(requestCartCorrection(corrections)).resolves.toEqual({
      ok: true,
      cart: { itemsCount: 1 },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/checkout/correct-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corrections }),
    });
  });

  it("reads a failure with no cart as { ok: false, cart: null }", async () => {
    stubFetch(async () => Response.json({ ok: false, cart: null }));
    await expect(requestCartCorrection(corrections)).resolves.toEqual({
      ok: false,
      cart: null,
    });
  });

  it("is null when the endpoint answers an error status", async () => {
    stubFetch(async () => Response.json({ ok: false }, { status: 400 }));
    await expect(requestCartCorrection(corrections)).resolves.toBeNull();
  });

  it("is null when the endpoint cannot be reached", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(requestCartCorrection(corrections)).resolves.toBeNull();
  });
});
