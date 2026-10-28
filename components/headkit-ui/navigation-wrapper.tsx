import type { ReactElement } from "react";
import type { ClientSDK, MenuLocation } from "@headkit/sdk";
import { cacheLife, cacheTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { convertToRelativePath } from "@/lib/convert-uri";
import { TAG } from "@/lib/cache-tags";
import { headkit, headkitRetry } from "@/lib/sdk";
import { errorFields, logger } from "@/lib/logger";
import {
  NavigationBar,
  type NavMenuItem,
} from "@/components/headkit-ui/navigation-bar";
import { MobileHeaderActions } from "@/components/headkit-ui/header-actions";
import { BrandLogo } from "@/components/icon/brand-logo";
import { getBranding, getBrandingAssets } from "@/lib/branding";
import { BrandingUnavailableError } from "@/lib/branding-cache-policy";
import { resolveStoreName } from "@/lib/make-metadata";
import {
  filterMenuItemsByNonEmptyCollections,
  getNonEmptyCollectionSlugs,
} from "@/lib/hide-empty-collections";
import { collectionPathIndex } from "@/lib/collection-path";
import {
  applyCanonicalCollectionHrefs,
  type CollectionPathLookup,
} from "@/lib/menu-canonical-href";
import { getStoreTheme } from "@/lib/store-theme";

/** Permissive shape for API menu nodes (GraphQL fragment stops at 3 levels, so innermost lacks children). */
type MenuItemLike = {
  id: string;
  label: string;
  uri: string;
  description?: string | null;
  cssClasses?: string[] | null;
  children?: MenuItemLike[];
};

type NavigationMenuLike = {
  name: string;
  description?: string | null;
  items: MenuItemLike[];
};

/** CSS class on a Custom Link whose label is the left-side preheader message. */
const PREHEADER_TITLE_CLASS = "preheader-title";

/** WP menu names that are location labels, not customer-facing copy. */
const GENERIC_PREHEADER_NAMES = new Set([
  "pre header",
  "pre-header",
  "preheader",
  "pre_header",
]);

function hasCssClass(item: MenuItemLike, className: string): boolean {
  return (item.cssClasses ?? []).includes(className);
}

/**
 * Resolve left-side preheader copy from WordPress in priority order:
 * 1. Custom Link with CSS class `preheader-title` (preferred — editable as a menu item)
 * 2. Menu term description (rarely set in Appearance → Menus)
 * 3. Menu name, unless it looks like a generic location label ("Pre Header")
 */
function resolvePreheaderTitle(menu: NavigationMenuLike): string | undefined {
  const titled = menu.items.find((item) =>
    hasCssClass(item, PREHEADER_TITLE_CLASS),
  );
  const fromItem = titled?.label?.trim();
  if (fromItem) {
    return fromItem;
  }
  const fromDescription = menu.description?.trim();
  if (fromDescription) {
    return fromDescription;
  }
  const fromName = menu.name?.trim();
  if (fromName && !GENERIC_PREHEADER_NAMES.has(fromName.toLowerCase())) {
    return fromName;
  }
  return undefined;
}

function resolvePreheaderLinks(
  items: NavMenuItem[],
): { label: string; uri: string }[] {
  return items
    .filter((item) => !(item.cssClasses ?? []).includes(PREHEADER_TITLE_CLASS))
    .map((item) => ({ label: item.label, uri: item.uri }));
}

/** Recursively normalize API menu nodes to NavMenuItem (ensures children is always an array). */
function normalizeMenuItems(items: MenuItemLike[]): NavMenuItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.label,
    // Defensive host-strip (belt-and-suspenders for the WP theme fix): even if a
    // menu item arrives as an absolute WP permalink, render it as a storefront-
    // relative path so <Link> never bounces the user to the WP backend.
    uri: convertToRelativePath(item.uri),
    description: item.description ?? null,
    cssClasses: item.cssClasses ?? [],
    children: Array.isArray(item.children)
      ? normalizeMenuItems(item.children)
      : [],
  }));
}

