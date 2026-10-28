import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The canonical 308 must carry the incoming QUERY STRING (issue #74).
 *
 * WHAT THIS COVERS, and it is the whole chain the proxy runs except the wire:
 * the gate that decides a request is a candidate
 * (`isCanonicalRedirectCandidate`), the REAL decision functions the endpoint
 * calls (`canonicalRedirectForPath` → `canonicalCollectionRedirect` /
 * `canonicalProductRedirect`, driven through mocked SDK reads), and the URL the
 * proxy builds from the two (`canonicalRedirectUrl`). Composing them in one
 * test is deliberate: a gate test and a target test that both pass
 * INDIVIDUALLY are green while the query is dropped between them, which is
 * exactly the shape of the bug.
 *
 * WHERE IT STOPS. It issues no HTTP request and runs no middleware, so it
 * cannot see the status code, the `Location` header, or that `proxy.ts` calls
 * any of this at all. A 308 is a STATUS LINE, and the only thing that observes
 * one is a request to a built, running app — `e2e/canonical-url-308.spec.ts`
 * owns that half, including the two query-preservation cases. It also says
 * nothing about `app/collections/[...slug]/page.tsx` still redirecting for a
 * request with NO query: that is the same e2e spec's original cases.
 */

const getCategory = vi.fn();
const getFilters = vi.fn();
const getCachedProduct = vi.fn();

vi.mock("next/cache", () => ({
  cacheLife: (): void => {},
  cacheTag: (): void => {},
}));

vi.mock("next/navigation", () => ({
  unstable_rethrow: (): void => {},
}));

vi.mock("@/lib/sdk", () => ({
  headkit: {
    collections: {
      getCategory: (slug: string): unknown => getCategory(slug),
      getFilters: (slug: string): unknown => getFilters(slug),
      // `getCategoryData` reads the swatch-capable method; same payload.
      getFiltersWithSwatches: (slug: string): unknown => getFilters(slug),
    },
  },
}));

vi.mock("@/lib/product-cache", () => ({
  getCachedProduct: (slug: string): unknown => getCachedProduct(slug),
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalRedirectForPath } from "@/lib/canonical-redirect";
import {
  canonicalRedirectUrl,
  isCanonicalRedirectCandidate,
} from "@/lib/canonical-redirect-request";

const ORIGIN = "https://shop.example.com";

/** The category the theme's flat menu link resolves to: it lives two deep. */
function nestedCategory(): Record<string, unknown> {
  return {
    id: "2",
    name: "Locks",
    slug: "locks",
    ancestors: [{ id: "1", name: "Equipment", slug: "equipment" }],
  };
}

/** A product whose WooCommerce permalink nests it under /shop/equipment/locks. */
function nestedProduct(): Record<string, unknown> {
  return {
    slug: "abus-steelochain-5805c-110cm",
    uri: `${ORIGIN}/shop/equipment/locks/abus-steelochain-5805c-110cm/`,
  };
}

/**
 * The proxy's whole job for one request: decide, resolve, build the URL.
 * Returns null when the request is not a candidate, which is the "leave it to
 * the route" answer.
 */
async function proxyRedirect(
  requestUrl: string,
  method = "GET",
): Promise<string | null> {
  const url = new URL(requestUrl);
  if (!isCanonicalRedirectCandidate(method, url.pathname, url.search)) {
    return null;
  }
  const target = await canonicalRedirectForPath(url.pathname);
  if (!target) return null;
  return canonicalRedirectUrl(url, target).toString();
}

beforeEach(() => {
  vi.clearAllMocks();
  getFilters.mockResolvedValue(null);
});

describe("the canonical 308 preserves the query string", () => {
  it("carries gclid, utm_* and _kx through the flat COLLECTION redirect", async () => {
    getCategory.mockResolvedValue(nestedCategory());

    const redirect = await proxyRedirect(
      `${ORIGIN}/collections/locks?utm_source=google&utm_medium=cpc&gclid=Cj0KEQ&_kx=KX1`,
    );

    expect(
      redirect,
      "a flat child collection carrying a campaign query must still redirect",
    ).not.toBeNull();
    const url = new URL(redirect!);
    expect(url.pathname, "the target path must not change").toBe(
      "/collections/equipment/locks",
    );
    expect(url.searchParams.get("gclid")).toBe("Cj0KEQ");
    expect(url.searchParams.get("_kx")).toBe("KX1");
    expect(url.searchParams.get("utm_source")).toBe("google");
    expect(url.searchParams.get("utm_medium")).toBe("cpc");
  });

  it("carries them through the flat PRODUCT redirect", async () => {
    getCachedProduct.mockResolvedValue(nestedProduct());

    const redirect = await proxyRedirect(
      `${ORIGIN}/products/abus-steelochain-5805c-110cm?utm_source=klaviyo&_kx=KX1&gclid=Cj0KEQ`,
    );

    expect(redirect).not.toBeNull();
    const url = new URL(redirect!);
    expect(url.pathname).toBe(
      "/shop/equipment/locks/abus-steelochain-5805c-110cm",
    );
    expect(url.searchParams.get("gclid")).toBe("Cj0KEQ");
    expect(url.searchParams.get("_kx")).toBe("KX1");
    expect(url.searchParams.get("utm_source")).toBe("klaviyo");
  });

  it("resolves a flat PRODUCT URL with NO query too", async () => {
    // The route cannot be trusted with this one: an unbuilt slug is served
    // from its PPR fallback shell, so its own `permanentRedirect` lands after
    // a committed 200 (see `isCanonicalRedirectCandidate`).
    getCachedProduct.mockResolvedValue(nestedProduct());

    const redirect = await proxyRedirect(
      `${ORIGIN}/products/abus-steelochain-5805c-110cm`,
    );

    expect(redirect).not.toBeNull();
    const url = new URL(redirect!);
    expect(url.pathname).toBe(
      "/shop/equipment/locks/abus-steelochain-5805c-110cm",
    );
    expect(url.search, "nothing is invented when nothing was sent").toBe("");
  });

  it("preserves a repeated and an empty parameter verbatim", async () => {
    getCategory.mockResolvedValue(nestedCategory());

    const redirect = await proxyRedirect(
      `${ORIGIN}/collections/locks?utm_term=&brands=abus&brands=kryptonite`,
    );

    // The whole query is carried as ONE opaque string: nothing here parses,
    // re-serialises or de-duplicates it, so a parameter the storefront does not
    // know about survives exactly as sent.
    expect(new URL(redirect!).search).toBe(
      "?utm_term=&brands=abus&brands=kryptonite",
    );
  });

  it("keeps the /f/<facet> path segment as well as the query", async () => {
    getCategory.mockResolvedValue(nestedCategory());

    const redirect = await proxyRedirect(
      `${ORIGIN}/collections/locks/f/colour.black?gclid=Cj0KEQ`,
    );

    expect(new URL(redirect!).pathname).toBe(
      "/collections/equipment/locks/f/colour.black",
    );
    expect(new URL(redirect!).searchParams.get("gclid")).toBe("Cj0KEQ");
  });
});

describe("what the proxy deliberately leaves to the route", () => {
  it("does not look up a COLLECTION request with no query string", async () => {
    expect(
      await proxyRedirect(`${ORIGIN}/collections/locks`),
      "with nothing to preserve, the route's own 308 is already correct",
    ).toBeNull();
    expect(
      getCategory,
      "and the lookup must not have been made at all — that is what keeps ordinary traffic free",
    ).not.toHaveBeenCalled();
  });

  it("does not look up a Server Action POST to a listing URL", async () => {
    expect(
      await proxyRedirect(`${ORIGIN}/collections/locks?page=2`, "POST"),
      "a Server Action posts to the page's own URL, query and all",
    ).toBeNull();
    expect(getCategory).not.toHaveBeenCalled();
  });

  it("does not look up an ALREADY-NESTED collection URL", async () => {
    expect(
      await proxyRedirect(`${ORIGIN}/collections/equipment/locks?page=2`),
      "the nested shape is canonical for every category the tree agrees about; browsing it must cost no subrequest",
    ).toBeNull();
    expect(getCategory).not.toHaveBeenCalled();
  });

  it("does not redirect a ROOT category onto itself", async () => {
    getCategory.mockResolvedValue({
      id: "1",
      name: "Equipment",
      slug: "equipment",
      ancestors: [],
    });

    expect(
      await proxyRedirect(`${ORIGIN}/collections/equipment?gclid=Cj0KEQ`),
      "a root category is its own canonical — redirecting it would loop",
    ).toBeNull();
  });

  it("does not redirect a product the PUBLIC catalogue cannot see", async () => {
    getCachedProduct.mockResolvedValue(null);

    expect(
      await proxyRedirect(
        `${ORIGIN}/products/some-draft?preview_key=not-a-real-key`,
      ),
      "that null is the position a Shopify draft occupies, and a 308 would strip the preview key before anything could read it",
    ).toBeNull();
  });

  it("degrades to no redirect when the catalogue read THROWS", async () => {
    getCachedProduct.mockRejectedValue(new Error("upstream 429"));

    expect(
      await proxyRedirect(`${ORIGIN}/products/anything?gclid=Cj0KEQ`),
      "a transport blip must never become a redirect",
    ).toBeNull();
  });

  it("answers null for a path outside the two consolidating families", async () => {
    expect(
      await proxyRedirect(`${ORIGIN}/news/some-post?gclid=Cj0KEQ`),
    ).toBeNull();
    expect(await proxyRedirect(`${ORIGIN}/checkout?gclid=Cj0KEQ`)).toBeNull();
    expect(getCategory).not.toHaveBeenCalled();
    expect(getCachedProduct).not.toHaveBeenCalled();
  });
});

/**
 * The composition above proves the RULE. It cannot prove `proxy.ts` runs it,
 * and a fix nothing calls is the failure mode this repo has shipped before — a
 * navigation skeleton that rendered inside a container that unmounted it, a
 * purge that resolved silently against an absent request context. Middleware
 * has no importable, callable form in vitest (it is compiled into its own
 * bundle and its request object is not constructible here), so the wiring is
 * asserted at SOURCE level. That is a weaker claim, and it is the strongest one
 * available without an HTTP request: it catches deletion and reordering, not a
 * subtly wrong call.
 */
describe("proxy.ts is actually wired to it", () => {
  const proxySource = readFileSync(
    join(import.meta.dirname, "..", "proxy.ts"),
    "utf8",
  );

  it("imports the gate and the URL builder", () => {
    expect(proxySource).toContain("isCanonicalRedirectCandidate");
    expect(proxySource).toContain("canonicalRedirectUrl");
    expect(proxySource).toContain("/api/canonical-redirect");
  });

  it("returns the redirect from proxy() BEFORE the per-store config read", () => {
    const call = proxySource.indexOf("await canonicalRedirect(request)");
    const config = proxySource.indexOf("await readProxyConfig(request)");
    expect(call, "proxy() must call canonicalRedirect").toBeGreaterThan(-1);
    expect(config).toBeGreaterThan(-1);
    expect(
      call,
      "a request that is leaving on a 308 needs neither the blog rewrite nor a robots header, and must not pay for the config subrequest",
    ).toBeLessThan(config);
  });

  it("runs AFTER the maintenance gate", () => {
    const maintenance = proxySource.indexOf("await maintenanceGate(request)");
    const call = proxySource.indexOf("await canonicalRedirect(request)");
    expect(
      maintenance,
      "a dark store must never wait on a catalogue lookup (MAINTENANCE.md, cutover gate G6)",
    ).toBeLessThan(call);
  });
});
