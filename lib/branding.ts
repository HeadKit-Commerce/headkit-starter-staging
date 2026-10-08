/**
 * Per-tenant branding / store-settings / SEO fetch (FE-08).
 *
 * Branding lives in **dashboard-api** — the HeadKit graph that is a SEPARATE
 * transport from commerce / the storefront SDK. This module MUST NOT import the
 * commerce SDK or talk to the commerce gateway; it issues a plain GraphQL POST
 * to the dashboard-api endpoint configured via `DASHBOARD_API_URL`.
 *
 * Local-stack note (Open Q2 / phase-3 decision = "degrade"): dashboard-api is
 * not currently part of the local Docker supergraph and has no documented local
 * URL. So `DASHBOARD_API_URL` / `DASHBOARD_API_TOKEN` are UNSET locally and
 * `getBranding()` degrades to the documented defaults below (matching
 * `app/globals.css`: --color-primary #7f54b3 (and --color-purple-500 tracking
 * it for hovers/accents), --color-secondary #000000, no
 * logo/icon override, no gtmId, root SEO left to its existing values). This is
 * structurally wired: the moment both are provisioned, real per-tenant branding
 * flows through with no code change.
 *
 * Production auth: dashboard-api GraphQL (`/graphql/subgraph/headkit`) requires
 * `Authorization: Bearer <store API token>`. The provisioner mints
 * `DASHBOARD_API_TOKEN` on initial deploy and always upserts `DASHBOARD_API_URL`.
 *
 * `DASHBOARD_API_URL` must be the full headkit GraphQL path
 * (`{BASE_URL}/graphql/subgraph/headkit`) — the bare Cloud Run host 404s, and
 * `/graphql/subgraph/` alone is the mount prefix, not the gqlgen handler.
 *
 * Mirrors the `lib/account-actions.ts` server-fetch + try/catch envelope shape,
 * but uses `fetch` directly (no SDK) because branding is off the commerce path.
 *
 * Tenant isolation (T-03-B1): the Bearer token scopes the request to one store;
 * this client never sends a client-supplied tenant id.
 */

import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { TAG } from "@/lib/cache-tags";
import { executeRequest, GetBrandingDocument } from "@headkit/sdk";
import { env } from "@/lib/env";
import { headkitTransportOpts } from "@/lib/headkit-transport";
import { logger } from "@/lib/logger";
import {
  BrandingUnavailableError,
  brandingCacheOnDashboardMiss,
} from "@/lib/branding-cache-policy";
import { resolveBrandingAssets, type BrandingAssets } from "./branding-assets";
import {
  DEFAULT_PDP_GALLERY_LAYOUT,
  resolvePdpGalleryLayout,
} from "./pdp-gallery-layout";

export {
  DEFAULT_PDP_GALLERY_LAYOUT,
  resolvePdpGalleryLayout,
  type PdpGalleryLayout,
} from "./pdp-gallery-layout";

// ---------------------------------------------------------------------------
// Types — mirror the dashboard-api schema (schema.graphqls)
// ---------------------------------------------------------------------------

export interface BrandingFont {
  source: string;
  family: string;
  googleSlug: string;
  fileUrl: string;
  /** Discrete Google weights from dashboard; empty → lean default in brand-fonts. */
  googleWeights: number[];
  /** When true, storefront also loads italic Fontsource faces. */
  googleItalic: boolean;
  /** Uploaded italic cut URL; empty when unset. */
  italicFileUrl: string;
}

export interface Branding {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  textColor: string;
  logoUrl: string | null;
  iconUrl: string | null;
  headingFont: BrandingFont;
  subheadingFont: BrandingFont;
  bodyFont: BrandingFont;
  cornerStyle: string;
  /**
   * PDP gallery composition. `grid` is today's masonry; `thumbnails` is
   * hero + strip; `carousel` is one large image; `stack` is a lookbook
   * column. Empty / unknown values coerce to `grid`.
   */
  pdpGalleryLayout: string;
  iconLibrary: string;
  /** Separate colourway cards on collections/carousels. Default true. */
  showVariants: boolean;
  /** Colour dots on product cards. Default false. */
  showSwatches: boolean;
  /** Second gallery image on card mouseover. Default false. */
  imageRollover: boolean;
  /** Hide categories with no products from carousels/menus. Default true. */
  hideEmptyCollections: boolean;
  /**
   * Default PLP sort when URL has no ?sort=. Matches SortKey; unset → CREATED_AT.
   */
  defaultCollectionSort: string;
  /** PDP multi-add companions. Default false. */
  multiAddEnabled: boolean;
}

