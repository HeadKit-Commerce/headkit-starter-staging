import { notFound } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * navigation-wrapper cache-tag/life realignment guard (09.5-03, CACHE-03).
 *
 * These assertions lock the 09.5-01 contract onto the shared-chrome reads:
 *  - `fetchMenu(location)` tags BY LOCATION (`headkit:menu:{location}`), so a
 *    `revalidateTag('headkit:menu:PRIMARY')` hits only the primary menu entry —
 *    NOT one blanket tag across every menu (the old `headkit:navigation`).
 *  - the FOOTER data entry (`getFooterMenus`) carries `headkit:footer` plus each
 *    footer location tag on the fn that actually returns the footer sections
 *    (nested tags don't bubble DOWN, so the tag must sit on the data-producing
 *    entry, not a dead wrapper).
 *  - `NavigationWrapper` subscribes to exactly the menus it composes
 *    (primary + secondary + pre-header), never a single blanket tag.
 *  - every chrome read uses `cacheLife('days')` (finite D4 backstop, was `max`).
 *  - no `headkit:navigation` / `footer-menu` literal drives invalidation anymore.
 *  - every menu read ALSO carries `headkit:collections`, because the
 *    `/collections/...` hrefs are re-derived from the category tree rather than
 *    taken from the CMS (see `lib/menu-canonical-href.ts`), so a category
 *    re-parent changes a menu entry's output with no menu edit.
 *
 * Failure handling (the "menu read failure" blocks): a failed menu read retries
 * ONCE, then degrades to an empty result under the short `minutes` life with one
 * log line, and never throws out of the cache scope. These are source-level
 * claims — a `cacheLife` spy cannot show that Next serves the degraded entry
 * stale and refreshes it, nor that a build survives; those are measured in the
 * Docker stack.
 *
 * `next/cache` is mocked so `cacheTag` / `cacheLife` calls are captured; the SDK
 * + UI components are stubbed so the module imports cleanly in a node env.
 */

// `vi.hoisted` because the `@/lib/sdk` factory below reads it: the factory runs
// before module-scope consts exist.
const { getCategories } = vi.hoisted(() => ({
  getCategories: vi.fn<() => Promise<unknown[]>>(),
}));

const cacheTag = vi.fn<(...tags: string[]) => void>();
const cacheLife = vi.fn<(profile: string) => void>();
const menuGet = vi.fn<(location: string) => Promise<unknown[]>>();
const menuGetMenu = vi.fn<
  (location: string) => Promise<{
    name: string;
    description?: string | null;
    items: unknown[];
  }>
>();
const menuGetMenus =
  vi.fn<
    (
      locations: string[],
    ) => Promise<
      Array<{ name: string; description?: string | null; items: unknown[] }>
    >
  >();

vi.mock("next/cache", () => ({
  cacheTag: (...tags: string[]): void => cacheTag(...tags),
  cacheLife: (profile: string): void => cacheLife(profile),
}));

// `headkit` and `headkitRetry` are two clients over the SAME stubs, so a test
// can tell WHICH one a read went through without a second set of fixtures:
// `retryRead` is called (with the method name) by the retry client only.
const { retryRead } = vi.hoisted(() => ({
  retryRead: vi.fn<(method: string) => void>(),
}));

vi.mock("@/lib/sdk", () => {
  const client = (onRead: (method: string) => void) => ({
    menu: {
      get: (location: string): Promise<unknown[]> => {
        onRead("menu.get");
        return menuGet(location);
      },
      getMenu: (
        location: string,
      ): Promise<{
        name: string;
        description?: string | null;
        items: unknown[];
      }> => {
        onRead("menu.getMenu");
        return menuGetMenu(location);
      },
      getMenus: (
        locations: string[],
      ): Promise<
        Array<{
          name: string;
          description?: string | null;
          items: unknown[];
        }>
      > => {
        onRead("menu.getMenus");
        return menuGetMenus(locations);
      },
    },
    collections: {
      getCategories: (): Promise<unknown[]> => getCategories(),
    },
  });
  return {
    headkit: client(() => undefined),
    headkitRetry: client((method) => retryRead(method)),
  };
});

