import type { Product } from "@headkit/sdk";
import { productPath } from "@/lib/canonical-path";
import {
  escapeMarkdown,
  markdownFrontmatter,
  summarizeText,
} from "@/lib/markdown";
import { formatPrice, getFloatVal } from "@/lib/utils";

function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function priceLine(product: Product, currency: string): string {
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
  product: Product,
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
