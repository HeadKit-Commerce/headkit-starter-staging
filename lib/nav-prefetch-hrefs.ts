import { isAppNavigationHref } from "@/lib/convert-uri";

/** A menu node. Only `uri` and `children` are read. */
export type NavPrefetchNode = {
  uri?: string | null;
  children?: readonly NavPrefetchNode[] | null;
};

function normalizeHref(uri: string): string {
  const trimmed = uri.trim();
  return trimmed.length > 1 ? trimmed.replace(/\/$/, "") : trimmed;
}

/**
 * Every in-app destination in a nav tree, once.
 *
 * Dropdown children are not mounted until the menu opens, so they never enter
 * Next's prefetch queue. The header renders these hrefs in the viewport so the
 * scheduler can prefetch them while the shopper is still on the current page.
 * Home is omitted: that is the page they are already on.
 */
export function navPrefetchHrefs(
  nodes: readonly NavPrefetchNode[],
): string[] {
  const seen = new Set<string>();
  const hrefs: string[] = [];

  const walk = (items: readonly NavPrefetchNode[]): void => {
    for (const item of items) {
      const href = normalizeHref(item.uri ?? "");
      if (
        href.length > 0 &&
        href !== "/" &&
        isAppNavigationHref(href) &&
        !seen.has(href)
      ) {
        seen.add(href);
        hrefs.push(href);
      }
      if (item.children != null && item.children.length > 0) {
        walk(item.children);
      }
    }
  };

  walk(nodes);
  return hrefs;
}
