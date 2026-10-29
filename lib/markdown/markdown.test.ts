import { describe, expect, it } from "vitest";
import {
  escapeMarkdown,
  htmlToText,
  markdownFrontmatter,
  summarizeText,
} from "@/lib/markdown";
import { collectionToMarkdown } from "@/lib/markdown/collection";
import { llmsTxtBody, pickLlmsCollections } from "@/lib/markdown/llms-txt";
import { productToMarkdown } from "@/lib/markdown/product";
import {
  markdownNotFound,
  markdownResponse,
  MARKDOWN_CACHE_CONTROL,
} from "@/lib/markdown/response";

const ORIGIN = "https://shop.example";

describe("escapeMarkdown", () => {
  it("escapes the backslash first, so escaping cannot be undone", () => {
    expect(escapeMarkdown("a\\b|c")).toBe("a\\\\b\\|c");
    // A trailing backslash must not swallow the escape of what follows it.
    expect(escapeMarkdown("a\\*b")).toBe("a\\\\\\*b");
    expect(escapeMarkdown("*_[`]")).toBe("\\*\\_\\[\\`\\]");
  });

  it("escapes angle brackets so a renderer cannot take them for HTML", () => {
    expect(escapeMarkdown("<img src=x onerror=y>")).toBe(
      "\\<img src=x onerror=y\\>",
    );
  });

  it("escapes a block marker at the start of the line only", () => {
    expect(escapeMarkdown("# heading")).toBe("\\# heading");
    expect(escapeMarkdown("> quote")).toBe("\\> quote");
    expect(escapeMarkdown("- item")).toBe("\\- item");
    expect(escapeMarkdown("+ item")).toBe("\\+ item");
    expect(escapeMarkdown("1. item")).toBe("1\\. item");
    expect(escapeMarkdown("size #5 - blue")).toBe("size #5 - blue");
  });

  it("keeps a value on one line, so it cannot open a second block", () => {
    expect(escapeMarkdown("Bike\n\n# Injected\n[x](y)")).toBe(
      "Bike # Injected \\[x\\](y)",
    );
    expect(escapeMarkdown("a\r\nb")).toBe("a b");
  });
});

describe("markdownFrontmatter", () => {
  it("quotes values as JSON strings and omits an empty description", () => {
    expect(
      markdownFrontmatter({
        canonicalUrl: `${ORIGIN}/products/a`,
        title: 'Say "hi"',
        description: undefined,
      }),
    ).toBe(
      `---\ntitle: "Say \\"hi\\""\ncanonical_url: "${ORIGIN}/products/a"\n---`,
    );
  });
});

describe("htmlToText / summarizeText", () => {
  it("drops tags, decodes entities and collapses whitespace", () => {
    expect(htmlToText("<p>Fast &amp; light.</p>\n<p>Second</p>")).toBe(
      "Fast & light. Second",
    );
    expect(htmlToText(null)).toBe("");
  });

  it("keeps the first sentence and cuts a long one", () => {
    expect(summarizeText("One. Two. Three.")).toBe("One.");
    expect(summarizeText("a".repeat(300), 10)).toBe(`${"a".repeat(9)}…`);
    expect(summarizeText("  ")).toBe("");
  });
});