export interface StoreSettings {
  id: string | null;
  slug: string | null;
  name: string | null;
  gtmId: string | null;
  domain: string | null;
  /** Dashboard checkout experience: custom | quote (GraphQL may send CUSTOM/QUOTE). */
  checkoutType: string | null;
  /**
   * The store's cookie-consent gate (Google Consent Mode v2 default + banner).
   *
   * ABSENT MEANS OFF, structurally and not just by a default value: it is read
   * through its own isolated query, so a dashboard-api revision that has never
   * heard of the field answers nothing and this stays false. Every store that
   * exists today has no value for it, and turning a consent banner on in front
   * of a merchant's customers is a visible product change to someone else's
   * store — so absent must mean "behave exactly as before".
   */
  cookieConsentEnabled: boolean;
  /**
   * The store's WebMCP tools (catalogue, cart, and navigation on
   * document.modelContext).
   *
   * ABSENT MEANS OFF, the same way as cookieConsentEnabled: it is read through
   * its own isolated query, so a dashboard-api revision that has never heard
   * of the field answers nothing and this stays false. There is no env
   * fallback. An env var would be per-deploy, and this must be per-store and
   * flippable from the dashboard without a rebuild.
   */
  webmcpEnabled: boolean;
}

export interface SeoSettings {
  title: string | null;
  description: string | null;
  ogImageUrl: string | null;
  /** When false, storefront sitemap returns empty and robots omits Sitemap. */
  enableSitemap: boolean;
  /** When false, storefront emits noindex/nofollow and robots Disallow: /. */
  allowIndexing: boolean;
  /** When true, revalidate webhook submits changed URLs to IndexNow. */
  indexNowEnabled: boolean;
  /** Public IndexNow key served at /{key}.txt; null when never enabled. */
  indexNowKey: string | null;
}

export interface BrandingBundle {
  branding: Branding;
  storeSettings: StoreSettings;
  seoSettings: SeoSettings;
}

// ---------------------------------------------------------------------------
// Documented defaults (degrade target) — keep in lockstep with globals.css
// ---------------------------------------------------------------------------

/** Default brand color tokens — MUST match `app/globals.css` :root values. */
export const DEFAULT_PRIMARY_COLOR = "#7f54b3";
export const DEFAULT_SECONDARY_COLOR = "#000000";
export const DEFAULT_BACKGROUND_COLOR = "#ffffff";
export const DEFAULT_TEXT_COLOR = "#171717";
export const DEFAULT_CORNER_STYLE = "soft";
export const DEFAULT_ICON_LIBRARY = "hi2";
export const DEFAULT_SHOW_VARIANTS = true;
export const DEFAULT_SHOW_SWATCHES = false;
export const DEFAULT_IMAGE_ROLLOVER = false;
export const DEFAULT_HIDE_EMPTY_COLLECTIONS = true;
/** Newest first — historical WooCommerce date/DESC default. */
export const DEFAULT_COLLECTION_SORT = "CREATED_AT";
/** Multi-add companions on PDP — off until merchant enables. */
export const DEFAULT_MULTI_ADD_ENABLED = false;
/**
 * Cookie-consent gate — off until the merchant enables it.
 *
 * This one is not merely a sensible default, it is the whole compatibility
 * story: every existing store has no value for the field, and if absent meant
 * on, the next deploy would put a consent banner in front of every merchant's
 * customers without anyone asking them.
 */
export const DEFAULT_COOKIE_CONSENT_ENABLED = false;
/**
 * WebMCP tools — off until the merchant enables them.
 *
 * Same compatibility story as the consent gate: every existing store has no
 * value for the field, and if absent meant on, the next deploy would register
 * cart-writing tools on every merchant's storefront.
 */
export const DEFAULT_WEBMCP_ENABLED = false;

const KNOWN_COLLECTION_SORTS = new Set([
  "FEATURED",
  "BEST_SELLING",
  "CREATED_AT",
  "CREATED_AT_DESC",
  "PRICE",
  "PRICE_DESC",
  "TITLE",
  "TITLE_DESC",
]);

/** Coerce a branding sort string to a known SortKey (defaults to newest). */
export function resolveCollectionSort(value?: string | null): string {
  if (value && KNOWN_COLLECTION_SORTS.has(value)) {
    return value;
  }
  return DEFAULT_COLLECTION_SORT;
}

const EMPTY_FONT: BrandingFont = {
  source: "",
  family: "",
  googleSlug: "",
  fileUrl: "",
  googleWeights: [],
  googleItalic: false,
  italicFileUrl: "",
};

const DEFAULT_BUNDLE: BrandingBundle = {
  branding: {
    primaryColor: DEFAULT_PRIMARY_COLOR,
    secondaryColor: DEFAULT_SECONDARY_COLOR,
    backgroundColor: DEFAULT_BACKGROUND_COLOR,
    textColor: DEFAULT_TEXT_COLOR,
    logoUrl: null,
    iconUrl: null,
    headingFont: EMPTY_FONT,
    subheadingFont: EMPTY_FONT,
    bodyFont: EMPTY_FONT,
    cornerStyle: DEFAULT_CORNER_STYLE,
    pdpGalleryLayout: DEFAULT_PDP_GALLERY_LAYOUT,
    iconLibrary: DEFAULT_ICON_LIBRARY,
    showVariants: DEFAULT_SHOW_VARIANTS,
    showSwatches: DEFAULT_SHOW_SWATCHES,
    imageRollover: DEFAULT_IMAGE_ROLLOVER,
    hideEmptyCollections: DEFAULT_HIDE_EMPTY_COLLECTIONS,
    defaultCollectionSort: DEFAULT_COLLECTION_SORT,
    multiAddEnabled: DEFAULT_MULTI_ADD_ENABLED,
  },
  storeSettings: {
    id: null,
    slug: null,
    name: null,
    gtmId: null,
    domain: null,
    checkoutType: null,
    cookieConsentEnabled: DEFAULT_COOKIE_CONSENT_ENABLED,
    webmcpEnabled: DEFAULT_WEBMCP_ENABLED,
  },
  seoSettings: {
    title: null,
    description: null,
    ogImageUrl: null,
    enableSitemap: true,
    allowIndexing: true,
    indexNowEnabled: false,
    indexNowKey: null,
  },
};