vi.mock("@/components/headkit-ui/navigation-bar", () => ({
  NavigationBar: (): null => null,
}));
vi.mock("@/components/headkit-ui/header-actions", () => ({
  MobileHeaderActions: (): null => null,
}));
vi.mock("@/components/icon/logo", () => ({ Logo: (): null => null }));
// Merged from staging: nav now composes the per-store logo via @/lib/branding
// (ENG-572). branding.ts is `server-only`, so stub it here — this test guards
// menu cache-tags, not branding.
vi.mock("@/lib/branding", () => ({
  getBranding: vi.fn(async () => ({
    branding: { hideEmptyCollections: true },
    storeSettings: { name: null },
  })),
  getBrandingAssets: vi.fn(async () => ({ logoUrl: null })),
}));

import { logger } from "@/lib/logger";
import {
  fetchMenu,
  getFooterMenu,
  getFooterMenus,
  NavigationWrapper,
} from "./navigation-wrapper";

const logError = vi.spyOn(logger, "error").mockImplementation(() => undefined);

/**
 * The lives THIS module chose. `collectionPathIndex` is a nested cache entry
 * with its own `cacheLife("days")`, which the same spy also records; it is not a
 * decision these reads make, so it is filtered out.
 */
function chromeLives(): string[] {
  return cacheLife.mock.calls.flat().filter((life) => life !== "days");
}

function allTags(): string[] {
  return cacheTag.mock.calls.flat();
}

beforeEach(() => {
  retryRead.mockClear();
  logError.mockClear();
  getCategories.mockReset();
  getCategories.mockResolvedValue([]);
  cacheTag.mockClear();
  cacheLife.mockClear();
  menuGet.mockReset();
  menuGet.mockResolvedValue([]);
  menuGetMenu.mockReset();
  menuGetMenu.mockResolvedValue({ name: "", description: null, items: [] });
  menuGetMenus.mockReset();
  menuGetMenus.mockResolvedValue([
    { name: "", description: null, items: [] },
    { name: "", description: null, items: [] },
    { name: "", description: null, items: [] },
    { name: "", description: null, items: [] },
    { name: "", description: null, items: [] },
  ]);
});

describe("fetchMenu — tagged by location, hours backstop", () => {
  it("tags the PRIMARY menu with headkit:menu:PRIMARY at cacheLife('hours')", async () => {
    await fetchMenu("PRIMARY");
    expect(cacheTag).toHaveBeenCalledWith(
      "headkit:menu:PRIMARY",
      "headkit:collections",
    );
    expect(cacheLife).toHaveBeenCalledWith("hours");
  });

  it("tags the SECONDARY menu with headkit:menu:SECONDARY", async () => {
    await fetchMenu("SECONDARY");
    expect(cacheTag).toHaveBeenCalledWith(
      "headkit:menu:SECONDARY",
      "headkit:collections",
    );
  });

  it("tags the PRE_HEADER menu with headkit:menu:PRE_HEADER", async () => {
    await fetchMenu("PRE_HEADER");
    expect(cacheTag).toHaveBeenCalledWith(
      "headkit:menu:PRE_HEADER",
      "headkit:collections",
    );
  });
});

