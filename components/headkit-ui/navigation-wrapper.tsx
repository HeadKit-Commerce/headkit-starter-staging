import type { ReactElement } from "react";
import type { MenuLocation } from "@headkit/sdk";
import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { convertToRelativePath } from "@/lib/convert-uri";
import { TAG } from "@/lib/cache-tags";
import { headkit } from "@/lib/sdk";
import {
  NavigationBar,
  type NavMenuItem,
} from "@/components/headkit-ui/navigation-bar";
import { MobileHeaderActions } from "@/components/headkit-ui/header-actions";
import { BrandLogo } from "@/components/icon/brand-logo";
import { getBranding, getBrandingAssets } from "@/lib/branding";
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
 */
async function loadMenu(
  location: MenuLocation,
  canonicalPath: CollectionPathLookup,
): Promise<NavMenuItem[]> {
  try {
    const tree = await headkit.menu.get(location);
    return normalizeMenu(tree, canonicalPath);
  } catch {
    return [];
  }
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
 * parallel). Degrades to empty menus on failure. Result order matches
 * `locations`.
 */
async function loadMenusBatch(
  locations: readonly MenuLocation[],
): Promise<NavigationMenuLike[]> {
  try {
    const menus = await headkit.menu.getMenus([...locations]);
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
  } catch {
    return locations.map(() => ({ ...EMPTY_MENU }));
  }
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
 */
export async function fetchMenu(
  location: MenuLocation,
): Promise<NavMenuItem[]> {
  "use cache: remote";
  cacheLifeForProfile("hours", "max");
  // `TAG.collections` because the hrefs are re-derived from the category tree
  // (see `collectionPathLookup`): a category rename or re-parent changes this
  // entry's output even when the menu itself never moves.
  cacheTag(TAG.menu(location), TAG.collections);
  return loadMenu(location, await collectionPathLookup());
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
 */
export async function getFooterMenus(): Promise<
  {
    location: string;
    name: string;
    items: { id: string; label: string; uri: string }[];
  }[]
> {
  "use cache: remote";
  cacheLifeForProfile("hours", "max");
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

  const [menus, canonicalPath] = await Promise.all([
    loadMenusBatch(FOOTER_LOCATIONS),
    collectionPathLookup(),
  ]);
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
  cacheLifeForProfile("hours", "max");
  // `TAG.collections` — same reason as `fetchMenu`.
  cacheTag(TAG.footer, TAG.menu("FOOTER"), TAG.collections);
  return loadMenu("FOOTER", await collectionPathLookup());
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

export async function NavigationWrapper() {
  "use cache: remote";
  cacheLifeForProfile("hours", "max");
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
  const [headerMenus, canonicalPath, { logoUrl }, { storeSettings, branding }] =
    await Promise.all([
      loadMenusBatch(HEADER_LOCATIONS),
      collectionPathLookup(),
      getBrandingAssets(),
      getBranding(),
    ]);

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

  const { layout } = getStoreTheme();

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
