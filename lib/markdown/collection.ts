import type { ProductCategoryDetail } from "@headkit/sdk";
import {
  escapeMarkdown,
  markdownFrontmatter,
  summarizeText,
} from "@/lib/markdown";

function stripHtml(html: string | null | undefined): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

export function collectionToMarkdown(
  category: Pick<
    ProductCategoryDetail,
    "name" | "slug" | "description" | "seo"
  >,
  opts: {
    siteUrl: string;
    pathname: string;
    productNames?: readonly string[];
  },
): string {
  const canonicalUrl = `${opts.siteUrl}${opts.pathname}`;
  const title = category.name?.trim() || category.slug || "Collection";
  const description =
    summarizeText(stripHtml(category.seo?.metaDesc)) ||
    summarizeText(stripHtml(category.description));

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

  if (description) {
    sections.push(`> ${escapeMarkdown(description)}`, "");
  }

  sections.push(
    `## Link`,
    "",
    `- [Browse collection](${canonicalUrl})`,
    "",
  );

  if (opts.productNames && opts.productNames.length > 0) {
    sections.push("## Products", "");
    for (const name of opts.productNames) {
      sections.push(`- ${escapeMarkdown(name)}`);
    }
    sections.push("");
  }

  sections.push("---", "", `*Canonical: ${canonicalUrl}*`);
  return sections.join("\n");
}