/**
 * Normalize, then re-derive every `/collections/...` href from the category
 * tree.
 *
 * The WordPress theme hands back the FLAT `/collections/{leaf}` for every
 * product-category menu item (it overwrites the term permalink — see
 * `lib/menu-canonical-href.ts`), and the flat shape 308s onto the canonical
 * nested one, so an unrewritten menu spends a redirect on most of its links.
 * Every menu this module returns goes through here; nothing else in the app
 * reads these hrefs from another path.
 */
function normalizeMenu(
  items: MenuItemLike[],
  canonicalPath: CollectionPathLookup,
): NavMenuItem[] {
  return applyCanonicalCollectionHrefs(
    normalizeMenuItems(items),
    canonicalPath,
  );
}

/**
 * The slug → canonical-path lookup the rewrite above needs.
 *
 * `collectionPathIndex` is its own `"use cache"` entry tagged `TAG.collections`,
 * so it costs one catalogue read per build/purge cycle however many menus ask
 * for it. Awaiting it narrows no caller under either cache profile: Next
 * propagates a nested entry's life outward and takes the MIN, and the index is
 * `("days", "max")` against these chrome reads' `("hours", "max")` — longer on
 * conservative, equal on aggressive. A transport failure deliberately PROPAGATES
 * rather than degrading to flat hrefs — the degraded render would be WRITTEN to
 * the enclosing cache entry and pinned until the next purge, and the same read
 * already fails a build from `app/page.tsx`. Every caller below therefore also
 * carries `TAG.collections`.
 */
async function collectionPathLookup(): Promise<CollectionPathLookup> {
  const index = await collectionPathIndex();
  return (slug: string): string | undefined => index.get(slug);
}

/**
 * Plain (uncached) SDK menu load + normalize. Kept separate from the cached
 * entries below so each cached fn owns its OWN `cacheTag` — the by-location menu
 * tag vs the isolated footer tag — without a nested `use cache` boundary (nested
 * tags don't bubble, so the tag must sit on the data-producing cache entry).
 *
 * It THROWS on a failed read. It used to swallow into `[]`, which the calling
 * `"use cache"` entry then stored under the healthy lifetime — an empty menu
 * pinned for the whole life of the entry. Every call site wraps it in
 * {@link readMenusWithRetry}, which retries and then degrades under a short
 * lifetime instead.
 */
async function loadMenu(
  location: MenuLocation,
  canonicalPath: CollectionPathLookup,
  client: ClientSDK,
): Promise<NavMenuItem[]> {
  const tree = await client.menu.get(location);
  return normalizeMenu(tree, canonicalPath);
}

const HEADER_LOCATIONS = [
  "PRIMARY",
  "SECONDARY",
  "PRE_HEADER",
] as const satisfies readonly MenuLocation[];

const FOOTER_LOCATIONS = [
  "FOOTER",
  "FOOTER_2",
  "FOOTER_3",
  "FOOTER_4",
  "FOOTER_POLICY",
] as const satisfies readonly MenuLocation[];

const EMPTY_MENU: NavigationMenuLike = {
  name: "",
  description: null,
  items: [],
};

/**
 * One GraphQL round-trip for the given locations (commerce fetches WP in
 * parallel). Result order matches `locations`. THROWS on a failed read — see
 * {@link loadMenu}; a location the response simply lacks is an empty menu.
 */
async function loadMenusBatch(
  locations: readonly MenuLocation[],
  client: ClientSDK,
): Promise<NavigationMenuLike[]> {
  const menus = await client.menu.getMenus([...locations]);
  return locations.map((_, i) => {
    const menu = menus[i];
    if (!menu) {
      return { ...EMPTY_MENU };
    }
    return {
      name: menu.name,
      description: menu.description ?? null,
      items: menu.items,
    };
  });
}

/**
 * Pause before the ONE retry {@link readMenusWithRetry} gives a failed menu
 * read.
 */
const MENU_READ_RETRY_DELAY_MS = 500;

/**
 * Cache life for a DEGRADED (empty) menu result.
 *
 * `minutes` is `{ stale: 300, revalidate: 60, expire: 3600 }`, so the degraded
 * entry refreshes in the background a minute later and the next request after
 * that paints real menus. The `expire` deliberately stays at an hour rather
 * than "a few minutes": Next omits any entry whose `expire` is UNDER 300 s
 * (`MIN_PRERENDERABLE_EXPIRE`, `next/dist/server/use-cache/constants.js`) from
 * a static prerender and replaces it with a hanging promise. These reads are
 * awaited by the ROOT LAYOUT, which renders no `<Suspense>`, so a shorter
 * `expire` would turn a dynamic hole loose above every boundary and cost every
 * route its static document. Never `seconds`; never a hand-written sub-300 s
 * `expire`.
 *
 * Plain `cacheLife`, not `cacheLifeForProfile`: a degraded result must be
 * short-lived under BOTH cache profiles, so there is no aggressive value to
 * name.
 */
