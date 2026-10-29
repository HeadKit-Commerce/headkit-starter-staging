import type { ProductCategoryDetail } from "@headkit/sdk";
import { productPath } from "@/lib/canonical-path";
import {
  escapeMarkdown,
  htmlToText,
  markdownFrontmatter,
  summarizeText,
} from "@/lib/markdown";
import {
  priceMarkdown,
  productDisplayName,
  stockMarkdown,
  type MarkdownProduct,
} from "@/lib/markdown/product";
import { decodeHtmlEntities } from "@/lib/utils";

/** How many products a collection mirror lists. One catalogue page, not a crawl. */
export const MARKDOWN_COLLECTION_PRODUCT_LIMIT = 24;

/**
 * A collection's Markdown twin: the category, then page 1 of its products.
 *
 * `pathname` is the CANONICAL collection path (the category's own ancestry),
 * which is not necessarily the path the mirror was asked for — a flat
 * `/collections/{child}` is served here with `Link: rel="canonical"` naming the
 * nested URL, instead of a redirect the agent would have to follow into HTML.
 */
export function collectionToMarkdown(
  category: Pick<
    ProductCategoryDetail,
    "name" | "slug" | "description" | "seo"
  >,
  opts: {
    origin: string;
    pathname: string;
    currency: string;
    hidePrices: boolean;
    products: readonly MarkdownProduct[];
    /** Products in the whole collection, when the listing reported it. */
    total?: number | null | undefined;
  },
): { body: string; canonicalUrl: string } {
  const canonicalUrl = `${opts.origin}${opts.pathname}`;
  const title =
    decodeHtmlEntities(category.name ?? "").trim() ||
    category.slug ||
    "Collection";
  const description =
    summarizeText(htmlToText(category.seo?.metaDesc)) ||
    summarizeText(htmlToText(category.description));

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

  if (description) sections.push(`> ${escapeMarkdown(description)}`, "");

  sections.push("## Link", "", `- [Browse collection](${canonicalUrl})`, "");

  const listed = opts.products.slice(0, MARKDOWN_COLLECTION_PRODUCT_LIMIT);
  if (listed.length > 0) {
    sections.push("## Products", "");
    for (const product of listed) {
      const facts = [
        opts.hidePrices ? "" : priceMarkdown(product, opts.currency),
        stockMarkdown(product.stockStatus),
      ].filter(Boolean);
      const link = `[${escapeMarkdown(productDisplayName(product))}](${opts.origin}${productPath(product)})`;
      sections.push(`- ${[link, ...facts].join(" · ")}`);
    }
    sections.push("");
    if (typeof opts.total === "number" && opts.total > listed.length) {
      sections.push(
        `Showing ${listed.length} of ${opts.total} products. [See them all](${canonicalUrl}).`,
        "",
      );
    }
  }

  sections.push("---", "", `*Canonical: ${canonicalUrl}*`, "");
  return { body: sections.join("\n"), canonicalUrl };
}
