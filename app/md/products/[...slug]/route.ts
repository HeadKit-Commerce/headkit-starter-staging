import { getBranding } from "@/lib/branding";
import { productToMarkdown } from "@/lib/markdown/product";
import { markdownHeaders } from "@/lib/markdown/representation";
import { getCachedProduct } from "@/lib/product-cache";
import { resolveSiteUrl } from "@/lib/site-url";
import { getStoreCurrency } from "@/lib/utils";

interface Props {
  params: Promise<{ slug: string[] }>;
}

export async function GET(
  _request: Request,
  { params }: Props,
): Promise<Response> {
  const { slug } = await params;
  const productSlug = slug?.[0];
  if (!productSlug) {
    return new Response("Not Found", { status: 404 });
  }

  const product = await getCachedProduct(productSlug);
  if (!product) {
    return new Response("Not Found", { status: 404 });
  }

  const { storeSettings } = await getBranding();
  const siteUrl = resolveSiteUrl(storeSettings.domain);
  if (!siteUrl) {
    return new Response("Site URL unavailable", { status: 503 });
  }

  const body = productToMarkdown(product, {
    siteUrl,
    currency: getStoreCurrency(),
  });

  return new Response(body, {
    headers: markdownHeaders({
      cacheControl: "public, max-age=3600, stale-while-revalidate=86400",
      pathname: `/products/${productSlug}`,
      siteUrl: storeSettings.domain,
    }),
  });
}
