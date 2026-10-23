import { getBranding } from "@/lib/branding";
import { escapeMarkdown, markdownFrontmatter } from "@/lib/markdown";
import { markdownHeaders } from "@/lib/markdown/representation";
import { resolveSiteUrl } from "@/lib/site-url";

export async function GET(): Promise<Response> {
  const { storeSettings, seoSettings } = await getBranding();
  const siteUrl = resolveSiteUrl(storeSettings.domain);
  const name = storeSettings.name?.trim() || "Store";
  const description = seoSettings.description?.trim() || "";
  const canonicalUrl = siteUrl ? `${siteUrl}/` : "/";

  const body = `${markdownFrontmatter({
    canonicalUrl,
    description: description || undefined,
    title: name,
  })}

# ${escapeMarkdown(name)}

${escapeMarkdown(description)}

## Browse

- [All products](${siteUrl}/shop): Browse the complete catalog.
- [Search](${siteUrl}/search): Search products by keyword.
- [Collections](${siteUrl}/collections): Browse products by collection.

## Agent resources

- [Storefront guide](${siteUrl}/llms.txt): When and how to use this storefront.
- [Sitemap](${siteUrl}/sitemap.xml): Complete index of storefront content.
`;

  return new Response(body, {
    headers: markdownHeaders({
      cacheControl: "public, max-age=86400, stale-while-revalidate=604800",
      pathname: "/",
      siteUrl: storeSettings.domain,
    }),
  });
}
