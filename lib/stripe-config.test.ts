import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `stripe-config.ts` imports `@/lib/env`, whose top-level `createEnv()` runs
// Zod validation at module load and throws when the required server env vars
// (NEXT_PUBLIC_HEADKIT_PUBLIC_KEY, NEXT_PUBLIC_GRAPHQL_URL, HEADKIT_PRIVATE_KEY)
// are unset in the test environment — matching the same trap documented for
// `app/seo-robots-sitemap.test.ts`. Set real DASHBOARD_API_URL/_TOKEN values
// (not undefined) so the dashboard fallback actually reaches `fetch`
// instead of short-circuiting to DISABLED_STRIPE_CONFIG.
vi.mock("@/lib/env", () => ({
  env: {
    DASHBOARD_API_URL:
      "https://dashboard-api.example.test/graphql/subgraph/headkit",
    DASHBOARD_API_TOKEN: "test-token",
    NEXT_PUBLIC_HEADKIT_PUBLIC_KEY: "pk_store",
    NEXT_PUBLIC_GRAPHQL_URL: "https://graph.example.test/graphql",
    HEADKIT_PRIVATE_KEY: "sk_store",
  },
}));

const fetchCommerceStripeConfig = vi.fn();

vi.mock("./stripe-config-commerce", () => ({
  fetchCommerceStripeConfig: (...args: unknown[]) =>
    fetchCommerceStripeConfig(...args),
}));

import {
  coerceStripeConfig,
  DISABLED_STRIPE_CONFIG,
  fetchStripeConfig,
} from "./stripe-config";

function jsonResponse(body: unknown): {
  ok: true;
  json: () => Promise<unknown>;
} {
  return { ok: true, json: async () => body };
}

function commerceConfig(config: {
  publishableKey: string;
  accountId: string;
  bnplMessagingEnabled?: boolean;
}): {
  publishableKey: string;
  accountId: string;
  bnplMessagingEnabled: boolean;
} {
  return {
    bnplMessagingEnabled: false,
    ...config,
  };
}

describe("coerceStripeConfig", () => {
  it("selects the live key when the store is in live mode", () => {
    expect(
      coerceStripeConfig({
        publishableKeyTest: "pk_test_1",
        publishableKeyLive: "pk_live_1",
        accountId: "acct_1",
        mode: "LIVE",
        bnplMessagingEnabled: true,
      }),
    ).toEqual({
      publishableKey: "pk_live_1",
      accountId: "acct_1",
      bnplMessagingEnabled: true,
    });
  });

  it("selects the test key in test mode even when a live key is present", () => {
    expect(
      coerceStripeConfig({
        publishableKeyTest: "pk_test_1",
        publishableKeyLive: "pk_live_1",
        accountId: "acct_1",
        mode: "TEST",
        bnplMessagingEnabled: true,
      }).publishableKey,
    ).toBe("pk_test_1");
  });

  it("falls back to the test key when live mode has no live key", () => {
    expect(
      coerceStripeConfig({
        publishableKeyTest: "pk_test_1",
        publishableKeyLive: null,
        accountId: "acct_1",
        mode: "LIVE",
        bnplMessagingEnabled: true,
      }).publishableKey,
    ).toBe("pk_test_1");
  });

  it("defaults messaging OFF when the field is absent (older dashboard-api)", () => {
    expect(
      coerceStripeConfig({
        publishableKeyTest: "pk_test_1",
        accountId: "acct_1",
      }).bnplMessagingEnabled,
    ).toBe(false);
  });

  it("defaults to TEST when mode is absent (older dashboard-api)", () => {
    expect(
      coerceStripeConfig({
        publishableKeyTest: "pk_test_1",
        publishableKeyLive: "pk_live_1",
        accountId: "acct_1",
      }).publishableKey,
    ).toBe("pk_test_1");
  });

  it("returns a disabled config for a null payload", () => {
    expect(coerceStripeConfig(null)).toEqual({
      publishableKey: "",
      accountId: "",
      bnplMessagingEnabled: false,
    });
  });
});

