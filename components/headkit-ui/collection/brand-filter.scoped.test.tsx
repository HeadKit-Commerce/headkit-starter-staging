// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

/**
 * On a search with scoped facets the Brand panel lists the brands of the
 * matched products (`productFilter.brands`), and never fetches the store's
 * full brand list — that list is the store-wide answer the scope replaces.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("server-only", () => ({}));

const listFilterBrands = vi.hoisted(() =>
  vi.fn(async () => [
    { slug: "abus", name: "Abus" },
    { slug: "zipp", name: "Zipp" },
  ]),
);
vi.mock("@/lib/collection-actions", () => ({ listFilterBrands }));

const context = vi.hoisted(() => ({
  facetStatus: "ready" as "ready" | "static",
}));
vi.mock("@/components/headkit-ui/collection/collection-context", () => ({
  useCollection: () => ({
    filterValues: { categories: [], brands: [], attributes: {}, page: 1 },
    setFilterValues: (): void => {},
    facetStatus: context.facetStatus,
    productFilter: {
      brands: [
        { slug: "giro", name: "Giro", count: 3 },
        { slug: "bell", name: "Bell", count: 1 },
      ],
    },
  }),
}));

import { BrandFilter } from "./brand-filter";

async function render(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(<BrandFilter />);
  });
  return host;
}

describe("BrandFilter on scoped facets", () => {
  it("lists the matched products' brands and does not fetch the store list", async () => {
    context.facetStatus = "ready";
    listFilterBrands.mockClear();
    const host = await render();

    expect(host.textContent).toContain("Giro");
    expect(host.textContent).toContain("Bell");
    expect(host.textContent).not.toContain("Abus");
    expect(listFilterBrands).not.toHaveBeenCalled();
  });

  it("keeps the store's brand list on an un-scoped listing", async () => {
    context.facetStatus = "static";
    listFilterBrands.mockClear();
    const host = await render();

    expect(listFilterBrands).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Abus");
    expect(host.textContent).not.toContain("Giro");
  });
});
