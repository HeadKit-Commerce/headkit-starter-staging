import { describe, expect, it } from "vitest";
import { escapeMarkdown } from "@/lib/markdown";
import {
  getMarkdownMirrorPath,
  getMarkdownPath,
  getMarkdownRewritePath,
  prefersMarkdown,
} from "@/lib/markdown/representation";

describe("escapeMarkdown", () => {
  it("escapes backslashes before other markdown metacharacters", () => {
    expect(escapeMarkdown("a\\b|c")).toBe("a\\\\b\\|c");
    expect(escapeMarkdown("*_[`]#")).toBe("\\*\\_\\[\\`\\]#");
    expect(escapeMarkdown("# heading")).toBe("\\# heading");
  });
});

describe("prefersMarkdown", () => {
  it("is false when Accept is absent or HTML-preferred", () => {
    expect(prefersMarkdown(null)).toBe(false);
    expect(prefersMarkdown("text/html")).toBe(false);
    expect(prefersMarkdown("text/html,application/xhtml+xml,*/*;q=0.8")).toBe(
      false,
    );
  });

  it("is true when text/markdown wins the negotiation", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
    expect(prefersMarkdown("text/*, text/html;q=0.1")).toBe(false);
  });
});

describe("getMarkdownPath / mirror", () => {
  it("maps home, search, collections, and products", () => {
    expect(getMarkdownPath("/")).toBe("/md");
    expect(getMarkdownPath("/search")).toBe("/md/search");
    expect(getMarkdownPath("/collections/road")).toBe("/md/collections/road");
    expect(getMarkdownPath("/products/bike")).toBe("/md/products/bike");
    expect(getMarkdownPath("/shop/road/bike")).toBe(null);
  });

  it("strips .md for the mirror path", () => {
    expect(getMarkdownMirrorPath("/index.md")).toBe("/md");
    expect(getMarkdownMirrorPath("/products/bike.md")).toBe(
      "/md/products/bike",
    );
    expect(getMarkdownMirrorPath("/products/bike")).toBe(null);
  });
});

describe("getMarkdownRewritePath", () => {
  it("rewrites .md and Accept: text/markdown GETs", () => {
    expect(
      getMarkdownRewritePath(
        new Request("https://example.test/products/bike.md"),
      ),
    ).toBe("/md/products/bike");
    expect(
      getMarkdownRewritePath(
        new Request("https://example.test/products/bike", {
          headers: { Accept: "text/markdown" },
        }),
      ),
    ).toBe("/md/products/bike");
    expect(
      getMarkdownRewritePath(
        new Request("https://example.test/products/bike", {
          method: "POST",
          headers: { Accept: "text/markdown" },
        }),
      ),
    ).toBe(null);
  });
});
