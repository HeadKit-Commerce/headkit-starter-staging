import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// `product-stock.tsx` imports `lib/product-brand`, which imports `lib/sdk`.
// `createClientSDK()` reads the public key at module load and throws when it
// is unset. The other two keys are what `lib/env` requires on the server.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_HEADKIT_PUBLIC_KEY ??= "pk_test";
  process.env.NEXT_PUBLIC_GRAPHQL_URL ??= "http://localhost:4000/graphql";
  process.env.HEADKIT_PRIVATE_KEY ??= "sk_test";
});

/**
 * Taking the size-blind server slot off variable products costs the static
 * shell NOTHING, and that is a property of the seed rather than luck.
 *
 * `ProductStock` picks the first variation in payload order carrying the
 * colourway's colour. `ProductDetail` seeds `selectedAttributes` on the server
 * from `product.variations.find(<matches initialColor>)` — the SAME variation.
 * So the client-rendered `<AvailabilityStatus>` that now replaces the slot
 * renders the identical markup during SSR, and the prerendered HTML a crawler
 * (or a shopper with JavaScript off) receives is unchanged.
 *
 * This test renders BOTH and compares the availability line markup. If someone
 * changes either resolver — the slot's colour pick or the initial-selection
 * seed — so that the two diverge, the first paint of every colourway PDP
 * changes and this goes red, which is the only cheap signal for it.
 *
 * What this does NOT cover: the real build. Whether the line lands in the static
 * shell at all (rather than behind a postponed boundary) is a property of the
 * route, asserted by `app/products/[...slug]/page.composition.test.tsx` and
 * observable only on a built page via `scripts/static-shell-split.ts`. This
 * test is about the two markups being the same, not about where they land.
 */

vi.mock("next/navigation", () => ({
  usePathname: (): string => "/shop/bikes/allez-sprint/agave-sunset",
  useSearchParams: (): URLSearchParams => new URLSearchParams(),
  useRouter: (): {
    push: () => void;
    replace: () => void;
    prefetch: () => void;
  } => ({
    push: (): void => {},
    replace: (): void => {},
    prefetch: (): void => {},
  }),
}));
vi.mock("@/lib/cart-actions", () => ({
  addToCartAction: async (): Promise<unknown> => ({ success: true }),
  addToCartMultiAction: async (): Promise<unknown> => ({ success: true }),
}));
vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: (): unknown => ({
    cartData: null,
    setCartData: (): void => {},
    toggleCart: (): void => {},
  }),
}));
vi.mock("@/components/checkout/checkout-mode-provider", () => ({
  useIsQuoteMode: (): boolean => false,
}));
vi.mock("@/components/headkit-ui/product-image-gallery", () => ({
  ProductImageGallery: (): null => null,
}));
vi.mock("@/components/stripe/payment-messaging", () => ({
  PaymentMethodMessaging: (): null => null,
}));
vi.mock("@/components/headkit-ui/product-enquiry", () => ({
  ProductEnquiry: (): null => null,
}));
vi.mock("@/lib/size-guide-actions", () => ({
  getSizeGuidePageHtml: async (): Promise<string> => "",
}));
vi.mock("@/lib/ga4-ecommerce", () => ({
  buildAddToCart: (): unknown => ({}),
  buildAddToWishlist: (): unknown => ({}),
  buildViewItem: (): unknown => ({}),
  productToGa4Item: (): unknown => ({}),
  pushGa4Ecommerce: (): void => {},
}));
vi.mock("@/lib/product-cache", () => ({
  getLiveProductStock: async (): Promise<unknown> => PRODUCT,
  getCachedProduct: async (): Promise<unknown> => PRODUCT,
}));

import { ProductDetail } from "@/components/headkit-ui/product-detail";
import { ProductStock } from "@/components/headkit-ui/product-stock";

const BASE_PATH = "/shop/bikes/2027-specialized-allez-sprint-frameset";
const COLOR = "agave-sunset";

/** §4.1 of `260925-bs-variable-stock-out-of-stock`: payload order 61 → 49. */
const PRODUCT = {
  id: 277400,
  slug: "2027-specialized-allez-sprint-frameset",
  name: "2027 Specialized Allez Sprint Frameset",
  type: "VARIABLE",
  stockStatus: "onbackorder",
  stockQuantity: null,
  price: "1359",
  regularPrice: "1359",
  salePrice: null,
  onSale: false,
  description: "",
  shortDescription: "",
  images: [],
  tags: [],
  attributes: [
    {
      id: 1,
      name: "Color",
      slug: "pa_color",
      type: "color",
      variation: true,
      fullOptions: [
        { name: "Agave Sunset", slug: COLOR, swatchColor: "#8a9a5b" },
      ],
    },
    {
      id: 2,
      name: "Size",
      slug: "pa_size",
      variation: true,
      fullOptions: ["49", "52", "54", "56", "58", "61"].map((s) => ({
        name: s,
        slug: s,
      })),
    },
  ],
  variations: [
    ["61", "onbackorder", 0],
    ["58", "onbackorder", 0],
    ["56", "onbackorder", 0],
    ["54", "onbackorder", 0],
    ["52", "outofstock", 0],
    ["49", "onbackorder", 0],
  ].map(([size, stockStatus, stockQuantity], i) => ({
    id: 277413 + i,
    stockStatus,
    stockQuantity,
    price: "1359",
    regularPrice: "1359",
    onSale: false,
    images: [],
    attributes: [
      { key: "pa_color", value: COLOR },
      { key: "pa_size", value: size },
    ],
  })),
};

/** The availability line, lifted out of a larger markup string. */
function availabilityLine(html: string): string {
  const match = html.match(
    /<div class="headkit-availability-status[\s\S]*?<\/span>[^<]*<\/div>/,
  );
  if (!match) throw new Error("no availability line in the rendered markup");
  return match[0];
}

describe("PDP availability line: server slot vs client render", () => {
  it("server-renders the identical line the size-blind slot would have shipped", async () => {
    const slotMarkup = renderToStaticMarkup(
      (await ProductStock({
        productSlug: PRODUCT.slug,
        colorSlug: COLOR,
      })) as React.JSX.Element,
    );

    const detailMarkup = renderToStaticMarkup(
      <ProductDetail
        product={PRODUCT as never}
        productBasePath={BASE_PATH}
        initialColor={COLOR}
      />,
    );

    expect(
      availabilityLine(detailMarkup),
      "the prerendered availability line changed — either the slot's colour pick or the initial-selection seed moved, and every colourway PDP's first paint moved with it",
    ).toBe(availabilityLine(slotMarkup));
  });

  it("is a REAL comparison: a different colour's first variation renders different markup", async () => {
    // Negative control. Without this, the assertion above would also pass if
    // `availabilityLine` matched something constant.
    const other = {
      ...PRODUCT,
      variations: [
        {
          ...PRODUCT.variations[0]!,
          stockStatus: "outofstock",
        },
        ...PRODUCT.variations.slice(1),
      ],
    };
    const shifted = renderToStaticMarkup(
      <ProductDetail
        product={other as never}
        productBasePath={BASE_PATH}
        initialColor={COLOR}
      />,
    );
    const baseline = renderToStaticMarkup(
      <ProductDetail
        product={PRODUCT as never}
        productBasePath={BASE_PATH}
        initialColor={COLOR}
      />,
    );
    expect(availabilityLine(shifted)).not.toBe(availabilityLine(baseline));
  });
});
