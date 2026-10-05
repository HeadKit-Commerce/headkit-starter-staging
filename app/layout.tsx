import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import "./globals.css";
// Customer-owned UI/styling layer — prefer overrides/ over editing core components.
import "@/overrides/styles.css";
import {
  NavigationWrapper,
  getFooterMenus,
} from "@/components/headkit-ui/navigation-wrapper";
import { CartProvider } from "@/components/headkit-ui/cart-context";
import { HostedCartSync } from "@/components/checkout/hosted-cart-sync";
import { AuthProvider } from "@/components/headkit-ui/auth-context";
import { Footer } from "@/components/headkit-ui/footer";
import { LazyCartDrawer } from "@/components/headkit-ui/lazy-cart-drawer";
import { NavigationSkeletonHost } from "@/components/headkit-ui/skeletons/navigation-skeleton-host";
import { navigationSkeletonEnabled } from "@/lib/nav-interaction-flags";
import { WebMcpRegistrar } from "@/components/headkit-ui/webmcp-registrar";
import { WebsiteJsonLD } from "@/components/seo/website-json-ld";
import { OrganizationJsonLD } from "@/components/seo/organization-json-ld";
import {
  makeRootMetadata,
  brandingIcons,
  resolveFooterDescription,
  resolveStoreName,
} from "@/lib/make-metadata";
import { getBranding, getBrandingAssets } from "@/lib/branding";
import { resolveSiteUrl } from "@/lib/site-url";
import { normalizeCheckoutMode } from "@/lib/checkout-mode";
import { env } from "@/lib/env";
import { isShopifyStorefront } from "@/lib/shopify-storefront";
import { CheckoutModeProvider } from "@/components/checkout/checkout-mode-provider";
import { CatalogDisplayProvider } from "@/components/headkit-ui/catalog-display-provider";
import { SwatchImageProvider } from "@/components/headkit-ui/swatch-image-provider";
import { experimentalSwatchImagesEnabled } from "@/lib/experimental-swatch-images";
import { resolveBrandFonts } from "@/lib/brand-fonts";
import { resolveOnPrimaryTextColor } from "@/lib/contrast";
import { BrandingIconsProvider } from "@/components/branding/branding-icons-provider";
import { ConsentBanner } from "@/components/headkit-ui/consent-banner";
import { DeferredThirdPartyScripts } from "@/components/headkit-ui/deferred-third-party-scripts";
import { getEmailMarketingStatus } from "@/lib/email-marketing";
import { Toaster } from "@/components/ui/toaster";
import { ClientThemeProvider } from "@/components/headkit-ui/client-theme-provider";
import { clientThemeSlice } from "@/lib/client-theme";
import { getStoreTheme, getThemeHtmlAttributes } from "@/lib/store-theme";
import { BelowMain, HeadRouteScript } from "@/overrides/layout-slots";

// Build-time env GTM id (kept as a fallback); per-tenant gtmId from
// dashboard-api StoreSettings takes precedence at runtime (FE-08).
const ENV_GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;
// Env public key fallbacks; store emailConnection.publicApiKey wins.
const ENV_KLAVIYO_PUBLIC_KEY = process.env.NEXT_PUBLIC_KLAVIYO_PUBLIC_KEY;
const ENV_HUBSPOT_PORTAL_ID = process.env.NEXT_PUBLIC_HUBSPOT_PORTAL_ID;
const SITE_URL = process.env.NEXT_PUBLIC_FRONTEND_URL ?? "";

const HEX_OR_RGB =
  /^(#(?:[0-9a-fA-F]{3,8})|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d+)\s*\))$/;

/**
 * Sanitize a branding color value before injecting it into a CSS custom
 * property (T-03-B2). Only well-formed hex / rgb / rgba values pass; anything
 * else (including attempts to break out of the declaration) is dropped so the
 * built-in `globals.css` default applies instead.
 */
function safeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return HEX_OR_RGB.test(v) ? v : null;
}

const CORNER_STYLE_VARS: Record<string, string> = {
  soft: "--radius: 0.5rem; --radius-button: 0.375rem;",
  round: "--radius: 1.25rem; --radius-button: 9999px;",
  square: "--radius: 0; --radius-button: 0;",
};

