import * as z from "zod";
import themeJson from "@/overrides/theme.json";
import type { HeroLayout } from "@/lib/hero-layout";

export type { HeroLayout } from "@/lib/hero-layout";
export { heroLayoutClasses, heroMediaClasses } from "@/lib/hero-layout";

/** Supported nav logo placements — see overrides/theme.schema.json. */
export type NavLayout = "left-logo" | "centered-logo" | "split";

/** Desktop header action presentation. */
export type NavStyle = "icons" | "text-labels";

/** Homepage navigation chrome. */
export type HomepageNav = "solid" | "overlay-hero";

/** Product-tag names/slugs that render as card/PDP pills. */
export interface CatalogTheme {
  badgeTags?: string[];
  /** Ordered collection slugs on the homepage category carousel. Omit = first N. */
  homepageCollections?: string[];
  /** Ordered collection slugs on the Shop header carousel. Omit = all roots. */
  shopCollections?: string[];
  /**
   * Colour dots a product card shows before the rest collapse into a "+N"
   * chip. Omit = the starter default (10). See `components/headkit-ui/product-card.tsx`.
   */
  maxCardSwatches?: number;
}

/** Optional override for one SectionHeader (omit = starter hardcoded copy). */
export interface SectionCopyFields {
  title?: string;
  eyebrow?: string;
  allButton?: string;
  allButtonPath?: string;
}

/**
 * Customer-owned section strings. Starter omits this — hardcoded titles stay.
 * `{word}` in title uses the heading highlight face (same as product names).
 */
export interface CopyTheme {
  homepageFeatured?: SectionCopyFields;
  homepageLatestNews?: SectionCopyFields;
  pdpBundles?: SectionCopyFields;
  pdpRelated?: SectionCopyFields;
  /** Link text under a homepage collection-card title. Omit = title only. */
  collectionCardLink?: string;
  /**
   * Posts index heading when the provider has no posts-page body.
   * A WooCommerce Reading posts page, or a Shopify page whose handle
   * matches the posts base, still wins for both title and HTML body.
   */
  postsIndex?: PostsIndexCopy;
}

/** Plain-text stand-in for the posts index. HTML belongs on the CMS page. */
export interface PostsIndexCopy {
  title?: string;
  description?: string;
}

/** One packaging choice written to the order as the Packaging attribute. */
export interface CartPackagingOption {
  id: string;
  title: string;
  description: string;
  /** http(s) URL or root-relative path. Omit for a plain swatch. */
  image?: string;
}

/** Cart-drawer packaging selector. First option is the default. */
export interface CartPackagingTheme {
  title: string;
  options: CartPackagingOption[];
}

/** Optional complimentary gift-message field in the cart drawer. */
export interface CartGiftMessageTheme {
  label: string;
}

/**
 * Hosted-checkout cart extras. Starter omits this. A store opts in by
 * setting packaging and/or giftMessage; both are stored as cart attributes
 * so they appear on the provider order.
 */
export interface CartTheme {
  packaging?: CartPackagingTheme;
  giftMessage?: CartGiftMessageTheme;
  /**
   * Replaces both default empty-cart sentences when the drawer is not in
   * quote mode. Omit to keep the starter copy.
   */
  emptyMessage?: string;
}

/**
 * Store-owned additions to the WordPress placeholder-page list
 * (`lib/cms-placeholder-pages.ts`). Slugs are BARE and top-level; the platform
 * defaults (WooCommerce's `cart` and `my-account`) apply either way.
 */
export interface CmsTheme {
  /** Extra bare slugs the catch-all 404s and the sitemap omits. */
  placeholderNotFound?: string[];
  /** Extra bare slug → root-relative permanent redirect target. */
  placeholderRedirects?: Record<string, string>;
}

/** Optional PDP chrome owned by the customer theme. */
export interface PdpTheme {
  /**
   * Internal path for a Size Guide CMS page (e.g. `/size-guide`).
   * When set, every PDP shows one Size Guide control (modal). With
   * Complete the set it sits on that heading; otherwise on the colour
   * row, size row, or as a standalone buy-box link — including Bundles.
   * Direct visits still render the full CMS page.
   */
  sizeGuideHref?: string;
}

/** Validated customer theme from overrides/theme.json. */
export interface StoreTheme {
  version: number;
  layout: {
    navLayout: NavLayout;
    navStyle: NavStyle;
    heroLayout: HeroLayout;
    homepageNav: HomepageNav;
    /** Shopify PDP “Enquire about this product”. Default true; Velvet sets false. */
    productEnquiry: boolean;
  };
  catalog?: CatalogTheme;
  cms?: CmsTheme;
  pdp?: PdpTheme;
  copy?: CopyTheme;
  cart?: CartTheme;
  figma?: {
    fileKey: string;
    referenceFrames: Record<string, string>;
  };
}

