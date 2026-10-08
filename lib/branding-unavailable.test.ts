import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandingUnavailableError } from "@/lib/branding-cache-policy";

const { envState } = vi.hoisted(() => ({
  envState: {
    DASHBOARD_API_URL: "https://dashboard.example/graphql/subgraph/headkit" as
      | string
      | undefined,
    DASHBOARD_API_TOKEN: "test-token" as string | undefined,
    NEXT_PHASE: undefined as string | undefined,
  },
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: (): void => {},
}));

vi.mock("@/lib/env", () => ({
  env: envState,
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

// Dashboard branding is a plain fetch. The module still imports the commerce
// SDK for the icon fallback; this VM has no built `dist`, and these cases
// never call it.
vi.mock("@headkit/sdk", () => ({
  executeRequest: vi.fn(),
  GetBrandingDocument: {},
}));

import { getBranding } from "@/lib/branding";

const ENDPOINT = "https://dashboard.example/graphql/subgraph/headkit";

function resetEnv(): void {
  envState.DASHBOARD_API_URL = ENDPOINT;
  envState.DASHBOARD_API_TOKEN = "test-token";
  envState.NEXT_PHASE = undefined;
}

beforeEach(() => {
  resetEnv();
  vi.unstubAllGlobals();
});

describe("a failed dashboard branding read is not stored as an empty logo", () => {
  it("throws when the dashboard answers non-200 at runtime", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    await expect(getBranding()).rejects.toBeInstanceOf(
      BrandingUnavailableError,
    );
  });

  it("throws when the dashboard fetch itself rejects at runtime", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(getBranding()).rejects.toBeInstanceOf(
      BrandingUnavailableError,
    );
  });

  it("returns the empty default during next build so a blip does not fail the build", async () => {
    envState.NEXT_PHASE = "phase-production-build";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );

    const bundle = await getBranding();
    expect(bundle.branding.logoUrl).toBeNull();
  });

  it("returns the empty default when dashboard env is unset, without calling fetch", async () => {
    envState.DASHBOARD_API_URL = undefined;
    envState.DASHBOARD_API_TOKEN = undefined;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const bundle = await getBranding();
    expect(bundle.branding.logoUrl).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a successful payload whose logo is genuinely empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          query?: string;
        };
        if (
          body.query?.includes("cookieConsentEnabled") &&
          !body.query.includes("primaryColor")
        ) {
          return Response.json({
            data: { storeSettings: { cookieConsentEnabled: false } },
          });
        }
        return Response.json({
          data: {
            branding: {
              primaryColor: "#111111",
              logoUrl: null,
              iconUrl: null,
            },
            storeSettings: { id: "s1", slug: "shop", name: "Shop" },
            seoSettings: { title: "Shop", description: null, ogImageUrl: null },
          },
        });
      }),
    );

    const bundle = await getBranding();
    expect(bundle.branding.logoUrl).toBeNull();
    expect(bundle.storeSettings.name).toBe("Shop");
  });

  it("returns an uploaded logo from a successful dashboard read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          query?: string;
        };
        if (
          body.query?.includes("cookieConsentEnabled") &&
          !body.query.includes("primaryColor")
        ) {
          return Response.json({
            data: { storeSettings: { cookieConsentEnabled: false } },
          });
        }
        return Response.json({
          data: {
            branding: {
              primaryColor: "#111111",
              logoUrl: "https://cdn.example/logo.png",
            },
            storeSettings: { id: "s1", slug: "shop", name: "Shop" },
            seoSettings: { title: "Shop", description: null, ogImageUrl: null },
          },
        });
      }),
    );

    const bundle = await getBranding();
    expect(bundle.branding.logoUrl).toBe("https://cdn.example/logo.png");
  });
});