// ---------------------------------------------------------------------------
// Query — branding + storeSettings + seoSettings
// ---------------------------------------------------------------------------

/**
 * Core selection shared by the full + compat queries. Colors, logo, store name,
 * and classic SEO fields MUST stay here — a failed SEO-gate field must never
 * wipe the whole branding payload (that regression discarded colors/logo when
 * dashboard-api lagged behind the starter SEO query).
 *
 * Extended brand fields (background/text/fonts/style/icons) live in the FULL
 * query only; {@link BRANDING_QUERY_COMPAT} keeps legacy dashboard-api working.
 */
const BRANDING_CORE_SELECTION = /* GraphQL */ `
    branding {
      primaryColor
      secondaryColor
      logoUrl
      iconUrl
    }
    storeSettings {
      id
      slug
      name
      gtmId
      domain
    }
    seoSettings {
      title
      description
      ogImageUrl
`;

const BRANDING_EXTENDED_SELECTION = /* GraphQL */ `
    branding {
      primaryColor
      secondaryColor
      backgroundColor
      textColor
      logoUrl
      iconUrl
      headingFontSource
      headingFontFamily
      headingFontGoogleSlug
      headingFontGoogleWeights
      headingFontFileUrl
      subheadingFontSource
      subheadingFontFamily
      subheadingFontGoogleSlug
      subheadingFontGoogleWeights
      subheadingFontFileUrl
      bodyFontSource
      bodyFontFamily
      bodyFontGoogleSlug
      bodyFontGoogleWeights
      bodyFontFileUrl
      cornerStyle
      iconLibrary
      showVariants
      showSwatches
      imageRollover
      hideEmptyCollections
      defaultCollectionSort
      multiAddEnabled
    }
    storeSettings {
      id
      slug
      name
      gtmId
      domain
    }
    seoSettings {
      title
      description
      ogImageUrl
`;

/** Extended branding without googleWeights (pre–font-weight dashboard-api). */
const BRANDING_EXTENDED_NO_WEIGHTS_SELECTION = /* GraphQL */ `
    branding {
      primaryColor
      secondaryColor
      backgroundColor
      textColor
      logoUrl
      iconUrl
      headingFontSource
      headingFontFamily
      headingFontGoogleSlug
      headingFontFileUrl
      subheadingFontSource
      subheadingFontFamily
      subheadingFontGoogleSlug
      subheadingFontFileUrl
      bodyFontSource
      bodyFontFamily
      bodyFontGoogleSlug
      bodyFontFileUrl
      cornerStyle
      iconLibrary
      showVariants
      showSwatches
      imageRollover
      hideEmptyCollections
      defaultCollectionSort
      multiAddEnabled
    }
    storeSettings {
      id
      slug
      name
      gtmId
      domain
    }
    seoSettings {
      title
      description
      ogImageUrl
`;

/**
 * Full query including sitemap/indexing gates, catalog display prefs, and
 * extended branding fields. Unknown catalog fields fall back to EXTENDED.
 */
const BRANDING_QUERY = /* GraphQL */ `
  query StorefrontBranding {
    branding {
      primaryColor
      secondaryColor
      backgroundColor
      textColor
      logoUrl
      iconUrl
      headingFontSource
      headingFontFamily
      headingFontGoogleSlug
      headingFontGoogleWeights
      headingFontGoogleItalic
      headingFontFileUrl
      headingFontItalicFileUrl
      subheadingFontSource
      subheadingFontFamily
      subheadingFontGoogleSlug
      subheadingFontGoogleWeights
      subheadingFontGoogleItalic
      subheadingFontFileUrl
      subheadingFontItalicFileUrl
      bodyFontSource
      bodyFontFamily
      bodyFontGoogleSlug
      bodyFontGoogleWeights
      bodyFontGoogleItalic
      bodyFontFileUrl
      bodyFontItalicFileUrl
      cornerStyle
      pdpGalleryLayout
      iconLibrary
      showVariants
      showSwatches
      imageRollover
      hideEmptyCollections
      defaultCollectionSort
      multiAddEnabled
    }
    storeSettings {
      id
      slug
      name
      gtmId
      domain
    }
    seoSettings {
      title
      description
      ogImageUrl
      enableSitemap
      allowIndexing
      indexNowEnabled
      indexNowKey
    }
  }
`;

/**
 * Full branding without IndexNow fields. Used when dashboard-api has sitemap /
 * indexing gates but not yet indexNowEnabled / indexNowKey.
 */
