import { walkCategoryPaths } from "@/app/shop/shop-slug";
import { getBranding } from "@/lib/branding";
import { getNonEmptyCollectionSlugs } from "@/lib/hide-empty-collections";
import { escapeMarkdown, summarizeText } from "@/lib/markdown";
import { headkit } from "@/lib/sdk";
import { resolveSiteUrl } from "@/lib/site-url";

function flattenCategoryNames(
  categories: ReadonlyArray<{
    slug?: string | null;
    name?: string | null;
    children?: ReadonlyArray<{
      slug?: string | null;
      name?: string | null;
      children?: readonly unknown[];
    }> | null;
  }>,
  into = new Map<string, string>(),
): Map<string, string> {
  for (const cat of categories) {
    const slug = cat.slug?.trim().toLowerCase();
    if (slug && !into.has(slug)) {
      into.set(slug, cat.name?.trim() || slug);
    }
    if (cat.children?.length) {
      flattenCategoryNames(
        cat.children as Parameters<typeof flattenCategoryNames>[0],
        into,
      );
    }
  }
  return into;
}

export async function GET(): Promise<Response> {
  const { storeSettings, seoSettings } = await getBranding();
  const siteUrl = resolveSiteUrl(storeSettings.domain);
  const name = storeSettings.name?.trim() || "Store";
  const description =
    summarizeText(seoSettings.description ?? "") ||
    `Product catalog for ${name}.`;

  let collectionLinks: string[] = [];
  try {
    const [categories, nonEmpty] = await Promise.all([
      headkit.collections.getCategories(),
      getNonEmptyCollectionSlugs(),
    ]);
    const names = flattenCategoryNames(categories);
    const nodes = walkCategoryPaths(categories);
    const seen = new Set<string>();
    for (const node of nodes) {
      const slug = node.slug?.trim().toLowerCase();
      if (!slug || seen.has(slug)) continue;
      if (nonEmpty && !nonEmpty.has(slug)) continue;
      seen.add(slug);
      const path = `/collections/${slug}`;
      const title = names.get(slug) || slug;
      const link = siteUrl
        ? `[${escapeMarkdown(title)}](${siteUrl}${path})`
        : `[${escapeMarkdown(title)}](${path})`;
      collectionLinks.push(`- ${link}`);
      if (collectionLinks.length >= 50) break;
    }
  } catch {
    collectionLinks = [];
  }

  const origin = siteUrl || "";
  const body = `# ${escapeMarkdown(name)}

> ${escapeMarkdown(description)}

Home, product, collection, and search pages return Markdown with an \`Accept: text/markdown\` header or at the page URL with \`.md\` appended (\`/index.md\` for the home page).

## Browse

- [All products](${origin}/shop): The product catalog.
- [Search](${origin}/search): Search products by keyword.
${collectionLinks.length > 0 ? `\n## Collections\n\n${collectionLinks.join("\n")}\n` : ""}
## Discovery

- [Sitemap](${origin}/sitemap.xml): Complete index of product and collection URLs.
- [Robots](${origin}/robots.txt): Crawl policy.
`;

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
