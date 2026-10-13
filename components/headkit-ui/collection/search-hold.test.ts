import { describe, expect, it } from "vitest";
import { nextSearchHold, type SearchHoldState } from "./search-hold";

function hold(
  overrides: Partial<SearchHoldState>,
): ReturnType<typeof nextSearchHold> {
  return nextSearchHold({
    urlQuery: "helmet",
    appliedQuery: "",
    isLoading: false,
    fetchSeen: false,
    settled: false,
    serverMatched: null,
    ...overrides,
  });
}

describe("nextSearchHold", () => {
  it("hides the prerendered catalog until the query fetch finishes", () => {
    const first = hold({});
    expect(first.hold).toBe(true);
    expect(first.serverMatched).toBe(false);

    const loading = hold({
      appliedQuery: "helmet",
      isLoading: true,
      serverMatched: first.serverMatched,
      fetchSeen: first.fetchSeen,
      settled: first.settled,
    });
    expect(loading.hold).toBe(true);
    expect(loading.fetchSeen).toBe(true);

    const done = hold({
      appliedQuery: "helmet",
      isLoading: false,
      serverMatched: loading.serverMatched,
      fetchSeen: loading.fetchSeen,
      settled: loading.settled,
    });
    expect(done.hold).toBe(false);
    expect(done.settled).toBe(true);
  });

  it("keeps holding when the term is copied before the fetch starts", () => {
    // `serverMatched` was already decided on the first paint, when the
    // applied term was still the empty server prop.
    const copied = hold({
      appliedQuery: "helmet",
      isLoading: false,
      serverMatched: false,
    });
    expect(copied.hold).toBe(true);
    expect(copied.fetchSeen).toBe(false);
  });

  it("leaves a bare /search and an already-rendered query on screen", () => {
    expect(hold({ urlQuery: "" }).hold).toBe(false);
    const rendered = hold({ appliedQuery: "helmet" });
    expect(rendered.hold).toBe(false);
    expect(rendered.serverMatched).toBe(true);
  });

  it("does not hide results again once the query has been painted", () => {
    const refresh = hold({
      appliedQuery: "helmet",
      isLoading: true,
      fetchSeen: true,
      settled: true,
      serverMatched: false,
    });
    expect(refresh.hold).toBe(false);
  });
});
