import { productPath } from "@/lib/canonical-path";
import {
  escapeMarkdown,
  htmlToText,
  markdownFrontmatter,
  summarizeText,
} from "@/lib/markdown";
import { getPriceDisplay, pickFirstPrice } from "@/lib/price-display";
import { stripTitleMarkers } from "@/lib/title-emphasis";
import { decodeHtmlEntities, formatPrice } from "@/lib/utils";

/**
 * The product fields a mirror reads.
 *
 * Structural rather than an SDK export: `getCachedProduct` returns
 * `ProductFieldsFragment` and a list card returns `ProductSummaryFieldsFragment`,
 * which are not assignable to one another under `exactOptionalPropertyTypes`.
 * The list needs only the first six.
 */
export type MarkdownProduct = {
  slug: string;
  name?: string | null | undefined;
  uri?: string | null | undefined;
  price?: string | null | undefined;
  regularPrice?: string | null | undefined;
  onSale?: boolean | null | undefined;
  stockStatus?: string | null | undefined;
  shortDescription?: string | null | undefined;
  description?: string | null | undefined;
  seo?: { metaDesc?: string | null | undefined } | null | undefined;
  brands?:
    | ReadonlyArray<{ name?: string | null | undefined } | null | undefined>
    | null
    | undefined;
};

/** A product's display name: entities decoded, `{emphasis}` markers dropped. */
export function productDisplayName(product: MarkdownProduct): string {
  const name = stripTitleMarkers(decodeHtmlEntities(product.name ?? "")).trim();
  return name || product.slug;
}

/** `**$25.00 – $36.00**`, optionally followed by `Was $30.00`, or "" when the product has no price. */
export function priceMarkdown(
  product: MarkdownProduct,
  currency: string,
): string {
  const price = pickFirstPrice(product.price);
  if (!price) return "";
  const { min, max, struck } = getPriceDisplay({
    price,
    regularPrice: product.regularPrice ?? undefined,
    onSale: Boolean(product.onSale),
  });
  const current =
    max !== null
      ? `${formatPrice(min, currency)} – ${formatPrice(max, currency)}`
      : formatPrice(min, currency);
  return struck !== null
    ? `**${current}** · Was ${formatPrice(struck, currency)}`
    : `**${current}**`;
}

/** The availability words the page uses, or "" for a status the storefront does not name. */
export function stockMarkdown(stockStatus: string | null | undefined): string {
  switch ((stockStatus ?? "").toLowerCase()) {
    case "instock":
      return "In stock";
    case "outofstock":
      return "Sold out";
    case "onbackorder":
      return "Available on backorder";
    default:
      return "";
  }
}

/**
 * The product's Markdown twin and the HTML URL it is a twin of.
 *
 * The canonical is `productPath(product)`, the nested `/shop/...` URL when the
 * product has one: the mirror is addressed by the flat slug, but the document
 * an answer engine should cite is the one the sitemap lists.
 */
export function productToMarkdown(
  product: MarkdownProduct,
  opts: { origin: string; currency: string; hidePrices: boolean },
): { body: string; canonicalUrl: string } {
  const canonicalUrl = `${opts.origin}${productPath(product)}`;
  const description =
    summarizeText(htmlToText(product.seo?.metaDesc)) ||
    summarizeText(htmlToText(product.shortDescription)) ||
    summarizeText(htmlToText(product.description));
  const title = productDisplayName(product);
  const brandName = product.brands?.[0]?.name?.trim();

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

  if (brandName) sections.push(escapeMarkdown(brandName), "");
  if (description) sections.push(`> ${escapeMarkdown(description)}`, "");

  const facts = [
    opts.hidePrices ? "" : priceMarkdown(product, opts.currency),
    stockMarkdown(product.stockStatus),
  ].filter(Boolean);
  if (facts.length > 0) sections.push(facts.join(" · "), "");

  sections.push(
    "## Link",
    "",
    `- [View product](${canonicalUrl})`,
    "",
    "---",
    "",
    `*Canonical: ${canonicalUrl}*`,
    "",
  );

  return { body: sections.join("\n"), canonicalUrl };
}
