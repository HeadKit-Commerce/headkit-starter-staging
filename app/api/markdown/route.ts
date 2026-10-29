import { escapeMarkdown, markdownFrontmatter } from "@/lib/markdown";
import { markdownResponse, markdownUnavailable } from "@/lib/markdown/response";
import { readMirrorStore } from "@/lib/markdown/store-context";

/**
 * Markdown twin of `/`. `proxy.ts` rewrites `Accept: text/markdown` and
 * `/index.md` here; the address of this route is not public (it sits under
 * `/api`, which `robots.txt` disallows). Mechanism: `lib/markdown/representation.ts`.
 */
export async function GET(): Promise<Response> {
  const store = await readMirrorStore();
  if (!store) return markdownUnavailable();

  const canonicalUrl = `${store.origin}/`;
  const links = [
    `- [All products](${store.origin}/shop): Browse the complete catalogue.`,
    `- [Search](${store.origin}/search): Search products by keyword.`,
    `- [Storefront guide](${store.origin}/llms.txt): When and how to use this storefront.`,
    ...(store.sitemapEnabled
      ? [
          `- [Sitemap](${store.origin}/sitemap.xml): Complete index of storefront content.`,
        ]
      : []),
  ];

  const body = [
    markdownFrontmatter({
      canonicalUrl,
      description: store.description || undefined,
      title: store.name,
    }),
    "",
    `# ${escapeMarkdown(store.name)}`,
    "",
    ...(store.description ? [escapeMarkdown(store.description), ""] : []),
    "## Browse",
    "",
    ...links,
    "",
  ].join("\n");

  return markdownResponse({ body, canonicalUrl });
}
