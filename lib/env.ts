import * as z from "zod";

const clientSchema = z.object({
  NEXT_PUBLIC_HEADKIT_PUBLIC_KEY: z.string().min(1),
  NEXT_PUBLIC_FRONTEND_URL: z.string().url().optional(),
  NEXT_PUBLIC_GTM_ID: z.string().optional(),
  // Canonical Hive gateway URL (FE-11). REQUIRED — a missing/invalid gateway
  // URL fails loudly at boot rather than silently falling back at request time.
  NEXT_PUBLIC_GRAPHQL_URL: z.string().url(),
  NEXT_PUBLIC_KLAVIYO_PUBLIC_KEY: z.string().optional(),
  NEXT_PUBLIC_HUBSPOT_PORTAL_ID: z.string().optional(),
  // Store display currency (ISO 4217) for catalog surfaces with no cart/order
  // context — see getStoreCurrency() in lib/utils.ts. Defaults to AUD there.
  NEXT_PUBLIC_STORE_CURRENCY: z.string().length(3).optional(),
  // Gravity Forms form id mounted on /wholesale. Per-STORE, so it is
  // configuration rather than a literal in the shared route, and a per-store
  // difference must not fork the page.
  //
  // Unset = the Woo route renders content only, with NO FORM. `/wholesale`
  // answers 200 either way, so a Woo store that should have a wholesale form
  // and lacks this value looks healthy from outside. Nothing in provisioning
  // sets it — check it when standing up a store whose predecessor had a
  // wholesale form. Shopify storefronts ignore this and render the built-in
  // Online Store contact form instead (see ShopifyContactForm).
  //
  // This comment previously read "Dishee mounts its enquiry form on /contact
  // instead" as the justification for leaving it unset. That was wrong, and it
  // is why Dishee's V2 store had no wholesale form: the live V1 site serves
  // BOTH — a 3-field form on /contact and a separate 8-field form on
  // /wholesale. Do not cite a store as an example here without opening it.
  NEXT_PUBLIC_WHOLESALE_FORM_ID: z.string().optional(),
  // Shopify Customer Account API (Phase F). When "true", /account shows
  // "Continue with Shopify"; OAuth uses the fixed platform callback on
  // dashboard-api (not a per-storefront redirect_uri).
  NEXT_PUBLIC_SHOPIFY_CAA_ENABLED: z.enum(["true", "false"]).optional(),
  NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN: z.string().optional(),
  NEXT_PUBLIC_SHOPIFY_SHOP_ID: z.string().optional(),
  NEXT_PUBLIC_SHOPIFY_CAA_CLIENT_ID: z.string().optional(),
  // Sales-channel handle appended to Shopify cart.checkoutUrl so Online Store
  // password protection does not intercept Checkout. Defaults to
  // headless-storefronts in lib/hosted-checkout.ts when unset.
  NEXT_PUBLIC_SHOPIFY_CHECKOUT_CHANNEL: z.string().min(1).optional(),
  // Optional custom Shopify checkout hostname (no protocol). When set,
  // hostedCheckoutUrl rewrites cart.checkoutUrl to this host (Dashboard →
  // Checkout → custom checkout subdomain).
  NEXT_PUBLIC_SHOPIFY_CHECKOUT_DOMAIN: z.string().min(1).optional(),
  // Per-store opt-out from Stripe's advanced fraud signals, read once by
  // `lib/stripe-js-singleton.ts`.
  //
  // Unset (and "true") keeps STRIPE'S OWN DEFAULT, which is what every store
  // gets today: signals on, the `m` third-party cookie on `m.stripe.com`
  // present. "false" turns them off, which is DOCUMENT-WIDE and reaches
  // checkout — Stripe states the cost ("increases their risk of fraud,
  // especially card testing"), so it is a per-merchant risk-appetite call and
  // never a platform default. See the note in `lib/stripe-js-singleton.ts`.
  NEXT_PUBLIC_STRIPE_ADVANCED_FRAUD_SIGNALS: z
    .enum(["true", "false"])
    .optional(),
  // The three per-store navigation-interaction switches. ALL DEFAULT OFF: unset,
  // empty and any unrecognised value leave the storefront exactly as it behaves
  // today, and only an explicit "true" / "1" / "on" / "yes" turns one on.
  //
  //   NEXT_PUBLIC_NAV_PREFETCH_BUDGET — spend the prefetch head start on the
  //     desktop nav and one carousel row instead of on every link (and turn on
  //     `partialPrefetching`, which `next.config.ts` reads from the same variable).
  //   NEXT_PUBLIC_NAV_MOUSEDOWN — start an in-app navigation on `mousedown`.
  //   NEXT_PUBLIC_NAVIGATION_SKELETON — draw a full-page skeleton while a
  //     navigation is pending.
  //
  // Declared here because this is where the full variable set is documented; the
  // values are READ in `lib/nav-interaction-flags.ts`, which is the one place the
  // rule lives and which states why the reads cannot come through this module.
  //
  // Deliberately NOT a z.enum: an unrecognised value must be accepted and mean off,
  // not fail the store's boot.
  NEXT_PUBLIC_NAV_PREFETCH_BUDGET: z.string().optional(),
  NEXT_PUBLIC_NAV_MOUSEDOWN: z.string().optional(),
  NEXT_PUBLIC_NAVIGATION_SKELETON: z.string().optional(),
  // WHEN the marketing tag stack (GTM / Klaviyo / HubSpot) loads. Unlike the
  // three switches above this one DEFAULTS ON — unset means the new, deferred
  // schedule (wait for `load`, then idle) — and an explicit "true" / "1" /
  // "on" / "yes" is the ESCAPE HATCH back to the previous mount-scheduled
  // behaviour for a store whose analytics or popup timing matters more than
  // its paint. Read in `lib/third-party-schedule.ts`, which carries the full
  // value table and states why it cannot be read through this module.
  //
  // Deliberately NOT a z.enum, for the same reason as the three above: an
  // unrecognised value must be accepted and mean "use the default", not fail
  // the store's boot.
  NEXT_PUBLIC_THIRD_PARTY_EAGER: z.string().optional(),
});