describe("fetchStripeConfig", () => {
  beforeEach(() => {
    fetchCommerceStripeConfig.mockReset();
    fetchCommerceStripeConfig.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses commerce live keys and does not call dashboard-api", async () => {
    fetchCommerceStripeConfig.mockResolvedValue(
      commerceConfig({
        publishableKey: "pk_live_commerce",
        accountId: "acct_commerce",
        bnplMessagingEnabled: true,
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStripeConfig()).resolves.toEqual({
      publishableKey: "pk_live_commerce",
      accountId: "acct_commerce",
      bnplMessagingEnabled: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("disables BNPL when commerce reports no Connect account (Shopify)", async () => {
    fetchCommerceStripeConfig.mockResolvedValue(
      commerceConfig({
        publishableKey: "",
        accountId: "",
        bnplMessagingEnabled: true,
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStripeConfig()).resolves.toEqual(DISABLED_STRIPE_CONFIG);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // An enterprise store charges through its OWN Stripe account: commerce
  // answers with the store's publishable key and NO Connect account. That is
  // direct mode, not the Shopify case, and must not be disabled.
  it("returns direct mode for an enterprise store (real key, empty accountId)", async () => {
    fetchCommerceStripeConfig.mockResolvedValue(
      commerceConfig({
        publishableKey: "pk_live_merchant_own",
        accountId: "",
        bnplMessagingEnabled: false,
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStripeConfig()).resolves.toEqual({
      publishableKey: "pk_live_merchant_own",
      accountId: "",
      bnplMessagingEnabled: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays disabled on an empty key even if commerce names an account", async () => {
    fetchCommerceStripeConfig.mockResolvedValue(
      commerceConfig({
        publishableKey: "",
        accountId: "acct_orphan",
        bnplMessagingEnabled: true,
      }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStripeConfig()).resolves.toEqual(DISABLED_STRIPE_CONFIG);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to dashboard-api when commerce is unavailable", async () => {
    fetchCommerceStripeConfig.mockResolvedValue(null);
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          stripeConfig: {
            publishableKeyTest: "pk_test_1",
            publishableKeyLive: "pk_live_1",
            accountId: "acct_1",
            mode: "LIVE",
            bnplMessagingEnabled: true,
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStripeConfig();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      publishableKey: "pk_live_1",
      accountId: "acct_1",
      bnplMessagingEnabled: true,
    });
  });

  it("does not issue the compat query when the full query succeeds, and honours mode/bnplMessagingEnabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          stripeConfig: {
            publishableKeyTest: "pk_test_1",
            publishableKeyLive: "pk_live_1",
            accountId: "acct_1",
            mode: "LIVE",
            bnplMessagingEnabled: true,
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStripeConfig();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      publishableKey: "pk_live_1",
      accountId: "acct_1",
      bnplMessagingEnabled: true,
    });
  });

  it("retries with the compat query when the full query answers stripeConfig: null (unknown-field gqlgen response), and the publishable key survives", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { stripeConfig: null } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            stripeConfig: {
              publishableKeyTest: "pk_test_compat",
              publishableKeyLive: null,
              accountId: "acct_compat",
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStripeConfig();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.publishableKey).toBe("pk_test_compat");
    expect(result.accountId).toBe("acct_compat");
    // Compat response has no bnplMessagingEnabled field — must default false,
    // not carry over anything from the failed full-query attempt.
    expect(result.bnplMessagingEnabled).toBe(false);
  });

  it("retries with the compat query when the full query request rejects (network error)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            stripeConfig: {
              publishableKeyTest: "pk_test_compat2",
              accountId: "acct_compat2",
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStripeConfig();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.publishableKey).toBe("pk_test_compat2");
  });

  it("retries with the compat query when the full query responds non-ok", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            stripeConfig: {
              publishableKeyTest: "pk_test_compat3",
              accountId: "acct_compat3",
            },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchStripeConfig();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.publishableKey).toBe("pk_test_compat3");
  });

  it("returns DISABLED_STRIPE_CONFIG without throwing when both the full and compat queries fail", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("full down"))
      .mockRejectedValueOnce(new Error("compat down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStripeConfig()).resolves.toEqual(DISABLED_STRIPE_CONFIG);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
