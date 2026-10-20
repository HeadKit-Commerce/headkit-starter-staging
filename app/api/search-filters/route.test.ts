import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/search-filters` forwards a search's matched IDs to the scoped facet
 * read, refuses anything that did not come from a grid, and turns an upstream
 * failure into a 502 — never into store-wide options.
 */

const getCachedSearchFacets = vi.fn();
vi.mock("@/lib/catalog-cache", () => ({ getCachedSearchFacets }));

function post(body: unknown, contentType = "application/json"): Request {
  return new Request("http://localhost/api/search-filters", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let POST: typeof import("./route").POST;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ POST } = await import("./route"));
});

describe("POST /api/search-filters", () => {
  it("reads the scoped options with the IDs sorted and de-duplicated", async () => {
    getCachedSearchFacets.mockResolvedValue({ brands: [{ slug: "giro" }] });
    const res = await POST(post({ productIds: [1388, 1201, 1388] }));

    expect(res.status).toBe(200);
    expect(getCachedSearchFacets).toHaveBeenCalledWith([1201, 1388]);
    expect(await res.json()).toEqual({ brands: [{ slug: "giro" }] });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["no list", {}],
    ["an empty list", { productIds: [] }],
    ["a zero", { productIds: [1, 0] }],
    ["a negative", { productIds: [-4] }],
    ["a fraction", { productIds: [1.5] }],
    ["a string", { productIds: ["12"] }],
    ["501 ids", { productIds: Array.from({ length: 501 }, (_, i) => i + 1) }],
  ])("refuses %s with a 400 and no read", async (_label, body) => {
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(getCachedSearchFacets).not.toHaveBeenCalled();
  });

  it("requires JSON", async () => {
    const res = await POST(
      post("productIds=1", "application/x-www-form-urlencoded"),
    );
    expect(res.status).toBe(415);
    expect(getCachedSearchFacets).not.toHaveBeenCalled();
  });

  it("answers 502 when the read fails", async () => {
    getCachedSearchFacets.mockRejectedValue(new Error("upstream 404"));
    const res = await POST(post({ productIds: [7] }));
    expect(res.status).toBe(502);
  });
});
