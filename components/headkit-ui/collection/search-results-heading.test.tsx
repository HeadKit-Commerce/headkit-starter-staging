import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * `/search`'s title block reads the PROVIDER's query and total, so the count
 * beside the title is always the count of the grid beneath it. The remount
 * behaviour that keeps the two in step on a soft navigation is covered by
 * `search-query-remount.test.tsx`; this file is the markup half.
 */

const context = vi.hoisted(() => ({ search: "", totalProducts: 0 }));
vi.mock("@/components/headkit-ui/collection/collection-context", () => ({
  useCollection: () => context,
}));
vi.mock("@/components/ui/breadcrumb", () => ({
  Breadcrumb: ({ items }: { items: { name: string }[] }): React.JSX.Element => (
    <nav aria-label="Breadcrumb">{items.map((i) => i.name).join(" > ")}</nav>
  ),
}));

import { SearchResultsHeading } from "./search-results-heading";

function html(
  search: string,
  totalProducts: number,
  breadcrumbs?: { name: string; uri: string; current: boolean }[],
): string {
  context.search = search;
  context.totalProducts = totalProducts;
  return renderToStaticMarkup(
    <SearchResultsHeading
      title="Search"
      description="Bare description"
      {...(breadcrumbs ? { breadcrumbs } : {})}
    />,
  );
}

describe("SearchResultsHeading", () => {
  it("shows the page's own title and description when there is no query", () => {
    const out = html("", 2678);
    expect(out).toContain(">Search</h1>");
    expect(out).toContain("Bare description");
    expect(out).not.toContain("products found");
  });

  it("treats a whitespace-only query as no query", () => {
    expect(html("   ", 12)).toContain(">Search</h1>");
  });

  it('shows `Search results for "q"` and the grid\'s own count', () => {
    const out = html("helmet", 52);
    expect(out).toContain("Search results for &quot;helmet&quot;");
    expect(out).toContain("52 products found for &quot;helmet&quot;");
    expect(out).not.toContain("Bare description");
  });

  it("uses the singular for exactly one match and the plural for none", () => {
    expect(html("gloves", 1)).toContain("1 product found for");
    expect(html("gloves", 0)).toContain("0 products found for");
  });

  it("keeps the breadcrumb trail the old header rendered above the title", () => {
    const out = html("helmet", 3, [
      { name: "Home", uri: "/", current: false },
      { name: "Search", uri: "/search", current: true },
    ]);
    expect(out.indexOf("Home &gt; Search")).toBeGreaterThan(-1);
    expect(out.indexOf("Home &gt; Search")).toBeLessThan(out.indexOf("<h1"));
  });
});