const DEGRADED_MENU_CACHE_LIFE = "minutes";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type MenuReadResult<T> = { ok: true; value: T } | { ok: false };

/**
 * Run a menu read INSIDE a `"use cache"` scope, retrying once and reporting the
 * outcome instead of throwing.
 *
 * WHY A THROW MAY NEVER LEAVE A CACHE SCOPE. Under Next 16 Cache Components an
 * error thrown inside a `"use cache"` function during a build prerender fails
 * THAT PAGE's prerender even when the caller outside the boundary catches it,
 * and the cache fill is deduplicated across concurrent page prerenders — so one
 * failed menu read fails every page waiting on the fill, and its error dump
 * (a GraphQL error per page) can overrun the build-log limit. A catch in the
 * caller changes nothing. So the failure is decided HERE, on the inside: retry
 * once, then degrade to an empty result stored under
 * {@link DEGRADED_MENU_CACHE_LIFE}. The old behaviour — swallow into `[]` and
 * let the entry keep its healthy lifetime — pinned an empty header or footer
 * for as long as the entry lived (`max` on the `aggressive` profile).
 *
 * `cacheLife` is chosen EXACTLY ONCE per invocation, by the caller, after this
 * returns: Next's reference asks for one call per invocation ("Conditional
 * cache lifetimes"), and its min-per-field behaviour is an implementation
 * detail not to build on.
 *
 * The retry goes through `headkitRetry`, for two reasons. The SDK transport
 * already retries 429s, 5xx statuses and connection errors with backoff
 * (~30 s), so repeating that would double the time one shared cache fill can
 * hold every waiting page; this retry exists for the failure shapes the transport
 * does not classify as transient (a GraphQL error body — an undecodable or
 * timed-out subgraph response), and one more plain attempt is all it needs. And
 * that same shape is an HTTP 200, which Next's fetch cache stores and replays to
 * an identical request, so a retry that was the SAME request would be answered
 * from the failure it is retrying and never reach the gateway (see
 * `retryGatewayUrl` in `lib/sdk.ts`).
 *
 * `unstable_rethrow(error)` is the FIRST statement of the catch, so a
 * Next-internal interruption (a prefetch abort, `notFound()`, a redirect) keeps
 * propagating and is never retried or counted as a menu failure.
 *
 * ONE log line, no error object, no stack: a build renders thousands of pages
 * against one log budget, and a per-page error dump is what overruns it.
 */
async function readMenusWithRetry<T>(
  read: (client: ClientSDK) => Promise<T>,
  caller: string,
  locations: readonly MenuLocation[],
): Promise<MenuReadResult<T>> {
  const attempts = 2;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return {
        ok: true,
        value: await read(attempt === 0 ? headkit : headkitRetry),
      };
    } catch (error) {
      unstable_rethrow(error);
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(MENU_READ_RETRY_DELAY_MS);
      }
    }
  }
  logger.error("menu_read_failed", {
    caller,
    locations: locations.join(","),
    attempts,
    action: "degrade-empty-short-life",
    ...errorFields(lastError),
  });
  return { ok: false };
}

/**
 * Cached PRIMARY/SECONDARY/PRE_HEADER menu read, tagged BY LOCATION
 * (`TAG.menu(location)` → `headkit:menu:{location}`) so a menu edit for one
 * location invalidates only that location's entry — not one blanket tag across
 * every menu (09.5-03, CACHE-03).
 *
 * Finite `hours` backstop: Shopify has no menu webhooks, so Storefront menu
 * edits self-heal within ~1 hour. WordPress still invalidates instantly via
 * `wp_update_nav_menu` → `/api/revalidate`.
 *
 * Prefer {@link NavigationWrapper}'s batched `getMenus` for chrome that needs
 * several locations; keep this for single-location callers.
 *
 * A FAILED read does not throw out of this scope — see
 * {@link readMenusWithRetry}. It retries once, then returns an empty menu under
 * {@link DEGRADED_MENU_CACHE_LIFE} so the next minute's request repopulates it.
 */