describe("getFooterMenus — TAG.footer + all footer locations", () => {
  it("tags footer + FOOTER/FOOTER_2/FOOTER_3/FOOTER_4/FOOTER_POLICY at cacheLife('hours')", async () => {
    await getFooterMenus();
    expect(cacheTag).toHaveBeenCalledWith(
      "headkit:footer",
      "headkit:menu:FOOTER",
      "headkit:menu:FOOTER_2",
      "headkit:menu:FOOTER_3",
      "headkit:menu:FOOTER_4",
      "headkit:menu:FOOTER_POLICY",
      "headkit:branding",
      "headkit:collections",
    );
    expect(cacheLife).toHaveBeenCalledWith("hours");
  });

  it("fetches all five footer locations and returns stable slots", async () => {
    menuGetMenus.mockResolvedValueOnce([
      {
        name: "Shop",
        description: null,
        items: [{ id: "1", label: "Shop", uri: "/shop", children: [] }],
      },
      { name: "Company", description: null, items: [] },
      { name: "Support", description: null, items: [] },
      { name: "Extras", description: null, items: [] },
      {
        name: "Paralel Furniture Pty Ltd",
        description: null,
        items: [{ id: "2", label: "Privacy", uri: "/privacy", children: [] }],
      },
    ]);

    await expect(getFooterMenus()).resolves.toEqual([
      {
        location: "FOOTER",
        name: "Shop",
        items: [{ id: "1", label: "Shop", uri: "/shop" }],
      },
      { location: "FOOTER_2", name: "Company", items: [] },
      { location: "FOOTER_3", name: "Support", items: [] },
      { location: "FOOTER_4", name: "Extras", items: [] },
      {
        location: "FOOTER_POLICY",
        name: "Paralel Furniture Pty Ltd",
        items: [{ id: "2", label: "Privacy", uri: "/privacy" }],
      },
    ]);
    expect(menuGetMenus).toHaveBeenCalledWith([
      "FOOTER",
      "FOOTER_2",
      "FOOTER_3",
      "FOOTER_4",
      "FOOTER_POLICY",
    ]);
    expect(menuGet).not.toHaveBeenCalled();
  });
});

describe("getFooterMenu — legacy FOOTER-only helper", () => {
  it("tags the footer data entry with headkit:footer + menu:FOOTER at cacheLife('hours')", async () => {
    await getFooterMenu();
    expect(cacheTag).toHaveBeenCalledWith(
      "headkit:footer",
      "headkit:menu:FOOTER",
      "headkit:collections",
    );
    expect(cacheLife).toHaveBeenCalledWith("hours");
  });
});

describe("NavigationWrapper — subscribes to the menus it composes", () => {
  it("tags primary + secondary + pre-header + branding + collections and uses cacheLife('hours')", async () => {
    await NavigationWrapper();
    expect(cacheTag).toHaveBeenCalledWith(
      "headkit:menu:PRIMARY",
      "headkit:menu:SECONDARY",
      "headkit:menu:PRE_HEADER",
      "headkit:branding",
      "headkit:collections",
    );
    expect(cacheLife).toHaveBeenCalledWith("hours");
  });

  it("fetches PRIMARY + SECONDARY + PRE_HEADER in one getMenus batch", async () => {
    await NavigationWrapper();
    expect(menuGetMenus).toHaveBeenCalledWith([
      "PRIMARY",
      "SECONDARY",
      "PRE_HEADER",
    ]);
    expect(menuGet).not.toHaveBeenCalled();
    expect(menuGetMenu).not.toHaveBeenCalled();
  });
});

describe("no legacy tag literal drives invalidation", () => {
  it("never passes headkit:navigation or footer-menu to cacheTag", async () => {
    await NavigationWrapper();
    await getFooterMenus();
    const tags = allTags();
    expect(tags).not.toContain("headkit:navigation");
    expect(tags).not.toContain("footer-menu");
  });

  it("never pins a chrome read at cacheLife('max')", async () => {
    await NavigationWrapper();
    await getFooterMenus();
    await fetchMenu("PRIMARY");
    expect(cacheLife).not.toHaveBeenCalledWith("max");
  });
});

/**
 * The WIRING half of the CMS-menu href rewrite. The rule itself is
 * `lib/menu-canonical-href.test.ts`; this drives the real
 * `NavigationWrapper` / `getFooterMenus` / `fetchMenu` chain, because a rule
 * that is never called is green while every menu link still 308s.
 *
 * It does NOT prove the href reaches the served HTML, that the redirect hop is
 * gone, or that `collectionPathIndex` reads the same tree the sitemap walks —
 * the first two are HTTP reads against a running store, the third is
 * `collectionPathIndex`'s own use of `walkCategoryPaths`.
 */