export async function generateMetadata(): Promise<Metadata> {
  // SeoSettings from dashboard-api feeds the root metadata fallback (FE-08).
  // Local degrade → null SEO fields; floor is store name (never HeadKit marketing).
  try {
    const [{ seoSettings, storeSettings }, { iconUrl }] = await Promise.all([
      getBranding(),
      getBrandingAssets(),
    ]);
    const siteName = resolveStoreName(storeSettings.name);
    return {
      ...(await makeRootMetadata({
        title: seoSettings.title?.trim() || siteName,
        description: seoSettings.description?.trim() || "",
        siteName,
        iconUrl,
        ogImageUrl: seoSettings.ogImageUrl,
        allowIndexing: seoSettings.allowIndexing,
        siteUrl: storeSettings.domain,
      })),
      // Site-wide favicon (branding icon, or the bundled default). Owned by the
      // layout so page metadata never overrides the per-store tab icon (ENG-572).
      icons: brandingIcons(iconUrl),
    };
  } catch (error) {
    unstable_rethrow(error);
    // Branding unreadable ⇒ the store's indexing switch is UNKNOWN, so this
    // must close indexing exactly as app/robots.ts does (`Disallow: /` on the
    // same failure). Defaulting to index here would judge the host against the
    // baked NEXT_PUBLIC_FRONTEND_URL and publish `index, follow` beside that
    // `Disallow` — the desynchronisation ENG-868 exists to remove, surviving in
    // the one branch where the store state cannot be read.
    return {
      ...(await makeRootMetadata({ siteName: "Store", allowIndexing: false })),
      icons: brandingIcons(null),
    };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Per-tenant branding + CMS footer menus (Footer / Footer 2 / Footer Policy).
  // Both degrade gracefully (branding → defaults; empty menus → static footer).
  const [
    { branding, storeSettings, seoSettings },
    footerMenus,
    { iconUrl },
    emailMarketing,
  ] = await Promise.all([
    getBranding(),
    getFooterMenus(),
    getBrandingAssets(),
    getEmailMarketingStatus(),
  ]);

  const siteName = resolveStoreName(storeSettings.name);
  // One origin for the whole document: the JSON-LD graph's @id/url, the
  // SearchAction urlTemplate and the Organization logo must name the same host
  // as the canonical this page emits, which generateMetadata above resolves
  // from the runtime store domain.
  //
  // The invariant holds beyond the two components rendered here: the shared
  // JSON-LD components in components/seo/ resolve the SAME runtime origin via
  // `resolveJsonLdSiteUrl()` instead of the build-time NEXT_PUBLIC_FRONTEND_URL,
  // so a PDP, collection, news, projects or CMS page cannot name a second host.
  const siteUrl = resolveSiteUrl(storeSettings.domain, SITE_URL);
  const gtmId = storeSettings.gtmId ?? ENV_GTM_ID;
  // The store's cookie-consent gate. ONE value drives all three halves — the
  // consent default pushed by the tag loader, the banner, and the footer's
  // re-open link — so "off" cannot degrade into "banner gone, default stuck at
  // denied", which would stop Google tags firing with nothing able to grant.
  // Absent on every store that exists today, and absent means off; see
  // `lib/branding.ts`. There is deliberately NO env fallback beside it the way
  // `ENV_GTM_ID` is one: an env var would be per-DEPLOY, and this must be
  // per-STORE and flippable from the dashboard without a rebuild.
  const cookieConsentEnabled = storeSettings.cookieConsentEnabled;
  // The store's WebMCP tools. Absent means off, and there is deliberately NO
  // env fallback: an env var would be per-deploy, and this must be per-store
  // and flippable from the dashboard without a rebuild. See lib/branding.ts.
  const webmcpEnabled = storeSettings.webmcpEnabled;
  // Shopify leaves for hosted checkout. WooCommerce stays on /checkout.
  // Quote mode is checkoutType, read inside the registrar. One of the three,
  // never a description that lists all of them.
  const hostedCheckout = isShopifyStorefront(env);
  const checkoutMode = normalizeCheckoutMode(storeSettings.checkoutType);
  const emailProvider = emailMarketing.provider.toLowerCase();
  const klaviyoPublicKey =
    emailProvider === "klaviyo"
      ? emailMarketing.publicApiKey || ENV_KLAVIYO_PUBLIC_KEY || null
      : emailProvider === ""
        ? ENV_KLAVIYO_PUBLIC_KEY || null
        : null;
  const hubspotPortalId =
    emailProvider === "hubspot"
      ? emailMarketing.publicApiKey || ENV_HUBSPOT_PORTAL_ID || null
      : emailProvider === "" && !klaviyoPublicKey
        ? ENV_HUBSPOT_PORTAL_ID || null
        : null;
  const showFooterSubscribe = emailMarketing.enabled;
  // Feeds two consumers: the Footer paragraph and the WebSite JSON-LD
  // `description`. When the dashboard SEO description is unset both render
  // nothing by design — never the store name, which is not a description.
  const siteDescription = resolveFooterDescription(seoSettings.description);
  const orgLogoUrl = iconUrl ?? branding.iconUrl ?? undefined;

  const fonts = await resolveBrandFonts({
    heading: branding.headingFont,
    subheading: branding.subheadingFont,
    body: branding.bodyFont,
  });

  // Inject per-tenant brand tokens as :root CSS custom properties.
  const primary = safeColor(branding.primaryColor);
  const secondary = safeColor(branding.secondaryColor);
  const background = safeColor(branding.backgroundColor);
  const text = safeColor(branding.textColor);
  const cornerVars =
    CORNER_STYLE_VARS[branding.cornerStyle] ?? CORNER_STYLE_VARS.soft;

  // CTA / on-primary text: the brand background is KEPT whenever it already
  // clears 4.5:1 against the primary, and only otherwise falls back to black or
  // white. This replaces an unconditional alias to the background, which was
  // correct only while the primary was dark — a light primary over a light
  // background (mint on white ≈ 1.7:1) made every filled control unreadable,
  // and no branding value a merchant can enter could fix it.
  const onPrimaryText = background
    ? resolveOnPrimaryTextColor(primary, background)
    : null;
  const storeTheme = getStoreTheme();
  const themeAttrs = getThemeHtmlAttributes(storeTheme);

  const brandVars = [
    primary
      ? `--color-primary: ${primary}; --color-purple-500: ${primary}; --color-purple-800: ${primary};`
      : "",
    secondary ? `--color-secondary: ${secondary};` : "",
    background
      ? `--color-background: ${background}; --background: ${background}; --color-primary-text: ${onPrimaryText ?? background};`
      : "",
    text
      ? `--color-text: ${text}; --foreground: ${text}; --color-purple-900: ${text};`
      : "",
    cornerVars,
    fonts.cssVars,
    "--font-sans: var(--font-body);",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={fonts.variableClassNames}
      {...themeAttrs}
      data-pdp-gallery={branding.pdpGalleryLayout}
    >
      <head>
        <meta name="apple-mobile-web-app-title" content={siteName} />
        <HeadRouteScript />
        {/*
          Brand fonts: selected curated faces as inline @font-face (Fontsource
          latin woff2) + upload @font-face via same-origin proxy. No
          fonts.googleapis.com and no unused next/font CSS chunks.
        */}
        {fonts.usesFontsourceCdn ? (
          <link
            rel="preconnect"
            href="https://cdn.jsdelivr.net"
            crossOrigin="anonymous"
          />
        ) : null}
        {/* Per-tenant brand token overrides. Empty pieces leave globals.css defaults. */}
        {(brandVars || fonts.fontFaceCss) && (
          <style
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: `${fonts.fontFaceCss}${brandVars ? `:root { ${brandVars} }` : ""}`,
            }}
          />
        )}
      </head>
      {/*
        Fonts apply via :root CSS vars (--font-body) + Tailwind font-sans —
        not next/font body classNames (those fought the layered body rule).
      */}
      <body className="antialiased font-sans">
        {/* Marketing tags. GoogleTagManager from @next/third-parties (afterInteractive). A visit is tagged with no gesture unless this store's cookie gate is on. */}
        <DeferredThirdPartyScripts
          gtmId={gtmId}
          klaviyoPublicKey={klaviyoPublicKey}
          hubspotPortalId={hubspotPortalId}
          consentEnabled={cookieConsentEnabled}
        />

        {/* The cookie gate's banner. A SIBLING of {children}, never a wrapper,
            and it adds no <Suspense> and makes no request-time read — the rule
            the long comment below states for redirects applies to this too, and
            a consent banner is exactly the feature that invites a server-side
            cookies() read. It renders nothing until after hydration, and
            nothing at all unless the merchant turned the gate on. */}
        {cookieConsentEnabled ? <ConsentBanner /> : null}

        <WebsiteJsonLD
          siteName={siteName}
          siteUrl={siteUrl}
          description={siteDescription}
        />
        <OrganizationJsonLD
          name={siteName}
          url={siteUrl}
          {...(orgLogoUrl ? { logoUrl: orgLogoUrl } : {})}
        />

        {/*
          NO <Suspense> may wrap {children} here. Under Cache Components a
          redirect thrown below a boundary lands after the response has
          committed, so a route that calls `permanentRedirect()` answers 200 +
          shell and redirects only on the client — which is what turned the flat
          /products and /collections URLs back into 200 duplicates. A root
          boundary also emptied the prerendered shell, leaving no page content
          at all for a client that runs no JavaScript. `e2e/canonical-url-308.spec.ts`
          is what observes both.

          And NOTHING here may make a REQUEST-TIME read, boundary or no
          boundary. A boundary in this layout is free — the `<Suspense>` around
          <BelowMain /> below costs nothing, because its child is cached — but a
          request-time read inside one postpones a dynamic hole in EVERY route
          in the application, so no response can be served as a finished file.
          Measured: +1.4 s on a 27 KB page, +2.4 s on a 236 KB page, +44-68 %
          bytes, on every page and every RSC payload. This layout used to carry
          <DynamicMetadataMarker /> (`await connection()`) for exactly that
          reason and no longer does; see lib/host-robots.ts.
        */}
        <BrandingIconsProvider library={branding.iconLibrary}>
          <ClientThemeProvider value={clientThemeSlice(storeTheme)}>
          <CatalogDisplayProvider
            prefs={{
              showVariants: branding.showVariants,
              showSwatches: branding.showSwatches,
              imageRollover: branding.imageRollover,
              defaultCollectionSort: branding.defaultCollectionSort,
            }}
          >
            {/* Boolean only. The WordPress term read starts on the collection
                and product pages, and only when the flag is on. No Suspense:
                a boundary here would hold every document open. */}
            <SwatchImageProvider enabled={experimentalSwatchImagesEnabled()}>
            <CheckoutModeProvider mode={checkoutMode}>
              {/* WebMCP tools for an in-page agent. Gated on the store
                  setting (dashboard → In-page agents). DEFAULT OFF, so the
                  component is not mounted and nothing runs. The gate is on
                  the mount, the same shape as NavigationSkeletonHost: the
                  registrar adds no <Suspense> and makes no request-time read. */}
              {webmcpEnabled ? (
                <WebMcpRegistrar hostedCheckout={hostedCheckout} />
              ) : null}
              <AuthProvider>
                <CartProvider>
                  <HostedCartSync />
                  <LazyCartDrawer />
                  {/* The ONE renderer of the pending-navigation skeleton. Here,
                      and not inside the link that asked for it, because a link in
                      the mega-menu / mobile sheet / search or cart drawer is
                      unmounted by its own container ~160 ms after the click — long
                      before the 400 ms threshold — and used to take the skeleton
                      with it. It adds no <Suspense> and makes no request-time read,
                      so the status-code rule above still holds.

                      Gated on NEXT_PUBLIC_NAVIGATION_SKELETON (see
                      lib/nav-interaction-flags.ts for the value table). The gate is
                      HERE, on the mount, rather than as an early return inside the
                      host: a host that mounts still runs useSyncExternalStore and
                      useDelayedFlag, and the switch is meant to leave nothing
                      running at all. DEFAULT OFF, so a store that sets nothing
                      renders exactly what it does today. */}
                  {navigationSkeletonEnabled() ? (
                    <NavigationSkeletonHost />
                  ) : null}
                  <NavigationWrapper />
                  <main className="headkit-main pb-10">{children}</main>
                  <Suspense fallback={null}>
                    <BelowMain />
                  </Suspense>
                  <Footer
                    siteName={siteName}
                    description={siteDescription}
                    menus={footerMenus}
                    iconUrl={branding.iconUrl}
                    showSubscribe={showFooterSubscribe}
                    hidePaymentIcons={checkoutMode === "quote"}
                    // The footer's "Cookie preferences" link is part of the
                    // gate, not decoration: it is the only way a visitor who
                    // declined can change their mind. It renders only when the
                    // gate is on, so a link that opens nothing is impossible.
                    showCookiePreferences={cookieConsentEnabled}
                    // NO `socialLinks` here. This is a TEMPLATE file, shipped
                    // to every store, so a literal here publishes HeadKit's own
                    // Instagram/Discord/GitHub/LinkedIn/YouTube in the merchant's
                    // footer — which is exactly what happened, and it silently
                    // overwrote a store that had forked these lines to its own
                    // accounts. `Footer` gates the whole Connect block on
                    // `hasSocialLinks`, so with the prop absent the block does
                    // not render at all: no vendor links, no empty section. The
                    // `SocialLinks` type and icon map stay as they are, so a
                    // store can pass its own by forking this one line.
                    //
                    // Making that per-store DATA rather than a fork is an OPEN
                    // DECISION, not scheduled work: `store-social-links-platform-field`
                    // is a name to hold the decision by, NOT a ticket id — no
                    // ticket exists. What is undecided is whether to build the
                    // field at all, which would span the Mongo store document,
                    // the dashboard-api schema and resolver, the dashboard form,
                    // `packages/sdk` codegen and finally this file reading it —
                    // not a one-round change. Leaving it open is safe: with the
                    // prop gone, the worst a future template sync can do is drop
                    // a store's own links, never republish the vendor's. If the
                    // decision is ever taken, the repo convention is a
                    // `docs/tickets/<slug>.md`.
                    // Asserted by `app/layout-social-links.test.tsx`.
                  />
                  <Toaster />
                </CartProvider>
              </AuthProvider>
            </CheckoutModeProvider>
            </SwatchImageProvider>
          </CatalogDisplayProvider>
          </ClientThemeProvider>
        </BrandingIconsProvider>
      </body>
    </html>
  );
}