const layoutSchema = z.object({
  navLayout: z.enum(["left-logo", "centered-logo", "split"]),
  navStyle: z.enum(["icons", "text-labels"]),
  heroLayout: z.enum(["inset", "full-bleed", "fixed-height"]),
  homepageNav: z.enum(["solid", "overlay-hero"]),
  productEnquiry: z.boolean().default(true),
});

const collectionSlugSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/);

const catalogSchema = z.object({
  badgeTags: z.array(z.string().min(1).max(64)).max(32).optional(),
  homepageCollections: z.array(collectionSlugSchema).max(32).optional(),
  shopCollections: z.array(collectionSlugSchema).max(32).optional(),
  maxCardSwatches: z.number().int().min(1).max(20).optional(),
});

const rootRelativePathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/);

const cmsSchema = z.object({
  placeholderNotFound: z.array(collectionSlugSchema).max(32).optional(),
  placeholderRedirects: z
    .record(collectionSlugSchema, rootRelativePathSchema)
    .optional(),
});

const pdpSchema = z.object({
  sizeGuideHref: z
    .string()
    .min(1)
    .max(256)
    .regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/),
});

const sectionCopySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  eyebrow: z.string().max(200).optional(),
  allButton: z.string().max(80).optional(),
  allButtonPath: z
    .string()
    .min(1)
    .max(256)
    .regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/)
    .optional(),
});

const postsIndexCopySchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(500).optional(),
});

const copySchema = z.object({
  homepageFeatured: sectionCopySchema.optional(),
  homepageLatestNews: sectionCopySchema.optional(),
  pdpBundles: sectionCopySchema.optional(),
  pdpRelated: sectionCopySchema.optional(),
  collectionCardLink: z.string().min(1).max(80).optional(),
  postsIndex: postsIndexCopySchema.optional(),
});

const cartImageSchema = z
  .string()
  .max(2048)
  .refine(
    (value) =>
      value.length === 0 ||
      value.startsWith("/") ||
      value.startsWith("https://") ||
      value.startsWith("http://"),
    "image must be an http(s) URL or a root-relative path",
  );

const cartPackagingOptionSchema = z.object({
  id: collectionSlugSchema,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  image: cartImageSchema.optional(),
});

const cartSchema = z.object({
  packaging: z
    .object({
      title: z.string().min(1).max(80),
      options: z.array(cartPackagingOptionSchema).min(1).max(6),
    })
    .optional(),
  giftMessage: z
    .object({
      label: z.string().min(1).max(160),
    })
    .optional(),
  emptyMessage: z.string().min(1).max(240).optional(),
});

const themeSchema = z.object({
  version: z.number().int().min(1),
  layout: layoutSchema,
  catalog: catalogSchema.optional(),
  cms: cmsSchema.optional(),
  pdp: pdpSchema.optional(),
  copy: copySchema.optional(),
  cart: cartSchema.optional(),
  figma: z
    .object({
      fileKey: z.string(),
      referenceFrames: z.record(z.string(), z.string()),
    })
    .optional(),
});

function pickSectionCopy(
  fields: z.infer<typeof sectionCopySchema>,
): SectionCopyFields {
  const picked: SectionCopyFields = {};
  if (fields.title !== undefined) {
    picked.title = fields.title;
  }
  if (fields.eyebrow !== undefined) {
    picked.eyebrow = fields.eyebrow;
  }
  if (fields.allButton !== undefined) {
    picked.allButton = fields.allButton;
  }
  if (fields.allButtonPath !== undefined) {
    picked.allButtonPath = fields.allButtonPath;
  }
  return picked;
}

const STARTER_DEFAULTS: StoreTheme = {
  version: 1,
  layout: {
    navLayout: "left-logo",
    navStyle: "icons",
    heroLayout: "inset",
    homepageNav: "solid",
    productEnquiry: true,
  },
};

let cachedTheme: StoreTheme | null = null;