const serverSchema = clientSchema.extend({
  HEADKIT_PRIVATE_KEY: z.string().min(1),
  // Set by `next build` on itself and inherited by its prerender workers
  // (`phase-production-build`); absent at runtime. The ONLY discriminator
  // `lib/bulk-product-prefetch.ts` uses to stay inert outside a build.
  NEXT_PHASE: z.string().optional(),
  // "0" skips the build-time bulk product prefetch entirely — not even the
  // status query. Unset/"1" = consult commerce's per-store gate.
  HEADKIT_BULK_PREFETCH: z.enum(["0", "1"]).optional(),
  // Bulk pages one prefetch keeps in flight (default 3). Each page is ~5 s of
  // origin PHP, so 3 is ~0.6 req/s against a 2 req/s origin.
  HEADKIT_BULK_PREFETCH_CONCURRENCY: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
  // How many of the MOST RECENT posts `app/news/[...slug]` prerenders at build
  // (default `PRERENDER_POST_LIMIT_DEFAULT` there, 100). Each one is a single
  // paced content read, so the number is minutes of build time: 100 ≈ 1 min
  // at commerce's 1.8 req/s origin bucket. "0" = the placeholder param only.
  HEADKIT_PRERENDER_POST_LIMIT: z.string().regex(/^\d+$/).optional(),
  // Per-store cache profile (`lib/cache-profile.ts`). "conservative" (the
  // default, and what every storefront does today) keeps each cached read's
  // own finite lifetime as the missed-purge backstop; "aggressive" raises them
  // to `max`, where a tag purge is the ONLY thing that refreshes an entry.
  // Only set it on a store whose revalidation webhooks are known to arrive.
  //
  // Declared here for the boot parse and as the place an operator looks; the
  // module itself reads `process.env` directly, because importing this one
  // would drag the boot parse into every `cacheLife` call site. That module
  // says so at the read.
  //
  // `.catch` rather than a bare enum: an unrecognised value (including the
  // empty string a platform env editor writes for a "cleared" variable) must
  // resolve to the safe default, never fail the whole boot parse.
  HEADKIT_CACHE_PROFILE: z
    .enum(["conservative", "aggressive"])
    .optional()
    .catch(undefined),
  // Collection facet prerendering is decided from catalogue size
  // (`lib/collection-facet-plan.ts`), not from this variable. A value left
  // in a store's environment is ignored. Kept so a boot parse does not
  // reject a store that still has the old key set.
  HEADKIT_PRERENDER_COLLECTION_FACETS: z
    .union([z.literal("unlimited"), z.string().regex(/^\d+$/)])
    .optional()
    .catch(undefined),
  // Minimum products behind a colour / brand facet option for `app/sitemap.ts`
  // to advertise its `/collections/<cat>/f/<facet>` URL. BOTH default to 0 in
  // `lib/facet-sitemap-thresholds.ts`, i.e. advertise everything, which is what
  // every store does today — the numbers that make a cut worthwhile are a
  // property of one catalogue, not of the platform. The two bars are separate
  // on purpose: a two-product colour is a thin near-duplicate, a two-product
  // brand is a real search intent. Advertising only; a dropped URL still routes
  // and still answers 200. Takes effect on REDEPLOY, not on a tag purge.
  HEADKIT_SITEMAP_MIN_COLOUR_FACET_PRODUCTS: z
    .string()
    .regex(/^\d+$/)
    .optional(),
  HEADKIT_SITEMAP_MIN_BRAND_FACET_PRODUCTS: z
    .string()
    .regex(/^\d+$/)
    .optional(),
  REVALIDATION_SECRET: z.string().optional(),
  DASHBOARD_API_URL: z.string().url().optional(),
  DASHBOARD_API_TOKEN: z.string().min(1).optional(),
  // Platform dashboard-api origin for CAA start/redeem (optional; also
  // derived by stripping /graphql/subgraph/headkit from DASHBOARD_API_URL).
  HEADKIT_PLATFORM_URL: z.string().url().optional(),
  SHOPIFY_CAA_CLIENT_ID: z.string().optional(),
  SHOPIFY_STORE_DOMAIN: z.string().optional(),
  SHOPIFY_SHOP_ID: z.string().optional(),
});