describe("markdownResponse", () => {
  const res = markdownResponse({
    body: "# x",
    canonicalUrl: `${ORIGIN}/products/a`,
  });

  it("carries the four headers the contract names", () => {
    expect(res.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(res.headers.get("Vary")).toBe("Accept");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    expect(res.headers.get("Link")).toBe(
      `<${ORIGIN}/products/a>; rel="canonical"`,
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe(MARKDOWN_CACHE_CONTROL);
  });

  it("keeps the HTTP cache inside the PDP's 300 s availability window", () => {
    const maxAge = (name: string): number =>
      Number(new RegExp(`${name}=(\\d+)`).exec(MARKDOWN_CACHE_CONTROL)?.[1]);
    expect(
      maxAge("s-maxage") + maxAge("stale-while-revalidate"),
    ).toBeLessThanOrEqual(600);
    expect(maxAge("s-maxage")).toBeLessThanOrEqual(300);
  });

  it("is never cached or indexed when it is a 404", () => {
    const notFound = markdownNotFound();
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("Cache-Control")).toBe("no-store");
    expect(notFound.headers.get("X-Robots-Tag")).toBe("noindex");
  });
});

describe("productToMarkdown", () => {
  const product = {
    slug: "road-bike",
    name: "Road {Bike} &amp; Co | 2026",
    uri: `${ORIGIN}/shop/bikes/road-bike/`,
    price: "1299.00",
    regularPrice: "1499.00",
    onSale: true,
    stockStatus: "instock",
    shortDescription: "<p>Fast &amp; light. Built for hills.</p>",
    brands: [{ name: "Acme *Cycles*" }],
  };
  const opts = { origin: ORIGIN, currency: "AUD", hidePrices: false };

  it("names the nested HTML page as the canonical, not the flat mirror URL", () => {
    const { body, canonicalUrl } = productToMarkdown(product, opts);
    expect(canonicalUrl).toBe(`${ORIGIN}/shop/bikes/road-bike`);
    expect(body).toContain(`canonical_url: "${canonicalUrl}"`);
    expect(body).toContain(`- [View product](${canonicalUrl})`);
  });

  it("falls back to the flat URL when the product has no nested permalink", () => {
    const { canonicalUrl } = productToMarkdown(
      { slug: "gift-card", name: "Gift card" },
      opts,
    );
    expect(canonicalUrl).toBe(`${ORIGIN}/products/gift-card`);
  });

  it("decodes entities, drops title markers and escapes the rest", () => {
    const { body } = productToMarkdown(product, opts);
    expect(body).toContain("# Road Bike & Co \\| 2026");
    expect(body).toContain("Acme \\*Cycles\\*");
    expect(body).toContain("> Fast & light.");
  });

  it("states price, the was-price and availability", () => {
    const { body } = productToMarkdown(product, opts);
    expect(body).toMatch(/\*\*A\$1,299\.00\*\* · Was A\$1,499\.00 · In stock/);
  });

  it("renders a variable product's range and never a was-price beside it", () => {
    const { body } = productToMarkdown(
      { ...product, price: "25 - 36", regularPrice: "40", onSale: true },
      opts,
    );
    expect(body).toContain("**A$25.00 – A$36.00**");
    expect(body).not.toContain("Was");
  });

  it("hides every price on a quote-mode store, leaving availability", () => {
    const { body } = productToMarkdown(product, { ...opts, hidePrices: true });
    expect(body).not.toMatch(/\$\d/);
    expect(body).toContain("In stock");
  });

  it("says what each stock status means and names none it does not know", () => {
    const stock = (stockStatus: string | undefined): string =>
      productToMarkdown({ slug: "a", name: "A", stockStatus }, opts).body;
    expect(stock("outofstock")).toContain("Sold out");
    expect(stock("onbackorder")).toContain("Available on backorder");
    expect(stock("onbackorder")).not.toContain("In stock");
    expect(stock(undefined)).not.toMatch(/In stock|Sold out|backorder/);
  });

  it("prints no price line when the product has no price", () => {
    const { body } = productToMarkdown(
      { slug: "a", name: "A", price: "" },
      opts,
    );
    expect(body).not.toMatch(/\$/);
  });
});

describe("collectionToMarkdown", () => {
  const category = {
    name: "Road &amp; Gravel",
    slug: "road",
    description: "<p>Everything for the road.</p>",
    seo: null,
  };
  const products = [
    {
      slug: "a",
      name: "Alpha",
      uri: `${ORIGIN}/shop/road/a/`,
      price: "10",
      stockStatus: "instock",
    },
    { slug: "b", name: "Beta [new]", price: "20", stockStatus: "outofstock" },
  ];
  const opts = {
    origin: ORIGIN,
    pathname: "/collections/bikes/road",
    currency: "AUD",
    hidePrices: false,
    products,
  };

  it("canonicalises to the category's own path and links each product by its canonical", () => {
    const { body, canonicalUrl } = collectionToMarkdown(category, opts);
    expect(canonicalUrl).toBe(`${ORIGIN}/collections/bikes/road`);
    expect(body).toContain("# Road & Gravel");
    expect(body).toContain("> Everything for the road.");
    expect(body).toContain(
      `- [Alpha](${ORIGIN}/shop/road/a) · **A$10.00** · In stock`,
    );
    expect(body).toContain(
      `- [Beta \\[new\\]](${ORIGIN}/products/b) · **A$20.00** · Sold out`,
    );
  });

  it("says when the list is a slice of a bigger collection", () => {
    const { body } = collectionToMarkdown(category, { ...opts, total: 120 });
    expect(body).toContain("Showing 2 of 120 products.");
    expect(
      collectionToMarkdown(category, { ...opts, total: 2 }).body,
    ).not.toContain("Showing");
  });

  it("lists no more than the limit", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      slug: `p${i}`,
      name: `P${i}`,
    }));
    const { body } = collectionToMarkdown(category, {
      ...opts,
      products: many,
    });
    expect(body.match(/^- \[P\d+\]/gm)).toHaveLength(24);
  });

  it("omits prices for a quote-mode store and the Products section for an empty one", () => {
    expect(
      collectionToMarkdown(category, { ...opts, hidePrices: true }).body,
    ).not.toMatch(/\$\d/);
    expect(
      collectionToMarkdown(category, { ...opts, products: [] }).body,
    ).not.toContain("## Products");
  });
});

