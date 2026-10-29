import { walkCategoryPaths } from "@/app/shop/shop-slug";
import { collectionPathFromSegments } from "@/lib/canonical-path";
import { escapeMarkdown, summarizeText } from "@/lib/markdown";
import type { MirrorStore } from "@/lib/markdown/store-context";
import { decodeHtmlEntities } from "@/lib/utils";

/** How many collections `/llms.txt` lists. */
export const LLMS_COLLECTION_LIMIT = 50;

export interface LlmsCollection {
  name: string;
  /** Canonical `/collections/...` path, from the category's own ancestry. */
  path: string;
}

interface NamedCategoryNode {
  slug: string;
  name?: string | null | undefined;
  children?: readonly NamedCategoryNode[] | undefined;
}

function categoryNames(
  categories: readonly NamedCategoryNode[],
  into = new Map<string, string>(),
): Map<string, string> {
  for (const category of categories) {
    if (category.slug && !into.has(category.slug)) {
      into.set(
        category.slug,
        decodeHtmlEntities(category.name ?? "").trim() || category.slug,
      );
    }
    if (category.children?.length) categoryNames(category.children, into);
  }
  return into;
}

/**
 * The first {@link LLMS_COLLECTION_LIMIT} collections, shallowest first.
 *
 * Roots before their children, document order within a depth: a store with 80
 * root categories lists 50 roots, not one root's whole subtree. The category
 * list endpoint is `hide_empty=true`, so every node here has products — the
 * same reason `getNonEmptyCollectionSlugs` is built from it — and the walk
 * drops WooCommerce's default category exactly as the sitemap does.
 */
export function pickLlmsCollections(
  categories: readonly NamedCategoryNode[],
  limit = LLMS_COLLECTION_LIMIT,
): LlmsCollection[] {
  const names = categoryNames(categories);
  // Array.prototype.sort is stable: equal depths keep document order.
  return walkCategoryPaths(categories)
    .sort((a, b) => a.segments.length - b.segments.length)
    .slice(0, limit)
    .map((node) => ({
      name: names.get(node.slug) ?? node.slug,
      path: collectionPathFromSegments(node.segments),
    }));
}

/** The body of `/llms.txt`, per https://llmstxt.org: H1, summary, then H2 link lists. */
export function llmsTxtBody(
  store: Pick<
    MirrorStore,
    "origin" | "name" | "description" | "sitemapEnabled"
  >,
  collections: readonly LlmsCollection[],
): string {
  const { origin } = store;
  const summary =
    summarizeText(store.description) || `Product catalogue for ${store.name}.`;

  const lines = [
    `# ${escapeMarkdown(store.name)}`,
    "",
    `> ${escapeMarkdown(summary)}`,
    "",
    'The home page, `/search`, `/collections/{category}` and `/products/{slug}` are also available as Markdown: send `Accept: text/markdown`, or append `.md` to the URL (`/index.md` for the home page). Each Markdown response names the HTML page it describes in its `Link: rel="canonical"` header.',
    "",
    "## Browse",
    "",
    `- [All products](${origin}/shop): The product catalogue.`,
    `- [Search](${origin}/search): Search products by keyword.`,
    "",
  ];

  if (collections.length > 0) {
    lines.push("## Collections", "");
    for (const collection of collections) {
      lines.push(
        `- [${escapeMarkdown(collection.name)}](${origin}${collection.path})`,
      );
    }
    lines.push("");
  }

  lines.push(
    "## Discovery",
    "",
    ...(store.sitemapEnabled
      ? [
          `- [Sitemap](${origin}/sitemap.xml): Every product and collection URL.`,
        ]
      : []),
    `- [Robots](${origin}/robots.txt): Crawl policy.`,
    "",
  );

  return lines.join("\n");
}
