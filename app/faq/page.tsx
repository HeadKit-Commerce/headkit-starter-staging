import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { Suspense } from "react";
import { cacheTag } from "next/cache";
import { cacheLifeForProfile } from "@/lib/cache-profile";
import { headkit as sdk } from "@/lib/sdk";
import { FAQPageJsonLD } from "@/components/seo/faq-page-json-ld";
import { makeSeoMetadata, storefrontUrl } from "@/lib/make-metadata";
import { getBranding } from "@/lib/branding";
import { EditorialContent } from "@/components/headkit-ui/editorial-content";
import { FaqList } from "@/components/headkit-ui/faq-list";
import { sanitizeFaqAnswers } from "@/lib/sanitize-faq";

async function getFaqPage() {
  "use cache";
  cacheLifeForProfile("days", "max");
  cacheTag("headkit:page:faq", "headkit:pages");
  // NOTE: sdk.faq.list() errors intentionally propagate (no `.catch(() => [])`).
  // Swallowing them cached "no FAQs" with cacheLife("days") — a transient fetch
  // failure rendered a permanently blank page. A rejected fetch now bubbles to
  // app/error.tsx ("Something went wrong" + Try again) and the failed result is
  // NOT written to the cache, so the next request retries.
  const [page, faqs] = await Promise.all([
    sdk.content.get("faq", "PAGE").catch(() => null),
    sdk.faq.list(),
  ]);
  // Inside "use cache": sanitize-html's style parser is not deterministic,
  // and the client accordion must not import it.
  return [page, sanitizeFaqAnswers(faqs)] as const;
}

/**
 * Empty Yoast/CMS SEO must not hide FAQ from indexing by default.
 * Robots are inherited from the root layout, which gates on the request host +
 * store allowIndexing.
 */
export async function generateMetadata(): Promise<Metadata> {
  try {
    const [[page], { seoSettings, storeSettings }] = await Promise.all([
      getFaqPage(),
      getBranding(),
    ]);
    return await makeSeoMetadata(page?.seo ?? null, {
      title: page?.title?.trim() || "FAQ",
      description:
        "Frequently asked questions — answers about orders, shipping, and more.",
      storeName: storeSettings.name ?? undefined,
      allowIndexing: seoSettings.allowIndexing,
      canonical: storefrontUrl("/faq", storeSettings.domain),
      siteUrl: storeSettings.domain,
    });
  } catch (error) {
    unstable_rethrow(error);
    return await makeSeoMetadata(null, {
      title: "FAQ",
      description:
        "Frequently asked questions — answers about orders, shipping, and more.",
    });
  }
}

/**
 * Instant Navigation (Next.js 16.3) — sync App Shell + Suspense streaming.
 * @see https://nextjs.org/docs/app/guides/instant-navigation
 */
export const instant = true;

export default function FAQPage() {
  return (
    <Suspense
      fallback={
        <div className="px-5 py-10 md:px-10 md:py-14">
          <div className="mb-10 max-w-md space-y-3 md:mb-14">
            <div className="h-10 w-32 rounded bg-gray-100" />
            <div className="h-4 w-full max-w-sm rounded bg-gray-100" />
          </div>
        </div>
      }
    >
      <FaqRoute />
    </Suspense>
  );
}

async function FaqRoute() {
  const [page, faqs] = await getFaqPage();
  const title = page?.title?.trim() || "FAQ";

  return (
    <>
      {faqs.length > 0 && <FAQPageJsonLD items={faqs} />}

      <div className="px-5 py-10 md:px-10 md:py-14">
        <header className="mb-10 max-w-md md:mb-14">
          <h1 className="mb-4 text-3xl text-primary md:text-4xl">{title}</h1>
          {page?.content ? (
            <div className="text-base text-primary [&_.prose]:text-base [&_p]:text-base [&_p]:leading-normal">
              <EditorialContent html={page.content} />
            </div>
          ) : null}
        </header>

        {faqs.length > 0 ? (
          <FaqList faqs={faqs} />
        ) : (
          <div className="max-w-md py-8">
            <p className="text-lg font-medium text-primary">
              No FAQs published yet
            </p>
            <p className="mt-2 text-sm text-gray-800">
              Check back soon — answers to common questions will appear here.
            </p>
          </div>
        )}
      </div>
    </>
  );
}
