import {
  buildProductListFilter,
  DEFAULT_FILTER_VALUES,
} from "@/components/headkit-ui/collection/utils";
import { CATALOG_PAGE_SIZE } from "@/components/headkit-ui/catalog-grid";
import { getBranding } from "@/lib/branding";
import { getCachedCatalogPage } from "@/lib/catalog-cache";
import { getCategoryData } from "@/lib/collection-canonical";
import { collectionToMarkdown } from "@/lib/markdown/collection";
import { markdownHeaders } from "@/lib/markdown/representation";
import { resolveSiteUrl } from "@/lib/site-url";

interface Props {
  params: Promise<{ slug: string[] }>;
}

export async function GET(
  _request: Request,
  { params }: Props,
): Promise<Response> {
  const { slug } = await params;
  const categorySlug = slug?.[slug.length - 1];
  if (!categorySlug) {
    return new Response("Not Found", { status: 404 });
  }

  const { category } = await getCategoryData(categorySlug);
  if (!category) {
    return new Response("Not Found", { status: 404 });
  }

  const filter = buildProductListFilter(
    {
      ...DEFAULT_FILTER_VALUES,
      page: 1,
    },
    { categorySlug },
  );
  const page = await getCachedCatalogPage(filter, 1, CATALOG_PAGE_SIZE, {
    kind: "category",
    slug: categorySlug,
  });

  const { storeSettings } = await getBranding();
  const siteUrl = resolveSiteUrl(storeSettings.domain);
  if (!siteUrl) {
    return new Response("Site URL unavailable", { status: 503 });
  }

  const pathname = `/collections/${slug.join("/")}`;
  const body = collectionToMarkdown(category, {
    siteUrl,
    pathname,
    productNames: (page.products ?? [])
      .map((product) => product.name?.trim())
      .filter((name): name is string => Boolean(name))
      .slice(0, 24),
  });

  return new Response(body, {
    headers: markdownHeaders({
      cacheControl: "public, max-age=3600, stale-while-revalidate=86400",
      pathname,
      siteUrl: storeSettings.domain,
    }),
  });
}