const BRANDING_QUERY_SEO_GATES = /* GraphQL */ `
  query StorefrontBrandingSeoGates {
    branding {
      primaryColor
      secondaryColor
      backgroundColor
      textColor
      logoUrl
      iconUrl
      headingFontSource
      headingFontFamily
      headingFontGoogleSlug
      headingFontGoogleWeights
      headingFontFileUrl
      subheadingFontSource
      subheadingFontFamily
      subheadingFontGoogleSlug
      subheadingFontGoogleWeights
      subheadingFontFileUrl
      bodyFontSource
      bodyFontFamily
      bodyFontGoogleSlug
      bodyFontGoogleWeights
      bodyFontFileUrl
      cornerStyle
      iconLibrary
      showVariants
      showSwatches
      imageRollover
      hideEmptyCollections
      defaultCollectionSort
      multiAddEnabled
    }
    storeSettings {
      id
      slug
      name
      gtmId
      domain
    }
    seoSettings {
      title
      description
      ogImageUrl
      enableSitemap
      allowIndexing
    }
  }
`;

/**
 * Extended branding without SEO-gate fields. Used when dashboard-api has
 * background/fonts/style/icons but not yet enableSitemap / allowIndexing.
 */
const BRANDING_QUERY_EXTENDED = /* GraphQL */ `
  query StorefrontBrandingExtended {
${BRANDING_EXTENDED_SELECTION}
    }
  }
`;

const BRANDING_QUERY_EXTENDED_NO_WEIGHTS = /* GraphQL */ `
  query StorefrontBrandingExtendedNoWeights {
${BRANDING_EXTENDED_NO_WEIGHTS_SELECTION}
    }
  }
`;

/**
 * Compat query for older dashboard-api revisions that lack enableSitemap /
 * allowIndexing / extended branding fields. gqlgen returns `data: null` for
 * unknown fields — that used to discard colors/logo/name entirely. We retry
 * without the newer fields and default them in {@link coerce}.
 */
const BRANDING_QUERY_COMPAT = /* GraphQL */ `
  query StorefrontBrandingCompat {
${BRANDING_CORE_SELECTION}
    }
  }
`;

/**
 * Isolated checkout-type read so unknown-field failures on older
 * dashboard-api do not discard branding colors / SEO via the main queries.
 */
const CHECKOUT_TYPE_QUERY = /* GraphQL */ `
  query StorefrontCheckoutType {
    storeSettings {
      checkoutType
    }
  }
`;

/**
 * Catalog display + multi-add flags. Fetched separately so compat/extended
 * branding fallbacks (which omit newer fields) do not strand multiAddEnabled
 * at false when the dashboard toggle is on.
 */
const PRODUCT_FEATURES_QUERY = /* GraphQL */ `
  query StorefrontProductFeatures {
    branding {
      showVariants
      showSwatches
      imageRollover
      hideEmptyCollections
      defaultCollectionSort
      multiAddEnabled
    }
  }
`;

/**
 * Isolated cookie-consent read.
 *
 * Isolated for the usual reason — an unknown field must not discard branding
 * from the main query — and for one more that matters here: it makes
 * "dashboard-api does not know this field" and "the merchant has not turned it
 * on" reach the storefront as the SAME answer, false. There is no path by
 * which a store that has never set the field gets a consent banner.
 */
const COOKIE_CONSENT_QUERY = /* GraphQL */ `
  query StorefrontCookieConsent {
    storeSettings {
      cookieConsentEnabled
    }
  }
`;

/**
 * Isolated WebMCP read.
 *
 * Isolated for the same reason as COOKIE_CONSENT_QUERY: an unknown field on
 * the main branding selection makes gqlgen answer `data: null` for the whole
 * document. Keeping this query alone makes "dashboard-api does not know this
 * field" and "the merchant has not turned it on" reach the storefront as the
 * same answer, false.
 */
const WEBMCP_QUERY = /* GraphQL */ `
  query StorefrontWebmcp {
    storeSettings {
      webmcpEnabled
    }
  }
`;

/**
 * Isolated gallery-layout read so unknown-field failures on older
 * dashboard-api do not discard branding via the main queries, and so a
 * fallback to EXTENDED / COMPAT still overlays the merchant's choice.
 */
const PDP_GALLERY_LAYOUT_QUERY = /* GraphQL */ `
  query StorefrontPdpGalleryLayout {
    branding {
      pdpGalleryLayout
    }
  }
`;

interface FlatBranding extends Partial<
  Omit<
    Branding,
    | "showVariants"
    | "showSwatches"
    | "imageRollover"
    | "hideEmptyCollections"
    | "defaultCollectionSort"
    | "multiAddEnabled"
  >
