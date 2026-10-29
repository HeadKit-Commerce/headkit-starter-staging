import { escapeMarkdown, markdownFrontmatter } from "@/lib/markdown";
import { markdownResponse, markdownUnavailable } from "@/lib/markdown/response";
import { readMirrorStore } from "@/lib/markdown/store-context";

const DESCRIPTION =
  "Search the product catalogue by name or keyword. Filter matches by category, price, and availability.";

/** Markdown twin of `/search`: a pointer to the page, because a query string is not a document. */
export async function GET(): Promise<Response> {
  const store = await readMirrorStore();
  if (!store) return markdownUnavailable();

  const canonicalUrl = `${store.origin}/search`;
  const body = [
    markdownFrontmatter({
      canonicalUrl,
      description: DESCRIPTION,
      title: "Search",
    }),
    "",
    "# Search",
    "",
    `> ${escapeMarkdown(DESCRIPTION)}`,
    "",
    `- [Open search](${canonicalUrl})`,
    `- [Storefront guide](${store.origin}/llms.txt)`,
    "",
  ].join("\n");

  return markdownResponse({ body, canonicalUrl });
}