describe("category hrefs are re-derived from the tree, not taken from the CMS", () => {
  /** The shape the HeadKit WP theme emits: FLAT `/collections/{leaf}`, at depth. */
  const FLAT_MENU = [
    {
      id: "1",
      label: "Clothing",
      uri: "/",
      cssClasses: [],
      children: [
        {
          id: "2",
          label: "Column 1",
          uri: "/",
          cssClasses: ["hidden"],
          children: [
            {
              id: "3",
              label: "Apparel",
              uri: "/collections/apparel",
              cssClasses: ["hk-collection:apparel"],
              children: [
                {
                  id: "4",
                  label: "Socks",
                  uri: "/collections/socks",
                  cssClasses: ["hk-collection:socks"],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "5",
      label: "Hats",
      uri: "/collections/hats",
      cssClasses: ["hk-collection:hats"],
      children: [],
    },
  ];

  const TREE = [
    { slug: "apparel", children: [{ slug: "socks", children: [] }] },
    { slug: "hats", children: [] },
  ];

  type NavItemLike = { uri: string; children?: NavItemLike[] };

  function hrefs(items: readonly NavItemLike[]): string[] {
    return items.flatMap((item) => [item.uri, ...hrefs(item.children ?? [])]);
  }

  beforeEach(() => {
    getCategories.mockResolvedValue(TREE);
  });

  it("NavigationWrapper nests a flat CHILD href and leaves a ROOT one alone", async () => {
    menuGetMenus.mockResolvedValue([
      { name: "Main", description: null, items: FLAT_MENU },
      { name: "", description: null, items: [] },
      { name: "", description: null, items: [] },
    ]);
    // hideEmptyCollections is on in this file's branding stub, so the filter
    // runs over the rewritten items too — proving the two passes compose.
    const element = (await NavigationWrapper()) as {
      props: { primaryMenuItems: NavItemLike[] };
    };
    expect(hrefs(element.props.primaryMenuItems)).toEqual([
      "/",
      "/",
      "/collections/apparel",
      "/collections/apparel/socks",
      "/collections/hats",
    ]);
  });

  it("getFooterMenus rewrites footer category links too", async () => {
    menuGetMenus.mockResolvedValue([
      {
        name: "Shop",
        description: null,
        items: [
          {
            id: "4",
            label: "Socks",
            uri: "/collections/socks",
            cssClasses: ["hk-collection:socks"],
            children: [],
          },
        ],
      },
      { name: "", description: null, items: [] },
      { name: "", description: null, items: [] },
      { name: "", description: null, items: [] },
      { name: "", description: null, items: [] },
    ]);
    const sections = await getFooterMenus();
    expect(sections[0]?.items[0]?.uri).toBe("/collections/apparel/socks");
  });

  it("fetchMenu rewrites too — a single-location caller is not a back door", async () => {
    menuGet.mockResolvedValue(FLAT_MENU);
    expect(hrefs(await fetchMenu("PRIMARY"))).toContain(
      "/collections/apparel/socks",
    );
  });

  it("leaves every href untouched when the tree read comes back empty", async () => {
    getCategories.mockResolvedValue([]);
    menuGet.mockResolvedValue(FLAT_MENU);
    expect(hrefs(await fetchMenu("PRIMARY"))).toEqual([
      "/",
      "/",
      "/collections/apparel",
      "/collections/socks",
      "/collections/hats",
    ]);
  });
});

/**
 * A failed menu read is decided INSIDE the cache scope: retry once, then an
 * empty result stored under the short `minutes` life — never the healthy
 * lifetime (`max` on the aggressive profile), and never a throw, because a throw
 * leaving a `"use cache"` function fails the prerender of every page waiting on
 * the deduplicated fill whether or not a caller catches it.
 */
describe("menu read failure — retry once, then degrade briefly", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Drive a promise to completion across the retry's real-timer sleep. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return promise;
  }

  const FIVE_EMPTY = [
    "FOOTER",
    "FOOTER_2",
    "FOOTER_3",
    "FOOTER_4",
    "FOOTER_POLICY",
  ].map((location) => ({ location, name: "", items: [] }));

  it("retries ONCE after a failure and keeps the healthy life when the retry succeeds", async () => {
    menuGet.mockRejectedValueOnce(new Error("decoding: EOF"));
    menuGet.mockResolvedValueOnce([
      { id: "1", label: "Bikes", uri: "/bikes", children: [] },
    ]);
    const menu = await settle(fetchMenu("PRIMARY"));
    expect(menuGet).toHaveBeenCalledTimes(2);
    expect(menu.map((item) => item.label)).toEqual(["Bikes"]);
    expect(chromeLives()).toEqual(["hours"]);
    expect(logError).not.toHaveBeenCalled();
  });

  it("makes the retry through the retry client — no SDK backoff, and a request identity of its own", async () => {
    menuGetMenus.mockRejectedValueOnce(new Error("decoding: EOF"));
    await settle(getFooterMenus());
    expect(menuGetMenus).toHaveBeenCalledTimes(2);
    expect(retryRead.mock.calls).toEqual([["menu.getMenus"]]);
  });

  it("fetchMenu degrades to [] under the short life after two failures, with one log line", async () => {
    menuGet.mockRejectedValue(new Error("boom"));
    await expect(settle(fetchMenu("PRIMARY"))).resolves.toEqual([]);
    expect(menuGet).toHaveBeenCalledTimes(2);
    expect(chromeLives()).toEqual(["minutes"]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toBe("menu_read_failed");
  });

  it("getFooterMenu degrades to [] under the short life after two failures", async () => {
    menuGet.mockRejectedValue(new Error("boom"));
    await expect(settle(getFooterMenu())).resolves.toEqual([]);
    expect(chromeLives()).toEqual(["minutes"]);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("getFooterMenus degrades to its five empty slots under the short life, never throwing", async () => {
    menuGetMenus.mockRejectedValue(new Error("boom"));
    await expect(settle(getFooterMenus())).resolves.toEqual(FIVE_EMPTY);
    expect(menuGetMenus).toHaveBeenCalledTimes(2);
    expect(chromeLives()).toEqual(["minutes"]);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("NavigationWrapper renders a logo-only header under the short life", async () => {
    menuGetMenus.mockRejectedValue(new Error("boom"));
    const nav = (await settle(NavigationWrapper())) as {
      props: { primaryMenuItems: unknown[]; secondaryMenuItems: unknown[] };
    };
    expect(nav.props.primaryMenuItems).toEqual([]);
    expect(nav.props.secondaryMenuItems).toEqual([]);
    expect(chromeLives()).toEqual(["minutes"]);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("logs no error object and no stack — one bounded line", async () => {
    menuGetMenus.mockRejectedValue(new Error("boom"));
    await settle(getFooterMenus());
    const fields = logError.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual([
      "action",
      "attempts",
      "caller",
      "locations",
      "message",
      "name",
    ]);
    expect(JSON.stringify(fields)).not.toContain("stack");
  });

  it("never lets the degraded entry take a healthy life", async () => {
    menuGet.mockRejectedValue(new Error("boom"));
    menuGetMenus.mockRejectedValue(new Error("boom"));
    await settle(fetchMenu("PRIMARY"));
    await settle(getFooterMenu());
    await settle(getFooterMenus());
    await settle(NavigationWrapper());
    expect(chromeLives()).toEqual(["minutes", "minutes", "minutes", "minutes"]);
  });

  it("a Next-internal interruption propagates: not retried, not logged", async () => {
    menuGet.mockImplementation(() => {
      notFound();
    });
    await expect(fetchMenu("PRIMARY")).rejects.toThrow();
    expect(menuGet).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
    expect(chromeLives()).toEqual([]);
  });
});

describe("NavigationWrapper — last-resort guard for reads the cached scope does not own", () => {
  it("a category-tree failure renders a fallback header for that request, logged once and not cached", async () => {
    getCategories.mockRejectedValue(new Error("tree down"));
    const nav = (await NavigationWrapper()) as {
      props: { primaryMenuItems: unknown[] };
    };
    expect(nav.props.primaryMenuItems).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError.mock.calls[0]?.[0]).toBe("chrome_read_failed");
    expect(chromeLives()).toEqual([]);
  });
});
