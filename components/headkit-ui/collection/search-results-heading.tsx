"use client";

import { Breadcrumb } from "@/components/ui/breadcrumb";
import { showCollectionBreadcrumbs } from "@/overrides/collection-slots";
import { useCollection } from "./collection-context";

interface SearchResultsHeadingProps {
  title: string;
  description: string;
  /** Same shape and meaning as `CollectionHeader`'s `breadcrumbs`. */
  breadcrumbs?: { name: string; uri: string; current: boolean }[];
}

/**
 * `/search`'s title block: `Search results for "q"` and `N products found for
 * "q"`, or the bare page's own title and description when there is no query.
 *
 * It reads the provider rather than the URL, so the count is always the count
 * of the grid underneath it — the query and the total come from the same
 * instance, and `SearchQueryRemount` replaces both together. It renders inside
 * the provider, which is why it is not `CollectionHeader` (a server component
 * outside it); the markup is that component's plain title block, breadcrumbs
 * included, unchanged.
 */
export function SearchResultsHeading({
  title,
  description,
  breadcrumbs,
}: SearchResultsHeadingProps): React.JSX.Element {
  const { search, totalProducts } = useCollection();
  const query = search.trim();
  const hasBreadcrumbs =
    showCollectionBreadcrumbs() &&
    Boolean(breadcrumbs && breadcrumbs.length > 0);
  return (
    <div className="overflow-x-clip">
      {hasBreadcrumbs ? (
        <div className="px-5 pt-5 md:px-10">
          <Breadcrumb items={breadcrumbs!} />
        </div>
      ) : null}
      <div className={`mb-5 px-5 md:px-10 ${hasBreadcrumbs ? "pt-2" : "pt-5"}`}>
        <h1 className={`mb-[10px] ${hasBreadcrumbs ? "mt-2" : "mt-5"}`}>
          {query ? `Search results for "${query}"` : title}
        </h1>
        <div className="max-w-2xl text-base text-gray-800">
          {query
            ? `${totalProducts} product${totalProducts === 1 ? "" : "s"} found for "${query}"`
            : description}
        </div>
      </div>
    </div>
  );
}
