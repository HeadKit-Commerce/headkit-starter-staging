import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import {
  CART_TOKEN_FALLBACK_MAX_AGE,
  cartTokenCookieOptions,
  cartTokenSecondsLeft,
} from "./cart";

const NOW = 1_792_665_214;

function jwt(payload: object): string {
  return `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

describe("cartTokenSecondsLeft", () => {
  it("reads exp from a base64url payload", () => {
    expect(
      cartTokenSecondsLeft(jwt({ exp: NOW + 600, k: "??>>" }), NOW * 1000),
    ).toBe(600);
  });

  it("answers null for an expired, exp-less or non-JWT token", () => {
    expect(cartTokenSecondsLeft(jwt({ exp: NOW - 1 }), NOW * 1000)).toBeNull();
    expect(cartTokenSecondsLeft(jwt({ exp: NOW }), NOW * 1000)).toBeNull();
    expect(cartTokenSecondsLeft(jwt({ iat: NOW }), NOW * 1000)).toBeNull();
    expect(cartTokenSecondsLeft(jwt({ exp: "soon" }), NOW * 1000)).toBeNull();
    expect(
      cartTokenSecondsLeft("gid://shopify/Cart/abc", NOW * 1000),
    ).toBeNull();
    expect(cartTokenSecondsLeft("", NOW * 1000)).toBeNull();
  });
});

describe("cartTokenCookieOptions", () => {
  it("falls back to 48h with no token or no readable exp", () => {
    expect(CART_TOKEN_FALLBACK_MAX_AGE).toBe(48 * 3600);
    expect(cartTokenCookieOptions().maxAge).toBe(CART_TOKEN_FALLBACK_MAX_AGE);
    expect(cartTokenCookieOptions("gid://shopify/Cart/abc").maxAge).toBe(
      CART_TOKEN_FALLBACK_MAX_AGE,
    );
  });

  it("keeps the cookie's name and flags", () => {
    expect(cartTokenCookieOptions()).toMatchObject({
      name: "hk-cart-token",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  });
});
