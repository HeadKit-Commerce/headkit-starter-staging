import { productToMarkdown } from "@/lib/markdown/product";
import {
  markdownNotFound,
  markdownResponse,
  markdownUnavailable,
} from "@/lib/markdown/response";
import { readMirrorStore } from "@/lib/markdown/store-context";
import { getCachedProduct } from "@/lib/product-cache";

interface Props {
  params: Promise<{ slug: string[] }>;
}

/**
 * Markdown twin of `/products/{slug}`.
 *
 * Reads the SAME `getCachedProduct` entry the PDP routes read, so a product the
 * storefront has rendered costs no origin request here, and a product it has not
 * costs the one read the PDP would have paid next. `Link: rel="canonical"` names
 * the nested `/shop/...` URL (`productPath`), not the flat one asked for.
 *
 * A colourway (`/products/{slug}/{colour}`) has its own HTML page and no
 * mirror: answering with the base product under a canonical that is not the
 * page the agent asked about would be a wrong answer, so it is a 404.
 */
export async function GET(
  _request: Request,
  { params }: Props,
): Promise<Response> {
  const { slug } = await params;
  const [productSlug, ...extra] = slug;
  if (!productSlug || extra.length > 0) return markdownNotFound();

  const store = await readMirrorStore();
  if (!store) return markdownUnavailable();

  const product = await getCachedProduct(productSlug);
  if (!product) return markdownNotFound();

  return markdownResponse(productToMarkdown(product, store));
}
