import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { config, proxy } from "@/proxy";

/**
 * `proxy.ts` end to end for the Markdown surface: the real function, a mocked
 * network. What it pins is what a unit test of `representation.ts` cannot see —
 * that the rewrite is taken BEFORE the canonical-redirect subrequest and the
 * posts-base-path read, and that an ordinary request still takes both.
 */
const BASE = "https://shop.example";

function request(
  path: string,
  init: { method?: string; accept?: string } = {},
): NextRequest {
  return new NextRequest(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: init.accept ? { accept: init.accept } : {},
  });
}

function mockFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response("{}", { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const BROWSER =
  "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proxy: Markdown rewrite", () => {
  it.each([
    ["/", "/api/markdown"],
    ["/search", "/api/markdown/search"],
    ["/collections/road", "/api/markdown/collections/road"],
    ["/products/bike", "/api/markdown/products/bike"],
  ])("rewrites Accept: text/markdown on %s", async (path, target) => {
    const fetchMock = mockFetch();
    const res = await proxy(request(path, { accept: "text/markdown" }));
    expect(res.headers.get("x-middleware-rewrite")).toBe(`${BASE}${target}`);
    // No canonical-redirect lookup and no config read: the flat product URL
    // must not be 308ed onto an HTML URL before the rewrite can happen.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites a .md suffix whatever Accept says, keeping the query", async () => {
    mockFetch();
    const res = await proxy(
      request("/products/bike.md?utm_source=x", { accept: BROWSER }),
    );
    expect(res.headers.get("x-middleware-rewrite")).toBe(
      `${BASE}/api/markdown/products/bike?utm_source=x`,
    );
    const home = await proxy(request("/index.md"));
    expect(home.headers.get("x-middleware-rewrite")).toBe(
      `${BASE}/api/markdown`,
    );
  });

  it("leaves an ordinary page request on its normal path", async () => {
    const fetchMock = mockFetch();
    const res = await proxy(request("/products/bike", { accept: BROWSER }));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
    // The flat product URL still pays its canonical lookup, as before.
    expect(fetchMock).toHaveBeenCalled();
  });

  it("does not answer Markdown to a Server Action POST or to a page with no twin", async () => {
    mockFetch();
    const post = await proxy(
      request("/products/bike", { method: "POST", accept: "text/markdown" }),
    );
    expect(post.headers.get("x-middleware-rewrite")).toBeNull();
    const nested = await proxy(
      request("/shop/road/bike", { accept: "text/markdown" }),
    );
    expect(nested.headers.get("x-middleware-rewrite")).toBeNull();
  });
});

describe("proxy matcher", () => {
  it("lists .md explicitly: the catch-all excludes every dotted path", () => {
    expect(config.matcher).toContain("/:path*.md");
  });
});