> {
  headingFontSource?: string | null;
  headingFontFamily?: string | null;
  headingFontGoogleSlug?: string | null;
  headingFontGoogleWeights?: number[] | null;
  headingFontGoogleItalic?: boolean | null;
  headingFontFileUrl?: string | null;
  headingFontItalicFileUrl?: string | null;
  subheadingFontSource?: string | null;
  subheadingFontFamily?: string | null;
  subheadingFontGoogleSlug?: string | null;
  subheadingFontGoogleWeights?: number[] | null;
  subheadingFontGoogleItalic?: boolean | null;
  subheadingFontFileUrl?: string | null;
  subheadingFontItalicFileUrl?: string | null;
  bodyFontSource?: string | null;
  bodyFontFamily?: string | null;
  bodyFontGoogleSlug?: string | null;
  bodyFontGoogleWeights?: number[] | null;
  bodyFontGoogleItalic?: boolean | null;
  bodyFontFileUrl?: string | null;
  bodyFontItalicFileUrl?: string | null;
  showVariants?: boolean | null;
  showSwatches?: boolean | null;
  imageRollover?: boolean | null;
  hideEmptyCollections?: boolean | null;
  defaultCollectionSort?: string | null;
  multiAddEnabled?: boolean | null;
}

interface BrandingResponse {
  data?: {
    branding?: FlatBranding | null;
    storeSettings?: Partial<StoreSettings> | null;
    seoSettings?:
      | (Partial<SeoSettings> & {
          enableSitemap?: boolean | null;
          allowIndexing?: boolean | null;
        })
      | null;
  };
  errors?: Array<{ message: string }>;
}

function coerceFont(
  source: string | null | undefined,
  family: string | null | undefined,
  googleSlug: string | null | undefined,
  fileUrl: string | null | undefined,
  googleWeights?: number[] | null,
  googleItalic?: boolean | null,
  italicFileUrl?: string | null,
): BrandingFont {
  return {
    source: source ?? "",
    family: family ?? "",
    googleSlug: googleSlug ?? "",
    fileUrl: fileUrl ?? "",
    googleWeights: Array.isArray(googleWeights)
      ? googleWeights.filter((w): w is number => typeof w === "number")
      : [],
    googleItalic: googleItalic === true,
    italicFileUrl: italicFileUrl ?? "",
  };
}

/** Coerce a possibly-partial branding payload into a complete, typed bundle. */
function coerce(data: NonNullable<BrandingResponse["data"]>): BrandingBundle {
  const b = data.branding ?? {};
  const s = data.storeSettings ?? {};
  const seo = data.seoSettings ?? {};
  return {
    branding: {
      primaryColor: b.primaryColor || DEFAULT_PRIMARY_COLOR,
      secondaryColor: b.secondaryColor || DEFAULT_SECONDARY_COLOR,
      backgroundColor: b.backgroundColor || DEFAULT_BACKGROUND_COLOR,
      textColor: b.textColor || DEFAULT_TEXT_COLOR,
      logoUrl: b.logoUrl ?? null,
      iconUrl: b.iconUrl ?? null,
      headingFont: coerceFont(
        b.headingFontSource,
        b.headingFontFamily,
        b.headingFontGoogleSlug,
        b.headingFontFileUrl,
        b.headingFontGoogleWeights,
        b.headingFontGoogleItalic,
        b.headingFontItalicFileUrl,
      ),
      subheadingFont: coerceFont(
        b.subheadingFontSource,
        b.subheadingFontFamily,
        b.subheadingFontGoogleSlug,
        b.subheadingFontFileUrl,
        b.subheadingFontGoogleWeights,
        b.subheadingFontGoogleItalic,
        b.subheadingFontItalicFileUrl,
      ),
      bodyFont: coerceFont(
        b.bodyFontSource,
        b.bodyFontFamily,
        b.bodyFontGoogleSlug,
        b.bodyFontFileUrl,
        b.bodyFontGoogleWeights,
        b.bodyFontGoogleItalic,
        b.bodyFontItalicFileUrl,
      ),
      cornerStyle: b.cornerStyle || DEFAULT_CORNER_STYLE,
      pdpGalleryLayout: resolvePdpGalleryLayout(b.pdpGalleryLayout),
      iconLibrary: b.iconLibrary || DEFAULT_ICON_LIBRARY,
      // Defaults match dashboard-api when fields are unset / unknown.
      showVariants: b.showVariants !== false,
      showSwatches: b.showSwatches === true,
      imageRollover: b.imageRollover === true,
      hideEmptyCollections: b.hideEmptyCollections !== false,
      defaultCollectionSort: resolveCollectionSort(b.defaultCollectionSort),
      multiAddEnabled: b.multiAddEnabled === true,
    },
    storeSettings: {
      id: s.id ?? null,
      slug: s.slug ?? null,
      name: s.name ?? null,
      gtmId: s.gtmId ?? null,
      domain: s.domain ?? null,
      checkoutType: s.checkoutType ?? null,
      // Never read from the main query — see COOKIE_CONSENT_QUERY. `=== true`
      // rather than `!== false` so any absent / unknown value means OFF.
      cookieConsentEnabled: s.cookieConsentEnabled === true,
      // Never read from the main query — see WEBMCP_QUERY. `=== true` so any
      // absent / unknown value means OFF.
      webmcpEnabled: s.webmcpEnabled === true,
    },
    seoSettings: {
      title: seo.title ?? null,
      description: seo.description ?? null,
      ogImageUrl: seo.ogImageUrl ?? null,
      // Defaults true when dashboard-api has not yet shipped the field.
      enableSitemap: seo.enableSitemap !== false,
      allowIndexing: seo.allowIndexing !== false,
      indexNowEnabled: seo.indexNowEnabled === true,
      indexNowKey:
        typeof seo.indexNowKey === "string" && seo.indexNowKey.length > 0
          ? seo.indexNowKey
          : null,
    },
  };
}