type ClientEnv = z.infer<typeof clientSchema>;
type ServerEnv = z.infer<typeof serverSchema>;

function createEnv(): ClientEnv & Partial<ServerEnv> {
  const isServer = typeof window === "undefined";

  if (isServer) {
    return serverSchema.parse(process.env);
  }

  return clientSchema.parse({
    NEXT_PUBLIC_HEADKIT_PUBLIC_KEY: process.env.NEXT_PUBLIC_HEADKIT_PUBLIC_KEY,
    NEXT_PUBLIC_FRONTEND_URL: process.env.NEXT_PUBLIC_FRONTEND_URL || undefined,
    NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID || undefined,
    NEXT_PUBLIC_GRAPHQL_URL: process.env.NEXT_PUBLIC_GRAPHQL_URL,
    NEXT_PUBLIC_KLAVIYO_PUBLIC_KEY:
      process.env.NEXT_PUBLIC_KLAVIYO_PUBLIC_KEY || undefined,
    NEXT_PUBLIC_HUBSPOT_PORTAL_ID:
      process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID || undefined,
    NEXT_PUBLIC_STORE_CURRENCY:
      process.env.NEXT_PUBLIC_STORE_CURRENCY || undefined,
    NEXT_PUBLIC_WHOLESALE_FORM_ID:
      process.env.NEXT_PUBLIC_WHOLESALE_FORM_ID || undefined,
    NEXT_PUBLIC_SHOPIFY_CAA_ENABLED:
      process.env.NEXT_PUBLIC_SHOPIFY_CAA_ENABLED === "true" ||
      process.env.NEXT_PUBLIC_SHOPIFY_CAA_ENABLED === "false"
        ? process.env.NEXT_PUBLIC_SHOPIFY_CAA_ENABLED
        : undefined,
    NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN:
      process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN || undefined,
    NEXT_PUBLIC_SHOPIFY_SHOP_ID:
      process.env.NEXT_PUBLIC_SHOPIFY_SHOP_ID || undefined,
    NEXT_PUBLIC_SHOPIFY_CAA_CLIENT_ID:
      process.env.NEXT_PUBLIC_SHOPIFY_CAA_CLIENT_ID || undefined,
    NEXT_PUBLIC_SHOPIFY_CHECKOUT_CHANNEL:
      process.env.NEXT_PUBLIC_SHOPIFY_CHECKOUT_CHANNEL || undefined,
    NEXT_PUBLIC_STRIPE_ADVANCED_FRAUD_SIGNALS:
      process.env.NEXT_PUBLIC_STRIPE_ADVANCED_FRAUD_SIGNALS === "true" ||
      process.env.NEXT_PUBLIC_STRIPE_ADVANCED_FRAUD_SIGNALS === "false"
        ? process.env.NEXT_PUBLIC_STRIPE_ADVANCED_FRAUD_SIGNALS
        : undefined,
    NEXT_PUBLIC_NAV_PREFETCH_BUDGET:
      process.env.NEXT_PUBLIC_NAV_PREFETCH_BUDGET || undefined,
    NEXT_PUBLIC_NAV_MOUSEDOWN:
      process.env.NEXT_PUBLIC_NAV_MOUSEDOWN || undefined,
    NEXT_PUBLIC_NAVIGATION_SKELETON:
      process.env.NEXT_PUBLIC_NAVIGATION_SKELETON || undefined,
    NEXT_PUBLIC_THIRD_PARTY_EAGER:
      process.env.NEXT_PUBLIC_THIRD_PARTY_EAGER || undefined,
  });
}

export const env = createEnv();
