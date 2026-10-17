import { describe, expect, it, vi } from "vitest";

// `lib/stripe-js-singleton.ts` reads the store's advanced-fraud-signals
// setting from `@/lib/env`, and this subtree reaches it. Under vitest's `node`
// environment `createEnv()` takes the SERVER branch and parses the server
// schema, so importing it for real would demand a fully populated environment
// this spec has no interest in. Mocked to an empty object: every key the
// singleton reads is optional, and unset is the platform default.
vi.mock("@/lib/env", () => ({ env: {} }));

const { shouldRenderMessaging, messagingStripeLoadOptions } =
  await import("./payment-messaging");

const base = {
  publishableKey: "pk_test_1",
  currency: "AUD",
  enabled: true,
  stripeAccountId: "acct_1",
};

describe("shouldRenderMessaging", () => {
  it("renders for a supported currency when enabled", () => {
    expect(shouldRenderMessaging(base)).toBe(true);
  });

  it("does not render when the store toggle is off", () => {
    expect(shouldRenderMessaging({ ...base, enabled: false })).toBe(false);
  });

  it("does not render without a publishable key", () => {
    expect(shouldRenderMessaging({ ...base, publishableKey: "" })).toBe(false);
  });

  it("does not render for an unsupported currency", () => {
    expect(shouldRenderMessaging({ ...base, currency: "THB" })).toBe(false);
  });

  it("accepts lower-case currency", () => {
    expect(shouldRenderMessaging({ ...base, currency: "aud" })).toBe(true);
  });

  it("does not render when explicitly disabled (out of stock)", () => {
    expect(shouldRenderMessaging({ ...base, disabled: true })).toBe(false);
  });

  // Direct mode: an enterprise store's own publishable key with no account.
  it("renders in direct mode (own key, no Connect account)", () => {
    expect(shouldRenderMessaging({ ...base, stripeAccountId: "" })).toBe(true);
    expect(shouldRenderMessaging({ ...base, stripeAccountId: null })).toBe(
      true,
    );
    expect(shouldRenderMessaging({ ...base, stripeAccountId: undefined })).toBe(
      true,
    );
  });

  // What keeps a Shopify / no-Stripe store from loading Stripe.js is the
  // answer commerce gives it — no key, toggle off — not the missing account.
  it("does not render for the no-Stripe answer (no key, no account, off)", () => {
    expect(
      shouldRenderMessaging({
        ...base,
        publishableKey: "",
        stripeAccountId: "",
        enabled: false,
      }),
    ).toBe(false);
    expect(
      shouldRenderMessaging({
        ...base,
        publishableKey: "",
        stripeAccountId: "",
      }),
    ).toBe(false);
  });

  it("does not render for a malformed account id", () => {
    expect(shouldRenderMessaging({ ...base, stripeAccountId: "bogus" })).toBe(
      false,
    );
  });
});

describe("messagingStripeLoadOptions", () => {
  it("passes stripeAccount for a Connect store", () => {
    expect(messagingStripeLoadOptions("acct_1")).toEqual({
      stripeAccount: "acct_1",
    });
  });

  it("passes no stripeAccount in direct mode", () => {
    expect(messagingStripeLoadOptions("")).toEqual({});
    expect(messagingStripeLoadOptions(null)).toEqual({});
    expect(messagingStripeLoadOptions(undefined)).toEqual({});
  });
});
