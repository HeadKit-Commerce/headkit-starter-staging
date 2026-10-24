import { getBranding } from "@/lib/branding";
import { escapeMarkdown, markdownFrontmatter } from "@/lib/markdown";
import { markdownHeaders } from "@/lib/markdown/representation";
import { resolveSiteUrl } from "@/lib/site-url";

export async function GET(): Promise<Response> {
  const { storeSettings } = await getBranding();
  const siteUrl = resolveSiteUrl(storeSettings.domain);
  const canonicalUrl = siteUrl ? `${siteUrl}/search` : "/search";
  const description =
    "Search the product catalog by name or keyword. Filter matches by category, price, and availability.";

  const body = `${markdownFrontmatter({
    canonicalUrl,
    description,
    title: "Search",
  })}

# Search

> ${escapeMarkdown(description)}

- [Open search](${canonicalUrl})
- [Storefront guide](${siteUrl}/llms.txt)
`;

  return new Response(body, {
    headers: markdownHeaders({
      cacheControl: "public, max-age=86400, stale-while-revalidate=604800",
      pathname: "/search",
      siteUrl: storeSettings.domain,
    }),
  });
}