export async function fetchMenu(
  location: MenuLocation,
): Promise<NavMenuItem[]> {
  "use cache: remote";
  // `TAG.collections` because the hrefs are re-derived from the category tree
  // (see `collectionPathLookup`): a category rename or re-parent changes this
  // entry's output even when the menu itself never moves.
  cacheTag(TAG.menu(location), TAG.collections);
  const canonicalPath = await collectionPathLookup();
  const read = await readMenusWithRetry(
    (client) => loadMenu(location, canonicalPath, client),
    "fetchMenu",
    [location],
  );
  if (!read.ok) {
    cacheLife(DEGRADED_MENU_CACHE_LIFE);
    return [];
  }
  cacheLifeForProfile("hours", "max");
  return read.value;
}

/**
 * CMS footer menus for the root layout Footer.
 *
 * Providers register up to five locations that the Footer UI consumes in order:
 *   [0] FOOTER        → column title = menu name; links = items
 *   [1] FOOTER_2      → column title = menu name; links = items
 *   [2] FOOTER_3      → optional third column (omitted in UI when empty)
 *   [3] FOOTER_4      → optional fourth column (omitted in UI when empty)
 *   [4] FOOTER_POLICY → copyright line = menu name; links = policy items
 *
 * Fetched via a single `menus(locations:)` GraphQL query (one storefront RTT;
 * commerce hits provider locations in parallel). Always returns five sections so
 * Footer's policy/copyright slot stays at `menus` location FOOTER_POLICY when
 * FOOTER_3 / FOOTER_4 are unassigned.
 *
 * Tags: `TAG.footer` plus each location's `TAG.menu(...)` so any of the
 * menu edits (or the legacy footer tag) invalidate this entry.
 *
 * A FAILED read is handled INSIDE this scope by {@link readMenusWithRetry} —
 * retry once, then five empty sections under {@link DEGRADED_MENU_CACHE_LIFE}.
 * It must never throw out: see that function's header for why a catch in the
 * caller does not help. `app/layout.tsx`'s `safeGetFooterMenus` stays as an
 * OUTER guard for the reads this one does not own (the category tree,
 * branding), not as the normal failure path.
 */
export async function getFooterMenus(): Promise<
  {
    location: string;
    name: string;
    items: { id: string; label: string; uri: string }[];
  }[]
> {
  "use cache: remote";
  cacheTag(
    TAG.footer,
    TAG.menu("FOOTER"),
    TAG.menu("FOOTER_2"),
    TAG.menu("FOOTER_3"),
    TAG.menu("FOOTER_4"),
    TAG.menu("FOOTER_POLICY"),
    TAG.branding,
    TAG.collections,
  );

  const [read, canonicalPath] = await Promise.all([
    readMenusWithRetry(
      (client) => loadMenusBatch(FOOTER_LOCATIONS, client),
      "getFooterMenus",
      FOOTER_LOCATIONS,
    ),
    collectionPathLookup(),
  ]);
  if (!read.ok) {
    // Empty SECTIONS, not `[]`: the five slots are this function's contract and
    // `Footer` drops a section with no items. Under
    // `DEGRADED_MENU_CACHE_LIFE`, for about a minute.
    cacheLife(DEGRADED_MENU_CACHE_LIFE);
    return FOOTER_LOCATIONS.map((location) => ({
      location,
      name: "",
      items: [],
    }));
  }
  cacheLifeForProfile("hours", "max");

  const menus = read.value;
  const footer = menus[0] ?? EMPTY_MENU;
  const footer2 = menus[1] ?? EMPTY_MENU;
  const footer3 = menus[2] ?? EMPTY_MENU;
  const footer4 = menus[3] ?? EMPTY_MENU;
  const policy = menus[4] ?? EMPTY_MENU;

  const { branding } = await getBranding();
  const nonEmptySlugs = branding.hideEmptyCollections
    ? await getNonEmptyCollectionSlugs()
    : null;

  const toSection = (
    location: (typeof FOOTER_LOCATIONS)[number],
    menu: NavigationMenuLike,
  ): {
    location: string;
    name: string;
    items: { id: string; label: string; uri: string }[];
  } => {
    let items = normalizeMenu(menu.items, canonicalPath);
    if (nonEmptySlugs) {
      items = filterMenuItemsByNonEmptyCollections(items, nonEmptySlugs);
    }
    return {
      location,
      name: menu.name.trim(),
      items: items.map((item) => ({
        id: item.id,
        label: item.label,
        uri: item.uri,
      })),
    };
  };

  return [
    toSection("FOOTER", footer),
    toSection("FOOTER_2", footer2),
    toSection("FOOTER_3", footer3),
    toSection("FOOTER_4", footer4),
    toSection("FOOTER_POLICY", policy),
  ];
}

