import { describe, expect, it } from "vitest";
import {
  getMarkdownMirrorPath,
  getMarkdownPath,
  markdownRewritePath,
  MARKDOWN_ROUTE_PREFIX,
  prefersMarkdown,
} from "@/lib/markdown/representation";

describe("prefersMarkdown", () => {
  it("is false when Accept is absent or empty", () => {
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown("")).toBe(false);
  });

  it("is false for what browsers, curl and crawlers send", () => {
    for (const accept of [
      "text/html",
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "*/*",
      "text/*",
      "application/json",
    ]) {
      expect(prefersMarkdown(accept), accept).toBe(false);
    }
  });

  it("is true when text/markdown wins the negotiation", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("TEXT/Markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
    expect(prefersMarkdown("text/html;q=0.5, text/markdown")).toBe(true);
    // Equal quality: the entry listed first wins.
    expect(prefersMarkdown("text/markdown;q=0.8, text/html;q=0.8")).toBe(true);
  });

  it("keeps HTML when it is ranked above, or equal and first", () => {
    expect(prefersMarkdown("text/html, text/markdown")).toBe(false);
    expect(prefersMarkdown("text/markdown;q=0.5, text/html")).toBe(false);
    expect(prefersMarkdown("text/html;q=0.8, text/markdown;q=0.8")).toBe(false);
    expect(prefersMarkdown("text/markdown;q=0, text/html")).toBe(false);
  });

  it("never answers Markdown to a client that does not name it", () => {
    // Pinned on purpose: Markdown reached only through a wildcard is not served.
    expect(prefersMarkdown("text/*, text/html;q=0.1")).toBe(false);
  });
});

describe("getMarkdownPath", () => {
  it("maps the four mirrored families", () => {
    expect(getMarkdownPath("/")).toBe(MARKDOWN_ROUTE_PREFIX);
    expect(getMarkdownPath("/search")).toBe(`${MARKDOWN_ROUTE_PREFIX}/search`);
    expect(getMarkdownPath("/collections/road")).toBe(
      `${MARKDOWN_ROUTE_PREFIX}/collections/road`,
    );
    expect(getMarkdownPath("/collections/bikes/road")).toBe(
      `${MARKDOWN_ROUTE_PREFIX}/collections/bikes/road`,
    );
    expect(getMarkdownPath("/products/bike")).toBe(
      `${MARKDOWN_ROUTE_PREFIX}/products/bike`,
    );
  });

  it("leaves everything else alone, including nested /shop product URLs", () => {
    for (const pathname of [
      "/shop",
      "/shop/road/bike",
      "/collections",
      "/products",
      "/search/extra",
      "/checkout",
      "/account/profile",
      "/api/markdown",
      "/news/post",
    ]) {
      expect(getMarkdownPath(pathname), pathname).toBeNull();
    }
  });
});

describe("getMarkdownMirrorPath", () => {
  it("strips .md, and treats /index.md as the home page", () => {
    expect(getMarkdownMirrorPath("/index.md")).toBe(MARKDOWN_ROUTE_PREFIX);
    expect(getMarkdownMirrorPath("/search.md")).toBe(
      `${MARKDOWN_ROUTE_PREFIX}/search`,
    );
    expect(getMarkdownMirrorPath("/products/bike.md")).toBe(
      `${MARKDOWN_ROUTE_PREFIX}/products/bike`,
    );
    expect(getMarkdownMirrorPath("/collections/a/b.md")).toBe(
      `${MARKDOWN_ROUTE_PREFIX}/collections/a/b`,
    );
  });

  it("is null for a path with no .md suffix or no mirror", () => {
    expect(getMarkdownMirrorPath("/products/bike")).toBeNull();
    expect(getMarkdownMirrorPath("/.md")).toBeNull();
    expect(getMarkdownMirrorPath("/shop/road/bike.md")).toBeNull();
    expect(getMarkdownMirrorPath("/notes.md")).toBeNull();
  });
});

describe("markdownRewritePath", () => {
  const MD = "text/markdown";
  const BROWSER =
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

  it("rewrites a .md GET whatever the Accept header says", () => {
    expect(markdownRewritePath("GET", "/products/bike.md", BROWSER)).toBe(
      `${MARKDOWN_ROUTE_PREFIX}/products/bike`,
    );
    expect(markdownRewritePath("HEAD", "/index.md", null)).toBe(
      MARKDOWN_ROUTE_PREFIX,
    );
  });

  it("rewrites an Accept: text/markdown GET on a mirrored family", () => {
    expect(markdownRewritePath("GET", "/products/bike", MD)).toBe(
      `${MARKDOWN_ROUTE_PREFIX}/products/bike`,
    );
    expect(markdownRewritePath("GET", "/", MD)).toBe(MARKDOWN_ROUTE_PREFIX);
  });

  it("does not rewrite an ordinary page request", () => {
    expect(markdownRewritePath("GET", "/", BROWSER)).toBeNull();
    expect(markdownRewritePath("GET", "/products/bike", BROWSER)).toBeNull();
    expect(markdownRewritePath("GET", "/products/bike", null)).toBeNull();
  });

  it("does not rewrite a page with no Markdown twin, however it is asked", () => {
    expect(markdownRewritePath("GET", "/shop/road/bike", MD)).toBeNull();
    expect(markdownRewritePath("GET", "/checkout", MD)).toBeNull();
    expect(markdownRewritePath("GET", "/shop/road/bike.md", MD)).toBeNull();
  });

  it("never rewrites a method that is not GET or HEAD (Server Actions POST to the page URL)", () => {
    expect(markdownRewritePath("POST", "/products/bike", MD)).toBeNull();
    expect(markdownRewritePath("POST", "/products/bike.md", MD)).toBeNull();
    expect(markdownRewritePath("PUT", "/", MD)).toBeNull();
  });
});
