"use client";

import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { searchTermFromQuery } from "./utils";

/**
 * Reports `?q=` to its parent whenever the URL's query changes, and renders
 * nothing. It is the ONLY place this module reads the search params, and it is
 * a leaf for a reason: `useSearchParams()` is a request-time read, so whatever
 * calls it is postponed out of the static shell. A null-rendering component
 * costs the shell nothing; the same hook above the product grid would cost the
 * route its prerendered page 1.
 */
function SearchQueryWatcher({
  onQuery,
}: {
  onQuery: (query: string) => void;
}): null {
  const params = useSearchParams();
  const query = searchTermFromQuery(undefined, params);
  useEffect(() => {
    onQuery(query);
  }, [query, onQuery]);
  return null;
}

/**
 * Remounts `/search`'s collection when a soft navigation changes `?q=`.
 *
 * `/search` has no dynamic segment and the server does not read `?q=` (the page
 * is one static document), so `?q=helmet` → `?q=gloves` from the search drawer
 * changes the URL while NOTHING React renders changes: the page's RSC payload is
 * identical, so the tree is not re-rendered at all (MEASURED in a production
 * build: an effect on this component ran once, on mount, across a
 * `router.push`). The `CollectionProvider`'s query correction runs on mount
 * only, so the grid kept the previous query's products, and the
 * `collectionInstanceKey` rule cannot see the change either, because no prop
 * carries the query. This is that rule's client half: a new query is a new
 * product set, so it gets a new instance, and the provider's own mount path
 * (query correction, `nextSearchHold`) runs again for it.
 *
 * The URL is read by `SearchQueryWatcher`, inside its own `<Suspense>` and as a
 * SIBLING of the children — never a wrapper around them — so the static shell
 * and the prerendered page 1 are untouched. The provider's own
 * `history.replaceState` writes (sort, page, filters) leave `q` unchanged, so
 * they never trigger a remount.
 */
export function SearchQueryRemount({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [generation, setGeneration] = useState(0);
  const seenQueryRef = useRef<string | null>(null);

  // Stable identity, so the watcher's effect fires on a changed query only.
  const [onQuery] = useState(() => (query: string): void => {
    if (seenQueryRef.current === null) {
      // First report: the provider's mount correction already applies this one.
      seenQueryRef.current = query;
      return;
    }
    if (query === seenQueryRef.current) return;
    seenQueryRef.current = query;
    setGeneration((current) => current + 1);
  });

  return (
    <>
      <Suspense fallback={null}>
        <SearchQueryWatcher onQuery={onQuery} />
      </Suspense>
      <Fragment key={generation}>{children}</Fragment>
    </>
  );
}
