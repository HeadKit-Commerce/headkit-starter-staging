/**
 * Whether `/search?q=` should keep the prerendered catalog off screen.
 *
 * Bare `/search` prerenders page 1 of the catalog so the canonical document
 * stays static. A query reuses that HTML, then `CollectionProvider` fetches
 * the matches. Painting the catalog in between is the flash where results
 * appear and are then replaced by a different set.
 *
 * `serverMatched` is decided on the first client paint, while `appliedQuery`
 * is still the server prop. Stores that already rendered the query do not
 * hold. `settled` stays true after the first completed fetch so a later
 * sort or price change does not hide the grid the shopper is reading.
 */
export interface SearchHoldState {
  urlQuery: string;
  appliedQuery: string;
  isLoading: boolean;
  fetchSeen: boolean;
  settled: boolean;
  serverMatched: boolean | null;
}

export interface SearchHoldDecision {
  hold: boolean;
  fetchSeen: boolean;
  settled: boolean;
  serverMatched: boolean;
}

export function nextSearchHold(state: SearchHoldState): SearchHoldDecision {
  const urlQuery = state.urlQuery.trim();
  const applied = state.appliedQuery.trim();
  const serverMatched =
    state.serverMatched === null
      ? urlQuery.length > 0 && applied === urlQuery
      : state.serverMatched;

  if (!urlQuery || serverMatched) {
    return {
      hold: false,
      fetchSeen: state.fetchSeen,
      settled: state.settled,
      serverMatched,
    };
  }

  const fetchSeen = state.fetchSeen || state.isLoading;
  const settled = state.settled || (fetchSeen && !state.isLoading);
  return {
    hold: !settled,
    fetchSeen,
    settled,
    serverMatched,
  };
}
