import { describe, it, expect, afterEach, vi } from "vitest";
import {
  defaultPriceLocale,
  formatPrice,
  getStoreCurrency,
  getFloatVal,
  decodeHtmlEntities,
  formatWooRichText,
} from "@/lib/utils";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("decodeHtmlEntities", () => {
  it("decodes common named and numeric entities", () => {
    expect(decodeHtmlEntities("A &#038; B")).toBe("A & B");
    expect(decodeHtmlEntities("Beds &amp; Mattresses")).toBe(
      "Beds & Mattresses",
    );
    expect(decodeHtmlEntities("Tom&apos;s")).toBe("Tom's");
    expect(decodeHtmlEntities("&quot;Sale&quot;")).toBe('"Sale"');
  });

  it("decodes en/em dashes used in Yoast SEO titles", () => {
    expect(decodeHtmlEntities("Design &#8211; Build")).toBe("Design – Build");
    expect(decodeHtmlEntities("Design &ndash; Build")).toBe("Design – Build");
    expect(decodeHtmlEntities("Intro &#8212; Outro")).toBe("Intro — Outro");
    expect(decodeHtmlEntities("Intro &mdash; Outro")).toBe("Intro — Outro");
  });

  it("is a no-op for plain text", () => {
    expect(decodeHtmlEntities("Plain title")).toBe("Plain title");
  });
});

describe("formatWooRichText", () => {
  it("returns empty string for blank input", () => {
    expect(formatWooRichText("")).toBe("");
    expect(formatWooRichText("   ")).toBe("");
  });

  it("leaves paragraph-structured HTML unchanged", () => {
    const html = "<p>First</p><p>Second<br />line</p>";
    expect(formatWooRichText(html)).toBe(html);
  });

  it("leaves a lone list block intact", () => {
    expect(formatWooRichText("<ul><li>One</li></ul>")).toBe(
      "<ul><li>One</li></ul>",
    );
  });

  it("wraps plain-text paragraphs and converts single newlines to br", () => {
    const input = "Para one.\nStill one.\n\nPara two.";
    expect(formatWooRichText(input)).toBe(
      "<p>Para one.<br />Still one.</p><p>Para two.</p>",
    );
  });

  it("preserves line breaks when inline bold is present", () => {
    expect(formatWooRichText("Intro <strong>bold</strong>\n\nNext para")).toBe(
      "<p>Intro <strong>bold</strong></p><p>Next para</p>",
    );
  });

  it("preserves surrounding paragraphs when a list is added", () => {
    const input = "Intro line\n\n<ul><li>One</li><li>Two</li></ul>\n\nOutro";
    expect(formatWooRichText(input)).toBe(
      "<p>Intro line</p><ul><li>One</li><li>Two</li></ul><p>Outro</p>",
    );
  });

  it("normalizes CRLF newlines like Woo plain text", () => {
    expect(formatWooRichText("A\r\n\r\nB")).toBe("<p>A</p><p>B</p>");
  });
});

describe("getStoreCurrency", () => {
  it("defaults to AUD when NEXT_PUBLIC_STORE_CURRENCY is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_CURRENCY", "");
    expect(getStoreCurrency()).toBe("AUD");
  });

  it("uses NEXT_PUBLIC_STORE_CURRENCY when set", () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_CURRENCY", "USD");
    expect(getStoreCurrency()).toBe("USD");
  });
});

describe("formatPrice", () => {
  it("formats an explicit currency code (cart/order path)", () => {
    expect(formatPrice(14, "AUD")).toBe("$14.00");
    expect(formatPrice(14, "USD")).toBe("$14.00");
  });

  it("prints each currency in its own locale when no locale is passed", () => {
    // en-US would disambiguate these as A$ / NZ$ / CA$ / "SGD 84.95".
    expect(formatPrice(84.95, "AUD")).toBe("$84.95");
    expect(formatPrice(84.95, "aud")).toBe("$84.95");
    expect(formatPrice(84.95, "NZD")).toBe("$84.95");
    expect(formatPrice(84.95, "CAD")).toBe("$84.95");
    expect(formatPrice(84.95, "SGD")).toBe("$84.95");
    expect(formatPrice(84.95, "GBP")).toBe("£84.95");
    expect(formatPrice(1234.5, "AUD")).toBe("$1,234.50");
  });

  it("keeps USD and unlisted currencies exactly as en-US printed them", () => {
    expect(formatPrice(1499, "USD")).toBe("$1,499.00");
    expect(formatPrice(84.95, "EUR")).toBe("€84.95");
    expect(formatPrice(84.95, "HKD")).toBe("HK$84.95");
  });

  it("lets an explicitly passed locale win over the currency default", () => {
    expect(formatPrice(84.95, "AUD", "en-US")).toBe("A$84.95");
  });

  it("falls back to the store currency when no code is passed (catalog path, F6)", () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_CURRENCY", "");
    // Catalog and cart must agree: default is the store currency (AUD),
    // not a hardcoded USD.
    expect(formatPrice(14)).toBe(formatPrice(14, "AUD"));
  });

  it("honours a configured store currency for the no-arg path", () => {
    vi.stubEnv("NEXT_PUBLIC_STORE_CURRENCY", "EUR");
    expect(formatPrice(14)).toBe("€14.00");
  });

  it("always renders two decimal places", () => {
    expect(formatPrice(1499, "USD")).toBe("$1,499.00");
    expect(formatPrice(11.5, "USD")).toBe("$11.50");
  });
});

describe("getFloatVal", () => {
  it("strips currency symbols and separators", () => {
    expect(getFloatVal("$24.00")).toBe(24);
    expect(getFloatVal("A$1499.50")).toBe(1499.5);
  });

  it("returns 0 for empty/nullish input", () => {
    expect(getFloatVal("")).toBe(0);
    expect(getFloatVal(null)).toBe(0);
    expect(getFloatVal(undefined)).toBe(0);
  });
});

describe("defaultPriceLocale", () => {
  it("maps a currency to its own locale, case-insensitively", () => {
    expect(defaultPriceLocale("AUD")).toBe("en-AU");
    expect(defaultPriceLocale("nzd")).toBe("en-NZ");
    expect(defaultPriceLocale("CAD")).toBe("en-CA");
    expect(defaultPriceLocale("GBP")).toBe("en-GB");
    expect(defaultPriceLocale("SGD")).toBe("en-SG");
    expect(defaultPriceLocale("USD")).toBe("en-US");
  });

  it("falls back to en-US for a currency with no entry", () => {
    expect(defaultPriceLocale("EUR")).toBe("en-US");
    expect(defaultPriceLocale("JPY")).toBe("en-US");
  });
});