/**
 * True when the GraphQL payload has usable branding / store / SEO data.
 * Unknown-field errors often set sibling keys to null but still return the
 * rest of `data` — prefer that over discarding the whole bundle.
 */
function hasUsableBrandingData(
  data: BrandingResponse["data"],
): data is NonNullable<BrandingResponse["data"]> {
  if (!data) return false;
  return (
    data.branding != null ||
    data.storeSettings != null ||
    data.seoSettings != null
  );
}

/** POST one branding query; returns coerced bundle or null on hard failure. */
async function fetchBrandingQuery(
  endpoint: string,
  token: string,
  query: string,
): Promise<BrandingBundle | null> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: brandingRequestHeaders(token),
    body: JSON.stringify({ query }),
    // Caching is governed by the enclosing `'use cache'` + cacheLife
    // on {@link getBranding}, so no fetch-level `next.revalidate` here.
  });

  if (!res.ok) return null;

  const json = (await res.json()) as BrandingResponse;
  if (hasUsableBrandingData(json.data)) {
    return coerce(json.data);
  }
  return null;
}

/**
 * The empty branding bundle, for a caller that caught
 * {@link BrandingUnavailableError} outside `"use cache"`.
 *
 * Returning this from inside `getBranding` would store “no logo” and later
 * replace an uploaded mark with the HeadKit Demo wordmark. Callers that need
 * a one-request stand-in use this instead.
 */
export function fallbackBrandingBundle(): BrandingBundle {
  return DEFAULT_BUNDLE;
}

/**
 * Fetch per-tenant branding / store-settings / SEO from dashboard-api.
 *
 * Returns {@link DEFAULT_BUNDLE} when `DASHBOARD_API_URL` or
 * `DASHBOARD_API_TOKEN` is unset (local / CI). A successful payload whose
 * `logoUrl` is null is a real empty logo and is cached — the Demo wordmark
 * stays for a store that uploaded neither a logo nor an icon.
 *
 * A failed read (non-200, timeout, unreachable, no usable payload) throws
 * {@link BrandingUnavailableError} at runtime. A return inside `"use cache"`
 * is a successful fill, and a background revalidation that returned the empty
 * bundle was overwriting a good logo. A throw is not saved, so the previous
 * entry stays. During `next build` the same failure still returns
 * {@link DEFAULT_BUNDLE}: a throw inside `"use cache"` fails the build even
 * when the page later catches it.
 *
 * Resilience: if the full query fails because dashboard-api does not yet
 * expose `enableSitemap` / `allowIndexing`, retries {@link BRANDING_QUERY_COMPAT}
 * so colors, logo, and store name still resolve. The isolated cookie-consent
 * query keeps its own catch and stays off on failure.
 *
 * Cached (Cache Components, `'use cache'`): branding is a per-tenant-per-DEPLOY
 * read — the tenant resolves from build/deploy env (`DASHBOARD_API_URL` +
 * token), NOT a per-request runtime API (no cookies()/headers()/searchParams),
 * so the read is deterministic and cacheable. Caching it here keeps the ROOT
 * LAYOUT's branding read out of the uncached set, so it no longer poisons every
 * route's static prerender under Cache Components. The stable `'branding'`
 * cacheTag lets `/api/revalidate` invalidate it when dashboard-api branding
 * changes.
 */
export async function getBranding(): Promise<BrandingBundle> {
  "use cache: remote";
  cacheLife("days");
  cacheTag(TAG.branding);

  const endpoint = env.DASHBOARD_API_URL;
  const token = env.DASHBOARD_API_TOKEN;
  // Both required — URL alone gets 401 from APITokenAuthMiddleware.
  // Missing env is the local/CI default and is cached on purpose.
  if (!endpoint || !token) return DEFAULT_BUNDLE;

  try {
    const [
      bundle,
      checkoutType,
      productFeatures,
      pdpGalleryLayout,
      cookieConsentEnabled,
      webmcpEnabled,
    ] = await Promise.all([
      fetchBrandingBundle(endpoint, token),
      fetchCheckoutType(endpoint, token),
      fetchProductFeatures(endpoint, token),
      fetchPdpGalleryLayout(endpoint, token),
      fetchCookieConsent(endpoint, token),
      fetchWebmcp(endpoint, token),
    ]);

    if (!bundle) throw new BrandingUnavailableError();

    const branding = {
      ...(productFeatures
        ? { ...bundle.branding, ...productFeatures }
        : bundle.branding),
      pdpGalleryLayout: pdpGalleryLayout ?? bundle.branding.pdpGalleryLayout,
    };

    const storeSettings = {
      ...bundle.storeSettings,
      ...(checkoutType === null ? {} : { checkoutType }),
      cookieConsentEnabled,
      webmcpEnabled,
    };

    return { ...bundle, branding, storeSettings };
  } catch (error) {
    unstable_rethrow(error);
    if (brandingCacheOnDashboardMiss(env.NEXT_PHASE) === "default") {
      logger.error("branding.degraded_render", {
        phase: env.NEXT_PHASE ?? "",
      });
      return DEFAULT_BUNDLE;
    }
    if (error instanceof BrandingUnavailableError) throw error;
    throw new BrandingUnavailableError();
  }
}