/**
 * @deprecated Prefer getFooterMenus() — kept for tests that assert FOOTER tags.
 * Returns only the primary FOOTER location root items.
 */
export async function getFooterMenu(): Promise<NavMenuItem[]> {
  "use cache: remote";
  // `TAG.collections` — same reason as `fetchMenu`.
  cacheTag(TAG.footer, TAG.menu("FOOTER"), TAG.collections);
  const canonicalPath = await collectionPathLookup();
  const read = await readMenusWithRetry(
    (client) => loadMenu("FOOTER", canonicalPath, client),
    "getFooterMenu",
    ["FOOTER"],
  );
  if (!read.ok) {
    cacheLife(DEGRADED_MENU_CACHE_LIFE);
    return [];
  }
  cacheLifeForProfile("hours", "max");
  return read.value;
}

/**
 * Uncached nav for the one request where dashboard branding could not be read.
 *
 * Kept outside {@link NavigationWrapper}'s `"use cache"` function. Caching
 * this render would store the Demo wordmark in place of an uploaded logo.
 */
export function fallbackNavigation(): ReactElement {
  const { layout } = getStoreTheme();
  return (
    <NavigationBar
      primaryMenuItems={[]}
      secondaryMenuItems={[]}
      navLayout={layout.navLayout}
      navStyle={layout.navStyle}
      logo={<BrandLogo logoUrl={null} siteName={resolveStoreName(null)} />}
      mobileActions={<MobileHeaderActions />}
    />
  );
}

/**
 * Cached PRIMARY/SECONDARY/PRE_HEADER chrome read — see {@link NavigationWrapper}
 * for the uncached caller that absorbs a failure this scope does not own.
 */