function normalizeTheme(data: z.infer<typeof themeSchema>): StoreTheme {
  const theme: StoreTheme = {
    version: data.version,
    layout: data.layout,
  };
  if (data.catalog !== undefined) {
    const catalog: CatalogTheme = {};
    if (data.catalog.badgeTags !== undefined) {
      catalog.badgeTags = data.catalog.badgeTags;
    }
    if (data.catalog.homepageCollections !== undefined) {
      catalog.homepageCollections = data.catalog.homepageCollections;
    }
    if (data.catalog.shopCollections !== undefined) {
      catalog.shopCollections = data.catalog.shopCollections;
    }
    if (data.catalog.maxCardSwatches !== undefined) {
      catalog.maxCardSwatches = data.catalog.maxCardSwatches;
    }
    theme.catalog = catalog;
  }
  if (data.cms !== undefined) {
    const cms: CmsTheme = {};
    if (data.cms.placeholderNotFound !== undefined) {
      cms.placeholderNotFound = data.cms.placeholderNotFound;
    }
    if (data.cms.placeholderRedirects !== undefined) {
      cms.placeholderRedirects = data.cms.placeholderRedirects;
    }
    theme.cms = cms;
  }
  if (data.pdp !== undefined) {
    theme.pdp = data.pdp;
  }
  if (data.copy !== undefined) {
    const copy: CopyTheme = {};
    if (data.copy.homepageFeatured !== undefined) {
      copy.homepageFeatured = pickSectionCopy(data.copy.homepageFeatured);
    }
    if (data.copy.homepageLatestNews !== undefined) {
      copy.homepageLatestNews = pickSectionCopy(data.copy.homepageLatestNews);
    }
    if (data.copy.pdpBundles !== undefined) {
      copy.pdpBundles = pickSectionCopy(data.copy.pdpBundles);
    }
    if (data.copy.pdpRelated !== undefined) {
      copy.pdpRelated = pickSectionCopy(data.copy.pdpRelated);
    }
    if (data.copy.collectionCardLink !== undefined) {
      copy.collectionCardLink = data.copy.collectionCardLink;
    }
    if (data.copy.postsIndex !== undefined) {
      const postsIndex: PostsIndexCopy = {};
      if (data.copy.postsIndex.title !== undefined) {
        postsIndex.title = data.copy.postsIndex.title;
      }
      if (data.copy.postsIndex.description !== undefined) {
        postsIndex.description = data.copy.postsIndex.description;
      }
      copy.postsIndex = postsIndex;
    }
    theme.copy = copy;
  }
  if (data.figma !== undefined) {
    theme.figma = data.figma;
  }
  if (data.cart !== undefined) {
    theme.cart = pickCart(data.cart);
  }
  return theme;
}

function pickCart(cart: z.infer<typeof cartSchema>): CartTheme {
  const picked: CartTheme = {};
  if (cart.packaging !== undefined) {
    picked.packaging = {
      title: cart.packaging.title,
      options: cart.packaging.options.map((option) => {
        const next: CartPackagingOption = {
          id: option.id,
          title: option.title,
          description: option.description,
        };
        if (option.image) {
          next.image = option.image;
        }
        return next;
      }),
    };
  }
  if (cart.giftMessage !== undefined) {
    picked.giftMessage = { label: cart.giftMessage.label };
  }
  if (cart.emptyMessage !== undefined) {
    picked.emptyMessage = cart.emptyMessage;
  }
  return picked;
}

/**
 * Validate an arbitrary theme document. Invalid input falls back to starter
 * defaults. Tests use this so a cart config can be checked without rewriting
 * overrides/theme.json.
 */
export function parseStoreTheme(raw: unknown): StoreTheme {
  const parsed = themeSchema.safeParse(raw);
  return parsed.success ? normalizeTheme(parsed.data) : STARTER_DEFAULTS;
}

/**
 * Load and validate overrides/theme.json. Invalid files fall back to starter
 * defaults so a typo cannot break the storefront shell.
 */
export function getStoreTheme(): StoreTheme {
  if (cachedTheme) {
    return cachedTheme;
  }
  cachedTheme = parseStoreTheme(themeJson);
  return cachedTheme;
}

/** Reset memoized theme — tests only. */
export function resetStoreThemeForTests(): void {
  cachedTheme = null;
}

/**
 * Map layout modes to `<html>` data attributes for SSR-safe CSS hooks.
 * Prefer these over per-route body classes — nav lives outside `<main>`.
 */
export function getThemeHtmlAttributes(
  theme: StoreTheme = getStoreTheme(),
): Record<string, string> {
  return {
    "data-nav-layout": theme.layout.navLayout,
    "data-nav-style": theme.layout.navStyle,
    "data-hero-layout": theme.layout.heroLayout,
    "data-homepage-nav": theme.layout.homepageNav,
  };
}