/** Resolve branding via full → seo-gates → extended → compat fallbacks. */
async function fetchBrandingBundle(
  endpoint: string,
  token: string,
): Promise<BrandingBundle | null> {
  const full = await fetchBrandingQuery(endpoint, token, BRANDING_QUERY);
  if (full) return full;

  const seoGates = await fetchBrandingQuery(
    endpoint,
    token,
    BRANDING_QUERY_SEO_GATES,
  );
  if (seoGates) return seoGates;

  const extended = await fetchBrandingQuery(
    endpoint,
    token,
    BRANDING_QUERY_EXTENDED,
  );
  if (extended) return extended;

  const extendedNoWeights = await fetchBrandingQuery(
    endpoint,
    token,
    BRANDING_QUERY_EXTENDED_NO_WEIGHTS,
  );
  if (extendedNoWeights) return extendedNoWeights;

  return fetchBrandingQuery(endpoint, token, BRANDING_QUERY_COMPAT);
}

/**
 * Best-effort checkout type. Returns null when the field is missing or the
 * request fails — callers keep the default HeadKit Custom experience.
 */
async function fetchCheckoutType(
  endpoint: string,
  token: string,
): Promise<string | null> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: brandingRequestHeaders(token),
      body: JSON.stringify({ query: CHECKOUT_TYPE_QUERY }),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: { storeSettings?: { checkoutType?: string | null } | null } | null;
    };
    return json.data?.storeSettings?.checkoutType ?? null;
  } catch {
    return null;
  }
}

type ProductFeaturesBranding = Pick<
  Branding,
  | "showVariants"
  | "showSwatches"
  | "imageRollover"
  | "hideEmptyCollections"
  | "defaultCollectionSort"
  | "multiAddEnabled"
>;

/** Overlay catalog + multi-add prefs when the main branding query used a compat path. */
async function fetchProductFeatures(
  endpoint: string,
  token: string,
): Promise<ProductFeaturesBranding | null> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: brandingRequestHeaders(token),
      body: JSON.stringify({ query: PRODUCT_FEATURES_QUERY }),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: { branding?: FlatBranding | null } | null;
    };
    const b = json.data?.branding;
    if (!b) return null;

    return {
      showVariants: b.showVariants !== false,
      showSwatches: b.showSwatches === true,
      imageRollover: b.imageRollover === true,
      hideEmptyCollections: b.hideEmptyCollections !== false,
      defaultCollectionSort: resolveCollectionSort(b.defaultCollectionSort),
      multiAddEnabled: b.multiAddEnabled === true,
    };
  } catch {
    return null;
  }
}

/**
 * The store's cookie-consent gate.
 *
 * Returns a BOOLEAN, not `boolean | null`, and every failure path returns
 * false: a missing field, a non-200, a parse error, an unreachable
 * dashboard-api. There is deliberately no "unknown" to propagate, because the
 * only safe reading of "we could not find out" is "leave the storefront as it
 * is". Contrast the neighbours above, which return null so a compat fallback
 * can still overlay a merchant's choice — here a wrong guess would change what
 * a merchant's customers see.
 */
async function fetchCookieConsent(
  endpoint: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: brandingRequestHeaders(token),
      body: JSON.stringify({ query: COOKIE_CONSENT_QUERY }),
    });
    if (!res.ok) return DEFAULT_COOKIE_CONSENT_ENABLED;

    const json = (await res.json()) as {
      data?: {
        storeSettings?: { cookieConsentEnabled?: boolean | null } | null;
      } | null;
    };
    return json.data?.storeSettings?.cookieConsentEnabled === true;
  } catch {
    return DEFAULT_COOKIE_CONSENT_ENABLED;
  }
}

/**
 * The store's WebMCP switch.
 *
 * Returns a BOOLEAN, and every failure path returns false: a missing field, a
 * non-200, a parse error, an unreachable dashboard-api. The only safe reading
 * of "we could not find out" is "register nothing".
 */
async function fetchWebmcp(endpoint: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: brandingRequestHeaders(token),
      body: JSON.stringify({ query: WEBMCP_QUERY }),
    });
    if (!res.ok) return DEFAULT_WEBMCP_ENABLED;

    const json = (await res.json()) as {
      data?: {
        storeSettings?: { webmcpEnabled?: boolean | null } | null;
      } | null;
    };
    return json.data?.storeSettings?.webmcpEnabled === true;
  } catch {
    return DEFAULT_WEBMCP_ENABLED;
  }
}

