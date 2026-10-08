import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GravityForm } from "@/components/gravity-form-lazy";
import { ShopifyContactForm } from "@/components/shopify-contact-form";
import { shopifyContactSubscribeProps } from "@/lib/shopify-contact-subscribe";
import {
  makeSeoMetadata,
  seoFallbackDescription,
  storefrontUrl,
} from "@/lib/make-metadata";
import { getBranding } from "@/lib/branding";
import { EditorialContent } from "@/components/headkit-ui/editorial-content";
import { env } from "@/lib/env";
import { isShopifyStorefront } from "@/lib/shopify-storefront";
import { getPageData } from "@/app/[...slug]/page";

/**
 * Wholesale is a WordPress page (slug `wholesale`), restored from history —
 * it was removed in 62fd2ae9 while stores' navigation and footer still link it.
 *
 * Recovered rather than re-authored, then reconciled with the sibling static
 * routes: the page read now goes through the shared `getPageData` used by
 * /contact, so the cache directive, life and tag cannot drift from it. The
 * original's `cacheLife("max")` is deliberately NOT kept — `max` pins a
 * `notFound()` for the life of the deployment, so a page published after the
 * first miss would stay 404 forever.
 *
 * Woo: the Gravity Forms id is configuration, not a literal. Unset env →
 * content only, no form. Shopify: the built-in Online Store contact form
 * (Name / Email / Phone / Venue / Location / space notes) — not Gravity Forms.
 */
const WHOLESALE_SLUG = "wholesale";

/**
 * Blocking route so the `notFound()` below sets a real 404 rather than a 200
 * that streams the not-found UI. This route awaits its page read before
 * returning any markup and has no `<Suspense>` of its own; a store with no
 * `wholesale` WordPress page nonetheless advertised a healthy 200 under the
 * slug-derived title `Wholesale | …`. What decides the status code lives once
 * in "Setting a status code needs THREE conditions" in `apps/starter/AGENTS.md`
 * — `instant = false` is that section's declaration rule (this route blocks on
 * one cached read before responding), not the thing that sets the status. The
 * invariant is asserted in `app/not-found-status.test.ts`.
 */
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const [page, { seoSettings, storeSettings }] = await Promise.all([
    getPageData(WHOLESALE_SLUG),
    getBranding(),
  ]);
  if (!page) {
    return {
      title: "Wholesale",
      robots: { index: false, follow: false },
    };
  }
  return await makeSeoMetadata(page.seo ?? null, {
    title: page.title,
    description: seoFallbackDescription("page", page.title),
    canonical: storefrontUrl(`/${WHOLESALE_SLUG}`, storeSettings.domain),
    siteUrl: storeSettings.domain,
    allowIndexing: seoSettings.allowIndexing,
  });
}

export const ensureStatic = "navigation";

export default async function WholesalePage(): Promise<React.ReactElement> {
  const page = await getPageData(WHOLESALE_SLUG);

  if (!page) {
    return notFound();
  }

  const shopify = isShopifyStorefront(env);
  const wooFormId = env.NEXT_PUBLIC_WHOLESALE_FORM_ID;
  const subscribe = shopify ? await shopifyContactSubscribeProps() : null;

  return (
    <div className="px-5 py-10 md:px-10 md:py-16">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Left column — editorial content from WordPress / Shopify page */}
        <div>
          <h1 className="mb-6 text-3xl font-bold">{page.title}</h1>
          <EditorialContent html={page.content ?? ""} />
        </div>

        {shopify ? (
          <div>
            <ShopifyContactForm
              context="partnerships"
              variant="partnerships"
              subscribeEnabled={subscribe?.subscribeEnabled ?? false}
              subscribeLabel={subscribe?.subscribeLabel ?? ""}
            />
          </div>
        ) : wooFormId ? (
          <div>
            <GravityForm formId={wooFormId} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