async function NavigationWrapperCached(): Promise<ReactElement> {
  "use cache: remote";
  // Subscribe to exactly what this wrapper composes: primary + secondary +
  // pre-header menus AND branding (the wrapper renders the logo from
  // getBrandingAssets / getBranding, and nested tags don't bubble — without
  // TAG.branding here a logo change never purges the nav). NEVER a route/page
  // tag on chrome (D2 / T-09.5-09).
  // cacheLife hours: Shopify has no menu webhooks (WP still tag-purges).
  cacheTag(
    TAG.menu("PRIMARY"),
    TAG.menu("SECONDARY"),
    TAG.menu("PRE_HEADER"),
    TAG.branding,
    TAG.collections,
  );

  // One menus(locations:) GraphQL RTT for PRIMARY + SECONDARY + PRE_HEADER
  // (commerce fetches WP in parallel). Branding stays parallel with that batch.
  const [read, canonicalPath, { logoUrl }, { storeSettings, branding }] =
    await Promise.all([
      readMenusWithRetry(
        (client) => loadMenusBatch(HEADER_LOCATIONS, client),
        "NavigationWrapper",
        HEADER_LOCATIONS,
      ),
      collectionPathLookup(),
      getBrandingAssets(),
      getBranding(),
    ]);

  const { layout } = getStoreTheme();

  // `cacheLife` is chosen ONCE per invocation — see {@link readMenusWithRetry}.
  // A failed read renders the logo-only header under the short life, so the nav
  // repopulates about a minute later instead of staying empty until the entry
  // expires.
  if (!read.ok) {
    cacheLife(DEGRADED_MENU_CACHE_LIFE);
    return (
      <NavigationBar
        primaryMenuItems={[]}
        secondaryMenuItems={[]}
        navLayout={layout.navLayout}
        navStyle={layout.navStyle}
        logo={
          <BrandLogo
            logoUrl={logoUrl}
            siteName={resolveStoreName(storeSettings.name)}
          />
        }
        mobileActions={<MobileHeaderActions />}
      />
    );
  }
  cacheLifeForProfile("hours", "max");
  const headerMenus = read.value;

  const nonEmptySlugs = branding.hideEmptyCollections
    ? await getNonEmptyCollectionSlugs()
    : null;

  let primaryItems = normalizeMenu(
    (headerMenus[0] ?? EMPTY_MENU).items,
    canonicalPath,
  );
  let secondaryItems = normalizeMenu(
    (headerMenus[1] ?? EMPTY_MENU).items,
    canonicalPath,
  );
  if (nonEmptySlugs) {
    primaryItems = filterMenuItemsByNonEmptyCollections(
      primaryItems,
      nonEmptySlugs,
    );
    secondaryItems = filterMenuItemsByNonEmptyCollections(
      secondaryItems,
      nonEmptySlugs,
    );
  }
  const preheaderMenu = headerMenus[2] ?? EMPTY_MENU;
  const preheaderItems = normalizeMenu(preheaderMenu.items, canonicalPath);
  const preheaderTitle = resolvePreheaderTitle(preheaderMenu);
  const preheaderLinks = resolvePreheaderLinks(preheaderItems);

  const showPreheader =
    (preheaderTitle !== undefined && preheaderTitle.length > 0) ||
    preheaderLinks.length > 0;

  return (
    <NavigationBar
      primaryMenuItems={primaryItems}
      secondaryMenuItems={secondaryItems}
      navLayout={layout.navLayout}
      navStyle={layout.navStyle}
      {...(showPreheader
        ? {
            preheader: {
              ...(preheaderTitle !== undefined
                ? { title: preheaderTitle }
                : {}),
              links: preheaderLinks,
            },
          }
        : {})}
      logo={
        <BrandLogo
          logoUrl={logoUrl}
          siteName={resolveStoreName(storeSettings.name)}
        />
      }
      mobileActions={<MobileHeaderActions />}
    />
  );
}

/**
 * Uncached LAST-RESORT guard around {@link NavigationWrapperCached}.
 *
 * It is no longer the normal failure path for a menu read: that is handled
 * inside the cache scope by {@link readMenusWithRetry}, because a throw
 * crossing a `"use cache"` boundary fails the prerender of every page waiting
 * on the deduplicated fill, caught or not. What reaches here is a failure in
 * one of the OTHER reads the cached function awaits and does not own: the
 * category tree (`collectionPathLookup`, which propagates on purpose) or
 * branding.
 *
 * It rethrows any Next-internal interruption first, logs ONE line, and renders
 * a minimal header for THAT request only — never cached. The logo and store name
 * are re-read when they can be, so a category-tree failure does not swap the
 * store's wordmark for the Demo one. `BrandingUnavailableError` is left to
 * propagate: the root layout already routes it to {@link fallbackNavigation}.
 */
export async function NavigationWrapper(): Promise<ReactElement> {
  try {
    return await NavigationWrapperCached();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof BrandingUnavailableError) throw error;
    logger.error("chrome_read_failed", {
      caller: "NavigationWrapper",
      action: "fallback-this-request",
      ...errorFields(error),
    });
    const { layout } = getStoreTheme();
    let logoUrl: string | null = null;
    let siteName = resolveStoreName(null);
    try {
      const [assets, { storeSettings }] = await Promise.all([
        getBrandingAssets(),
        getBranding(),
      ]);
      logoUrl = assets.logoUrl;
      siteName = resolveStoreName(storeSettings.name);
    } catch (brandingError) {
      unstable_rethrow(brandingError);
      if (brandingError instanceof BrandingUnavailableError)
        throw brandingError;
      // Branding is a separate failure domain from the read above; failing too
      // just means this one request renders the fallback wordmark.
    }
    return (
      <NavigationBar
        primaryMenuItems={[]}
        secondaryMenuItems={[]}
        navLayout={layout.navLayout}
        navStyle={layout.navStyle}
        logo={<BrandLogo logoUrl={logoUrl} siteName={siteName} />}
        mobileActions={<MobileHeaderActions />}
      />
    );
  }
}
