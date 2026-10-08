import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import { Suspense } from "react";
import { notFound, unstable_rethrow } from "next/navigation";
import { cacheLife, cacheTag } from "next/cache";
import { headkit as sdk } from "@/lib/sdk";
import { ProjectGrid } from "@/components/headkit-ui/project/project-grid";
import { SectionHeader } from "@/components/headkit-ui/section-header";
import { BreadcrumbJsonLD } from "@/components/seo/breadcrumb-json-ld";
import { Skeleton } from "@/components/ui/skeleton";
import { makeSeoMetadata, storefrontUrl } from "@/lib/make-metadata";
import { getBranding, getBrandingAssets } from "@/lib/branding";
import { TAG } from "@/lib/cache-tags";
import { decodeHtmlEntities } from "@/lib/utils";

/**
 * Satisfies Cache Components: `generateStaticParams` must not return [].
 * @see https://nextjs.org/docs/messages/blocking-route#generatestaticparams
 */
const STATIC_GEN_PLACEHOLDER_SLUG = "__hk_static_placeholder";

interface Props {
  params: Promise<{ slug: string[] }>;
}

function ClientPageSkeleton(): ReactNode {
  return (
    <div className="space-y-8 px-5 py-10 md:px-10">
      <Skeleton animated={false} className="mx-auto h-16 w-48" />
      <Skeleton animated={false} className="mx-auto h-8 w-64" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            animated={false}
            className="aspect-[4/3] w-full rounded-brand"
          />
        ))}
      </div>
    </div>
  );
}

async function getClient(clientSlug: string) {
  "use cache";
  cacheLife("days");
  cacheTag(TAG.client(clientSlug), TAG.clients, TAG.projects);
  return sdk.clients.get(clientSlug);
}

export async function generateStaticParams(): Promise<{ slug: string[] }[]> {
  return [{ slug: [STATIC_GEN_PLACEHOLDER_SLUG] }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const clientSlug = slug[slug.length - 1];
  if (!clientSlug || clientSlug === STATIC_GEN_PLACEHOLDER_SLUG) return {};
  try {
    const [client, { seoSettings, storeSettings }, { iconUrl }] =
      await Promise.all([
        getClient(clientSlug),
        getBranding(),
        getBrandingAssets(),
      ]);
    if (!client) return {};
    return await makeSeoMetadata(null, {
      title: decodeHtmlEntities(client.name),
      description: `Projects for ${decodeHtmlEntities(client.name)}`,
      storeName: storeSettings.name ?? undefined,
      brandingIconUrl: iconUrl ?? undefined,
      allowIndexing: seoSettings.allowIndexing,
      canonical: storefrontUrl(`/client/${clientSlug}`, storeSettings.domain),
      siteUrl: storeSettings.domain,
    });
  } catch (error) {
    unstable_rethrow(error);
    // The content component lets the same failure throw, which renders
    // `app/error.tsx` at HTTP 200 — an indexable status. Returning `{}` here
    // let that body inherit the store's indexable default, where the late
    // `notFound()` it replaced got Next's own injected `noindex`. A client
    // that EXISTS must never be offered to crawlers as an error page.
    return { robots: { index: false, follow: false } };
  }
}

/**
 * Blocking route so `notFound()` can still set a real 404: under Cache
 * Components the response commits as 200 the moment a `<Suspense>` fallback
 * renders, and a `notFound()` raised inside the boundary only earns a `noindex`
 * meta tag. The existence check therefore runs in the default export, above the
 * boundary, forfeiting this route's App Shell. What that costs, what else can
 * commit the 200 first, and why `instant` is NOT one of those things live once
 * in "Setting a status code needs THREE conditions" in `apps/starter/AGENTS.md`.
 * `instant = false` is that section's declaration rule: this route blocks on a
 * cached read before it responds.
 */
export const instant = false;

export const ensureStatic = "navigation";

export default async function Page(props: Props): Promise<ReactNode> {
  // Pre-commit gate — an unknown client slug must answer 404. The `"use cache"`
  // client read dedupes with `ClientPageContent`'s own read below.
  const { slug } = await props.params;
  const clientSlug = slug[slug.length - 1];
  if (!clientSlug || clientSlug === STATIC_GEN_PLACEHOLDER_SLUG) notFound();
  if (!(await getClient(clientSlug))) notFound();

  return (
    <Suspense fallback={<ClientPageSkeleton />}>
      <ClientPageContent {...props} />
    </Suspense>
  );
}

async function ClientPageContent({
  params,
}: Props): Promise<React.ReactElement> {
  const { slug } = await params;
  const clientSlug = slug[slug.length - 1];
  if (!clientSlug || clientSlug === STATIC_GEN_PLACEHOLDER_SLUG) {
    return notFound();
  }

  // Deliberately UNCAUGHT, and the reason is NOT the status code. This
  // component runs BELOW the `<Suspense>` that already committed the 200, so
  // neither a `notFound()` nor a thrown error can set a status here — both
  // answer 200. What changes is the BODY and its robots meta: a late
  // `notFound()` tells a shopper this client does not exist when the gate in
  // the default export just proved it does, while a throw renders
  // `app/error.tsx`, is loggable, and commits no wrong content as the page.
  // `generateMetadata`'s catch marks that render `noindex` so the error body
  // is never offered to a crawler. The miss case is the null below, owned
  // jointly with that gate.
  const client = await getClient(clientSlug);
  if (!client) return notFound();

  const name = decodeHtmlEntities(client.name);
  const projects = client.projects ?? [];
  const breadcrumbs = [
    { name: "Home", href: "/" },
    { name: "Projects", href: "/projects" },
    { name, href: `/client/${clientSlug}` },
  ];

  return (
    <>
      <BreadcrumbJsonLD items={breadcrumbs} />
      <div className="overflow-hidden py-10 lg:py-16">
        <div className="flex flex-col items-center gap-6 px-5 md:px-10">
          {client.thumbnail ? (
            <div className="relative h-16 w-48">
              <Image
                src={client.thumbnail}
                alt={name}
                fill
                className="object-contain object-center"
                sizes="192px"
                priority
              />
            </div>
          ) : null}
          <SectionHeader
            title={name}
            description={
              projects.length === 1
                ? "1 project"
                : `${projects.length} projects`
            }
            className="text-center"
          />
        </div>
        <div className="mt-10">
          <ProjectGrid projects={projects} />
        </div>
      </div>
    </>
  );
}