/**
 * Best-effort PDP gallery layout. Returns null when the field is missing or
 * the request fails — callers keep the coerce default (`grid`).
 */
async function fetchPdpGalleryLayout(
  endpoint: string,
  token: string,
): Promise<string | null> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: brandingRequestHeaders(token),
      body: JSON.stringify({ query: PDP_GALLERY_LAYOUT_QUERY }),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: { branding?: { pdpGalleryLayout?: string | null } | null } | null;
    };
    const raw = json.data?.branding?.pdpGalleryLayout;
    if (raw === undefined || raw === null) return null;
    return resolvePdpGalleryLayout(raw);
  } catch {
    return null;
  }
}

/** Headers for the FE-08 dashboard-api branding GraphQL POST. */
function brandingRequestHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

// ---------------------------------------------------------------------------
// Commerce-path branding icon (ENG-572)
// ---------------------------------------------------------------------------

/**
 * Fetch the store icon URL from the COMMERCE graph (`commerce.branding.iconUrl`)
 * via the PK/SK SDK transport — the same path `app/api/icon` already uses.
 *
 * Why a second source: the commerce `StoreBranding` exposes `iconUrl` and is
 * available on the LOCAL Docker supergraph (unlike dashboard-api, whose
 * `DASHBOARD_API_URL` is unset locally — see {@link getBranding}). So the
 * per-store icon that Branding settings persist in WordPress (`siteIcon`, or
 * `logo` as fallback) reaches the storefront through this path both locally and
 * in production.
 *
 * Never throws: returns `null` on any error / missing key so callers keep the
 * file-convention favicon and the default `<Logo/>`.
 */
async function fetchCommerceBrandingIcon(): Promise<string | null> {
  try {
    const data = await executeRequest(
      headkitTransportOpts(),
      GetBrandingDocument,
      undefined,
    );
    return data.commerce.branding.iconUrl ?? null;
  } catch {
    return null;
  }
}

export type { BrandingAssets } from "./branding-assets";

/**
 * Resolve the per-store logo + icon for head metadata and the nav (ENG-572).
 *
 * Merges the two branding transports so each asset comes from wherever it is
 * actually available:
 *  - `iconUrl` (favicon/OG): the dashboard-api `iconUrl` FIRST, then the
 *    commerce `iconUrl`.
 *  - `logoUrl` (nav logo): the dashboard-api `logoUrl` (the only real logo field)
 *    first, falling back to the commerce `iconUrl` so a store that only set an
 *    icon still gets a branded mark instead of the HeadKit default.
 *
 * WHY `iconUrl` PREFERS DASHBOARD-API (changed 2026-08-10).
 * It used to prefer commerce, so that the favicon was exercisable on the local
 * stack where `DASHBOARD_API_URL` is unset. That reasoning still holds and is
 * preserved — locally the dashboard-api branch resolves to `null` and this falls
 * through to commerce exactly as before — but the ordering had a user-visible
 * cost in production:
 *
 * The dashboard's Store Icon control states "Upload your icon and we will
 * convert for favicon, webclip and Apple touch". That upload writes
 * `store.branding.iconUrl` (dashboard-api). The favicon, however, read the
 * COMMERCE value, which is WordPress's `siteIcon` — and falls back to the
 * WordPress *logo* when `siteIcon` is unset. So on a store with no WP site icon,
 * an operator could upload a square icon, get a success toast, and still be
 * served a wide wordmark as the tab icon, with no way to fix it from the
 * dashboard. Observed on the Dishee migration rehearsal (plan 15.1-18,
 * FINDING 3).
 *
 * Preferring the explicitly-uploaded asset makes the control do what it says.
 * Commerce remains the fallback, so stores that only ever set a WordPress site
 * icon are unaffected.
 *
 * The commerce icon still degrades to `null` (never throws). A failed
 * dashboard read throws out of {@link getBranding} and therefore out of this
 * function — catching it here would store `{ logoUrl: null }` and replace an
 * uploaded logo with the Demo wordmark. Do not add that catch.
 *
 * Cached (Cache Components): a per-tenant-per-deploy read (tenant resolves from
 * the SDK key / dashboard-api env, not a per-request runtime API), so it is
 * deterministic and cacheable. Carries `TAG.branding` (`headkit:branding`) — the
 * SAME tag {@link getBranding} uses and the storefront contract WP fires on a
 * logo/site-icon change — so a `/api/revalidate` branding purge invalidates both.
 * (Previously the bare literal `"branding"`, which is neither exact- nor
 * prefix-known, so it silently dropped at the revalidate route.)
 */
export async function getBrandingAssets(): Promise<BrandingAssets> {
  "use cache: remote";
  cacheLifeForProfile("hours", "max");
  cacheTag(TAG.branding);

  const [bundle, commerceIcon] = await Promise.all([
    getBranding(),
    fetchCommerceBrandingIcon(),
  ]);

  return resolveBrandingAssets({
    dashboardIcon: bundle.branding.iconUrl,
    dashboardLogo: bundle.branding.logoUrl,
    commerceIcon,
  });
}
