"use client";

import { InstantLink } from "@/components/headkit-ui/instant-link";
import {
  navPrefetchHrefs,
  type NavPrefetchNode,
} from "@/lib/nav-prefetch-hrefs";

/**
 * Viewport-resident copies of the nav's destinations.
 *
 * Next prefetches a link only while it intersects the viewport, and a closed
 * dropdown does not mount its links. These sit in the sticky header as a 1px
 * box so the scheduler can prefetch each collection before the menu opens.
 * `prefetch={true}` is the full per-URL prefetch, not the shared App Shell.
 */
export function NavPrefetchLinks({
  items,
}: {
  items: readonly NavPrefetchNode[];
}): React.JSX.Element | null {
  const hrefs = navPrefetchHrefs(items);
  if (hrefs.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 z-0 h-px w-px overflow-hidden"
    >
      {hrefs.map((href) => (
        <InstantLink
          key={href}
          href={href}
          prefetch
          tabIndex={-1}
          className="absolute left-0 top-0 block h-px w-px overflow-hidden"
        >
          {"\u200b"}
        </InstantLink>
      ))}
    </div>
  );
}