describe("pickLlmsCollections / llmsTxtBody", () => {
  const tree = [
    {
      slug: "bikes",
      name: "Bikes",
      children: [
        { slug: "road", name: "Road &amp; Gravel", children: [] },
        { slug: "mtb", name: "Mountain", children: [] },
      ],
    },
    { slug: "parts", name: "Parts", children: [] },
    { slug: "uncategorized", name: "Uncategorized", children: [] },
  ];

  it("lists roots before children and uses each category's canonical path", () => {
    expect(pickLlmsCollections(tree)).toEqual([
      { name: "Bikes", path: "/collections/bikes" },
      { name: "Parts", path: "/collections/parts" },
      { name: "Road & Gravel", path: "/collections/bikes/road" },
      { name: "Mountain", path: "/collections/bikes/mtb" },
    ]);
  });

  it("stops at the limit", () => {
    expect(pickLlmsCollections(tree, 2).map((c) => c.name)).toEqual([
      "Bikes",
      "Parts",
    ]);
  });

  const store = {
    origin: ORIGIN,
    name: "Acme *Cycles*",
    description: "Bikes for every road. We ship Australia-wide.",
    sitemapEnabled: true,
  };

  it("writes the llms.txt shape: H1, summary, then H2 link lists", () => {
    const body = llmsTxtBody(store, pickLlmsCollections(tree));
    expect(
      body.startsWith("# Acme \\*Cycles\\*\n\n> Bikes for every road.\n"),
    ).toBe(true);
    expect(body).toContain("## Browse");
    expect(body).toContain("## Collections");
    expect(body).toContain(`- [Bikes](${ORIGIN}/collections/bikes)`);
    expect(body).toContain(`- [Sitemap](${ORIGIN}/sitemap.xml)`);
    expect(body).toContain("`Accept: text/markdown`");
    expect(body).toContain("/index.md");
  });

  it("omits the sitemap when the store publishes none, and Collections when there are none", () => {
    const body = llmsTxtBody({ ...store, sitemapEnabled: false }, []);
    expect(body).not.toContain("sitemap.xml");
    expect(body).not.toContain("## Collections");
    expect(body).toContain(`${ORIGIN}/robots.txt`);
  });

  it("falls back to a stock summary when the store has no description", () => {
    expect(llmsTxtBody({ ...store, description: "" }, [])).toContain(
      "> Product catalogue for Acme \\*Cycles\\*.",
    );
  });
});
