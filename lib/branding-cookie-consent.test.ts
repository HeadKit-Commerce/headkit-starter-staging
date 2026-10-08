import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: (): void => {},
}));

vi.mock("@/lib/env", () => ({
  env: {
    DASHBOARD_API_URL: "https://dashboard.example/graphql/subgraph/headkit",
    DASHBOARD_API_TOKEN: "test-token",
  },
}));

// Dashboard branding is a plain fetch. The module still imports the commerce
// SDK for the icon fallback; this VM has no built `dist`, and these cases
// never call it.
vi.mock("@headkit/sdk", () => ({
  executeRequest: vi.fn(),
  GetBrandingDocument: {},
}));

import { getBranding } from "@/lib/branding";

/**
 * `storeSettings.cookieConsentEnabled` — the per-store cookie-consent gate.
 *
 * THE CLAIM: absent means OFF, on every path by which "absent" can happen.
 *
 * That is not a nicety. Every store on the platform today has no value for
 * this field, so the default is what the whole fleet gets on the next deploy.
 * If absent meant on, a consent banner would appear in front of every
 * merchant's customers without anyone asking them — a visible product change
 * to other people's stores. The paths below are the ways the storefront can
 * fail to learn the answer, and they must all land on false:
 *
 *  - dashboard-api is older than the field and returns null for it,
 *  - dashboard-api rejects the query outright (unknown field → non-200),
 *  - the request throws.
 *
 * The positive case is here too, because a default that can never be turned
 * off the other way is not a default, it is a constant.
 */

type GraphQLBody = { query: string };

/**
 * Answer the branding fetches. `cookieConsent` decides only what the isolated
 * cookie-consent query returns; every other query answers a minimal valid
 * bundle, so a test failure points at the field rather than at the fixture.
 */
function installFetch(
  cookieConsent:
    | { kind: "value"; enabled: boolean | null }
    | { kind: "status"; status: number }
    | { kind: "throw" },
): { queries: string[] } {
  const queries: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as GraphQLBody;
      queries.push(body.query);

      if (body.query.includes("cookieConsentEnabled")) {
        if (cookieConsent.kind === "throw") {
          throw new Error("dashboard-api unreachable");
        }
        if (cookieConsent.kind === "status") {
          return new Response("nope", { status: cookieConsent.status });
        }
        return Response.json({
          data: {
            storeSettings: { cookieConsentEnabled: cookieConsent.enabled },
          },
        });
      }

      return Response.json({
        data: {
          branding: { primaryColor: "#000", secondaryColor: "#fff" },
          storeSettings: { id: "s1", slug: "shop", name: "Shop" },
          seoSettings: { title: null, description: null, ogImageUrl: null },
        },
      });
    }),
  );

  return { queries };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("cookieConsentEnabled is off unless the merchant turned it on", () => {
  it("is false when dashboard-api answers null — the store that never set it", async () => {
    installFetch({ kind: "value", enabled: null });
    const bundle = await getBranding();
    expect(bundle.storeSettings.cookieConsentEnabled).toBe(false);
  });

  it("is false when dashboard-api does not know the field (non-200)", async () => {
    installFetch({ kind: "status", status: 400 });
    const bundle = await getBranding();
    expect(bundle.storeSettings.cookieConsentEnabled).toBe(false);
  });

  it("is false when the request throws", async () => {
    installFetch({ kind: "throw" });
    const bundle = await getBranding();
    expect(bundle.storeSettings.cookieConsentEnabled).toBe(false);
  });

  it("is true only when dashboard-api says true", async () => {
    installFetch({ kind: "value", enabled: true });
    const bundle = await getBranding();
    expect(bundle.storeSettings.cookieConsentEnabled).toBe(true);
  });
});

describe("the read stays isolated", () => {
  /**
   * The field must be asked for on its OWN query and never appear in the main
   * branding selections. Two reasons, and the second is the load-bearing one:
   * an unknown field there makes gqlgen answer `data: null` for the whole
   * document, which would discard colors, logo and SEO — the regression the
   * compat-query ladder above it exists to prevent. And because the isolated
   * query is the only source, "dashboard-api has never heard of this field"
   * and "the merchant left it off" arrive as the same answer.
   */
  it("asks for cookieConsentEnabled in exactly one query, alone", async () => {
    const { queries } = installFetch({ kind: "value", enabled: true });
    await getBranding();

    const asking = queries.filter((q) => q.includes("cookieConsentEnabled"));
    expect(asking).toHaveLength(1);
    // Alone: no branding / seoSettings selection riding along with it.
    expect(asking[0]).not.toContain("primaryColor");
    expect(asking[0]).not.toContain("seoSettings");
  });
});
