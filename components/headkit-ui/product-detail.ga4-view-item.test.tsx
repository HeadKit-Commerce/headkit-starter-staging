// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * `view_item` fires once per VARIANT a shopper looks at — never once per
 * render.
 *
 * The PDP builds its GA4 item (`ga4Item`) on every render and keys the
 * `view_item` effect on `ga4ViewItemKey`, the string `item_id|price`, rather
 * than on the object. That indirection is the whole reason the object does not
 * need to be memoized: `react-hooks/preserve-manual-memoization` reported the
 * former `useMemo` because nothing reads the object's identity, and React
 * Compiler is not enabled in this app, so there is no compiler cache waiting to
 * take the memo's place. Dropping the memo is therefore only safe while the
 * effect stays keyed on the string.
 *
 * This file pins that behaviour from the outside — through `window.dataLayer`,
 * which is what the store's GTM container actually reads (see
 * `lib/ga4-ecommerce.ts`). The real `lib/ga4-ecommerce` module runs; only the
 * global array is supplied. A dep array widened to `[ga4Item]` re-fires
 * `view_item` on the quantity click in the first test, and a `view_item` that
 * stopped following the selected variation fails the second.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
  NoopObserver;

const MEMORY_STORE = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string): string | null => MEMORY_STORE.get(k) ?? null,
    setItem: (k: string, v: string): void => void MEMORY_STORE.set(k, v),
    removeItem: (k: string): void => void MEMORY_STORE.delete(k),
    clear: (): void => MEMORY_STORE.clear(),
  },
});

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
  addToCartAction: async (): Promise<{ success: boolean }> => ({
    success: true,
  }),
  addToCartMultiAction: async (): Promise<{ success: boolean }> => ({
    success: true,
  }),
}));
vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: (): {
    cartData: null;
    setCartData: () => void;
    toggleCart: () => void;
  } => ({
    cartData: null,
    setCartData: (): void => {},
    toggleCart: (): void => {},
  }),
}));
vi.mock("@/components/checkout/checkout-mode-provider", () => ({
  useIsQuoteMode: (): boolean => false,
}));

// Heavy leaves this test has no opinion about (same set as
// product-detail.stock-agreement.test.tsx).
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

import { ProductDetail } from "@/components/headkit-ui/product-detail";

interface Ga4Event {
  event?: string;
  ecommerce?: {
    items?: Array<{ item_id?: string; price?: number; item_variant?: string }>;
  };
}

/** Every `view_item` push, in order, as GTM would see them. */
function viewItems(): Ga4Event[] {
  return ((window.dataLayer ?? []) as Ga4Event[]).filter(
    (entry) => entry.event === "view_item",
  );
}

const SIZES = [
  { size: "61", sku: "ALLEZ-AGAVE-61", price: "1359" },
  { size: "52", sku: "ALLEZ-AGAVE-52", price: "1459" },
  { size: "49", sku: "ALLEZ-AGAVE-49", price: "1359" },
];

function variableProduct(): unknown {
  return {
    id: 277400,
    slug: "2027-specialized-allez-sprint-frameset",
    name: "2027 Specialized Allez Sprint Frameset",
    type: "VARIABLE",
    sku: "ALLEZ-PARENT",
    stockStatus: "instock",
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
          {
            name: "Agave Sunset",
            slug: "agave-sunset",
            swatchColor: "#8a9a5b",
          },
        ],
      },
      {
        id: 2,
        name: "Size",
        slug: "pa_size",
        variation: true,
        fullOptions: SIZES.map((s) => ({ name: s.size, slug: s.size })),
      },
    ],
    variations: SIZES.map((s, index) => ({
      id: 277400 + index,
      sku: s.sku,
      stockStatus: "instock",
      stockQuantity: 10,
      price: s.price,
      regularPrice: s.price,
      onSale: false,
      images: [],
      attributes: [
        { key: "pa_color", value: "agave-sunset" },
        { key: "pa_size", value: s.size },
      ],
    })),
  };
}

function mount(): { root: Root; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <ProductDetail
        product={variableProduct() as never}
        productBasePath="/shop/bikes/2027-specialized-allez-sprint-frameset"
        initialColor="agave-sunset"
      />,
    );
  });
  return { root, host };
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no button labelled ${label}`);
  return found as HTMLButtonElement;
}

/** The quantity stepper's "+" — a re-render that changes no GA4 field. */
function quantityPlus(host: HTMLElement): HTMLButtonElement {
  const found = host.querySelector<HTMLButtonElement>(
    'button[aria-label*="ncrease"], button[aria-label*="plus" i]',
  );
  if (found) return found;
  // No accessible name in this build: the stepper is the pair of icon-only
  // buttons flanking the quantity readout, and "+" is the second.
  const iconOnly = Array.from(host.querySelectorAll("button")).filter(
    (b) => (b.textContent ?? "").trim() === "" && b.querySelector("svg"),
  );
  const plus = iconOnly[1];
  if (!plus) throw new Error("no quantity stepper button rendered");
  return plus as HTMLButtonElement;
}

describe("PDP view_item", () => {
  it("pushes one view_item on mount and none on a render that changes no GA4 field", () => {
    window.dataLayer = [];
    const { root, host } = mount();
    try {
      expect(
        viewItems(),
        "positive control: the PDP reported a view_item at all",
      ).toHaveLength(1);
      expect(viewItems()[0]?.ecommerce?.items?.[0]?.item_id).toBe(
        "ALLEZ-AGAVE-61",
      );

      // Quantity is GA4 `quantity` on add_to_cart, never on view_item, so this
      // click re-renders the PDP without moving the view_item key. The object
      // identity DOES change (it is rebuilt every render) — which is the point:
      // a dep array on the object would fire a second, bogus product view here.
      act(() => {
        quantityPlus(host).click();
      });

      expect(viewItems()).toHaveLength(1);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("pushes a further view_item for each variant whose identity or price moves", () => {
    window.dataLayer = [];
    const { root, host } = mount();
    try {
      act(() => {
        button(host, "52").click();
      });
      act(() => {
        button(host, "49").click();
      });

      const items = viewItems().map((e) => ({
        item_id: e.ecommerce?.items?.[0]?.item_id,
        price: e.ecommerce?.items?.[0]?.price,
      }));

      expect(items).toEqual([
        { item_id: "ALLEZ-AGAVE-61", price: 1359 },
        { item_id: "ALLEZ-AGAVE-52", price: 1459 },
        { item_id: "ALLEZ-AGAVE-49", price: 1359 },
      ]);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
