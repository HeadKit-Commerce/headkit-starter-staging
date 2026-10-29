import {
  buildProductListFilter,
  collectionPathFromCategory,
  DEFAULT_FILTER_VALUES,
} from "@/components/headkit-ui/collection/utils";
import { CATALOG_PAGE_SIZE } from "@/components/headkit-ui/catalog-grid";
import { getCachedCatalogPage } from "@/lib/catalog-cache";
import {
  getCategoryData,
  parseCollectionSlug,
  STATIC_GEN_PLACEHOLDER_SLUG,
} from "@/lib/collection-canonical";
import { collectionToMarkdown } from "@/lib/markdown/collection";
import {
  markdownNotFound,
  markdownResponse,
  markdownUnavailable,
} from "@/lib/markdown/response";
import { readMirrorStore } from "@/lib/markdown/store-context";

interface Props {
  params: Promise<{ slug: string[] }>;
}

/**
 * Markdown twin of `/collections/{category…}`.
 *
 * Page 1 only, in the store's default order, read through the same two
 * `"use cache"` entries the HTML collection route awaits (`getCategoryData`,
 * `getCachedCatalogPage` with the same filter), so the mirror adds no origin
 * read the page was not already making.
 *
 * `Link: rel="canonical"` is the category's own ancestry, not the path asked
 * for: a flat `/collections/{child}` is answered here, not redirected.
 *
 * A facet URL (`/collections/{category}/f/{filter}`) is a 404: its product set
 * is a different page, and listing the unfiltered products under it would be
 * wrong.
 */
export async function GET(
  _request: Request,
  { params }: Props,
): Promise<Response> {
  const { slug } = await params;
  if (slug[0] === STATIC_GEN_PLACEHOLDER_SLUG) return markdownNotFound();
  const { categorySlug, filterSlug } = parseCollectionSlug(slug);
  if (!categorySlug || filterSlug) return markdownNotFound();

  const store = await readMirrorStore();
  if (!store) return markdownUnavailable();

  const { category } = await getCategoryData(categorySlug);
  if (!category) return markdownNotFound();

  const filter = buildProductListFilter(
    { ...DEFAULT_FILTER_VALUES, page: 1 },
    { categorySlug, defaultSort: store.defaultCollectionSort },
  );
  const page = await getCachedCatalogPage(filter, 1, CATALOG_PAGE_SIZE, {
    kind: "category",
    slug: categorySlug,
  });

  return markdownResponse(
    collectionToMarkdown(category, {
      origin: store.origin,
      pathname: collectionPathFromCategory(category),
      currency: store.currency,
      hidePrices: store.hidePrices,
      products: page.products,
      total: page.total,
    }),
  );
}
