import { productPath } from "@/lib/canonical-path";
import {
  escapeMarkdown,
  markdownFrontmatter,
  summarizeText,
} from "@/lib/markdown";
import { formatPrice, getFloatVal } from "@/lib/utils";

/**
 * Structural product view for markdown mirrors.
 *
 * Wider than a single SDK export: `getCachedProduct` returns
 * `ProductFieldsFragment`, while `@headkit/sdk`'s `Product` is a stricter
 * shape. Under `exactOptionalPropertyTypes` those are not assignable either
 * way, so this module only names the fields it reads.
 */
export type MarkdownProduct = {
  slug: string;
  name?: string | null | undefined;
  uri?: string | null | undefined;
  price?: string | null | undefined;
  regularPrice?: string | null | undefined;
  stockStatus?: string | null | undefined;
  shortDescription?: string | null | undefined;
  description?: string | null | undefined;
  seo?: { metaDesc?: string | null | undefined } | null | undefined;
  brands?:
    | ReadonlyArray<{ name?: string | null | undefined } | null | undefined>
    | null
    | undefined;
};

function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function priceLine(product: MarkdownProduct, currency: string): string {
  const price = product.price ? getFloatVal(product.price) : null;
  const regular = product.regularPrice
    ? getFloatVal(product.regularPrice)
    : null;
  const parts: string[] = [];

  if (price != null && !Number.isNaN(price)) {
    parts.push(`**${formatPrice(price, currency)}**`);
  }
  if (
    regular != null &&
    !Number.isNaN(regular) &&
    price != null &&
    regular > price
  ) {
    parts.push(`Was ${formatPrice(regular, currency)}`);
  }

  const stock = product.stockStatus?.toLowerCase();
  if (stock === "outofstock") {
    parts.push("Sold out");
  } else if (stock) {
    parts.push("In stock");
  }

  return parts.join(" · ");
}

export function productToMarkdown(
  product: MarkdownProduct,
  opts: { siteUrl: string; currency: string },
): string {
  const path = productPath(product);
  const canonicalUrl = `${opts.siteUrl}${path}`;
  const description =
    summarizeText(stripHtml(product.seo?.metaDesc)) ||
    summarizeText(stripHtml(product.shortDescription)) ||
    summarizeText(stripHtml(product.description));
  const title = product.name?.trim() || product.slug;
  const brandName = product.brands?.[0]?.name;

  const sections: string[] = [
    markdownFrontmatter({
      canonicalUrl,
      description: description || undefined,
      title,
    }),
    "",
    `# ${escapeMarkdown(title)}`,
    "",
  ];

  if (brandName) {
    sections.push(escapeMarkdown(brandName), "");
  }

  if (description) {
    sections.push(`> ${escapeMarkdown(description)}`, "");
  }

  const price = priceLine(product, opts.currency);
  if (price) sections.push(price, "");

  sections.push(
    `## Link`,
    "",
    `- [View product](${canonicalUrl})`,
    "",
    "---",
    "",
    `*Canonical: ${canonicalUrl}*`,
  );

  return sections.join("\n");
}
