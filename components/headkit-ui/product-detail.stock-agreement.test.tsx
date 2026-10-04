// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LiveAvailability } from "@/components/headkit-ui/live-availability";
import type { StockSnapshot } from "@/components/headkit-ui/live-availability";

/**
 * The availability line and the Add to Bag button must never disagree about the
 * SAME selected variation.
 *
 * They used to resolve stock from two different objects. The line came from a
 * server slot (`product-stock.tsx`) keyed to the COLOURWAY IN THE URL, which
 * picks the first variation in payload order carrying that colour — a variation
 * of an arbitrary size — while the button reads `selectedVariation`, the full
 * attribute match. Payload order and display order are not the same order, so
 * the two picked different variations from first paint and diverged in verdict
 * the moment a shopper clicked a size: a green "In Stock" line above an
 * "Out of stock" button, ~40px apart. Measured at 36.3% of colourway PDPs on
 * one store (`260925-bs-variable-stock-out-of-stock`).
 *
 * The availability line is `LiveAvailability`, fed the same variation stock the
 * button falls back to, and it publishes the selected variation so the button
 * follows it. The invariant asserted here is the AGREEMENT, not the copy: the
 * availability status and the button verdict are compared to each other for
 * one selection, before and after a size click.
 *
 * Both halves are load-bearing. A test that only asserted the out-of-stock
 * state would stay green under a "fix" that always says Out of Stock, and a
 * test that omitted `stockSlot` would be green under the bug itself — the slot
 * is what used to render a size-blind line. The slot passed here is
 * `LiveAvailability` with the fixture's own variations.
 *
 * What this does NOT cover:
 * - one product fixture (colour + size, six sizes, one colourway);
 * - the server slot's OWN resolution — `product-stock.test.tsx` covers that,
 *   and states there that the pick is size-blind by construction;
 * - the prerendered HTML. No jsdom test can see the static shell; that is
 *   `e2e/pdp-variants.spec.ts` and `scripts/static-shell-split.ts`. The shell
 *   is unchanged because `selectedAttributes` is seeded on the server from the
 *   first variation matching `initialColor` — the same variation the slot picks.
 * - the simple-product path, which keeps the slot; that is a separate test
 *   below and needs no interaction.
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

// The PDP restores a remembered size from localStorage in a mount effect; this
// environment has no storage, and an empty store is the right fixture anyway
// (a remembered size would make the default selection non-deterministic).
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

// Server actions: nothing here adds to a cart.
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

// Heavy leaves this test has no opinion about. The availability line, the
// swatches and the ATC button are all rendered for real.
vi.mock("@/components/headkit-ui/product-image-gallery", () => ({
  ProductImageGallery: (): null => null,
}));
vi.mock("@/components/stripe/payment-messaging", () => ({
  PaymentMethodMessaging: (): null => null,
}));
vi.mock("@/components/headkit-ui/product-enquiry", () => ({
  ProductEnquiry: (): null => null,
}));
// `SizeChartTrigger` pulls in a server action module that constructs the SDK at
// import time, which needs a public key this test has no business supplying.
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

import { ProductDetail } from "@/components/headkit-ui/product-detail";

interface Variation {
  id: number;
  color: string;
  size: string;
  stockStatus: string;
  stockQuantity: number;
}

/**
 * §4.1 of the report, verbatim: `2027-specialized-allez-sprint-frameset`.
 * Payload order for the colourway is 61, 58, 56, 54, 52, 49 while the size
 * options render 49 → 61, which is why the two resolvers picked different
 * variations before anything was clicked.
 */
const VARIATIONS: Variation[] = [
  {
    id: 277413,
    color: "agave-sunset",
    size: "61",
    stockStatus: "onbackorder",
    stockQuantity: 0,
  },
  {
    id: 277414,
    color: "agave-sunset",
    size: "58",
    stockStatus: "onbackorder",
    stockQuantity: 0,
  },
  {
    id: 277415,
    color: "agave-sunset",
    size: "56",
    stockStatus: "onbackorder",
    stockQuantity: 0,
  },
  {
    id: 277416,
    color: "agave-sunset",
    size: "54",
    stockStatus: "onbackorder",
    stockQuantity: 0,
  },
  {
    id: 277417,
    color: "agave-sunset",
    size: "52",
    stockStatus: "outofstock",
    stockQuantity: 0,
  },
  {
    id: 277420,
    color: "agave-sunset",
    size: "49",
    stockStatus: "onbackorder",
    stockQuantity: 0,
  },
];

const SIZE_ORDER = ["49", "52", "54", "56", "58", "61"];

function variableProduct(): unknown {
  return {
    id: 277400,
    slug: "2027-specialized-allez-sprint-frameset",
    name: "2027 Specialized Allez Sprint Frameset",
    type: "VARIABLE",
    // The parent is deliberately a THIRD answer: if either element ever falls
    // back to it, the agreement assertions below still hold but the copy
    // assertions do not.
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
        fullOptions: SIZE_ORDER.map((s) => ({ name: s, slug: s })),
      },
    ],
    variations: VARIATIONS.map((v) => ({
      id: v.id,
      stockStatus: v.stockStatus,
      stockQuantity: v.stockQuantity,
      price: "1359",
      regularPrice: "1359",
      onSale: false,
      images: [],
      attributes: [
        { key: "pa_color", value: v.color },
        { key: "pa_size", value: v.size },
      ],
    })),
  };
}

function simpleProduct(): unknown {
  return {
    id: 99001,
    slug: "muc-off-ludicrous-af-chain-lubricant-50ml",
    name: "Muc-Off Ludicrous AF Chain Lubricant 50ml",
    type: "SIMPLE",
    stockStatus: "onbackorder",
    stockQuantity: -1,
    price: "39",
    regularPrice: "39",
    salePrice: null,
    onSale: false,
    description: "",
    shortDescription: "",
    images: [],
    tags: [],
    attributes: [],
    variations: [],
  };
}

/**
 * Mounts the real `ProductDetail` the way the PDP route does: the canonical base
 * path, the colourway from the URL segment, and a server `stockSlot`. The
 * colourway arguments are the whole point — `useServerStock` is only ever true
 * on a colourway URL whose colour the shopper has not changed, which is exactly
 * the state the bug lived in.
 */
function snapshotOf(product: unknown): StockSnapshot {
  const source = product as {
    stockStatus: string;
    stockQuantity: number | null;
    variations: Array<{
      id: number;
      stockStatus: string;
      stockQuantity: number | null;
      attributes: Array<{ key: string; value: string }>;
    }>;
  };
  return {
    stockStatus: source.stockStatus,
    stockQuantity: source.stockQuantity,
    variations: source.variations.map((variation) => ({
      id: variation.id,
      stockStatus: variation.stockStatus,
      stockQuantity: variation.stockQuantity,
      attributes: variation.attributes,
    })),
  };
}

function mount(
  product: unknown,
  opts: { basePath?: string; initialColor?: string } = {},
): { root: Root; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <ProductDetail
        product={product as never}
        {...(opts.basePath ? { productBasePath: opts.basePath } : {})}
        {...(opts.initialColor ? { initialColor: opts.initialColor } : {})}
        stockSlot={<LiveAvailability snapshot={snapshotOf(product)} />}
      />,
    );
  });
  return { root, host };
}

const COLOURWAY = {
  basePath: "/shop/bikes/2027-specialized-allez-sprint-frameset",
  initialColor: "agave-sunset",
};

/** The availability line's own machine-readable verdict. */
function availabilityStatus(host: HTMLElement): string | null {
  const line = host.querySelector(".headkit-availability-status");
  return line?.getAttribute("data-status") ?? null;
}

function availabilityLabel(host: HTMLElement): string {
  return (
    host.querySelector(".headkit-availability-status")?.textContent?.trim() ??
    ""
  );
}

/**
 * Every Add to Bag button, found by the only two labels this fixture produces.
 * The PDP renders a primary one and a sticky one; both must carry the same
 * verdict, so they are read together rather than by picking the first.
 */
function atcButtons(host: HTMLElement): HTMLButtonElement[] {
  const buttons = Array.from(host.querySelectorAll("button")).filter((b) =>
    /add to cart|out of stock/i.test(b.textContent ?? ""),
  );
  if (buttons.length === 0) throw new Error("no add-to-cart button rendered");
  return buttons as HTMLButtonElement[];
}

/** The button verdict. Throws if the primary and sticky buttons disagree. */
function buttonSaysOutOfStock(host: HTMLElement): boolean {
  const verdicts = atcButtons(host).map((b) =>
    /out of stock/i.test(b.textContent ?? ""),
  );
  if (new Set(verdicts).size > 1) {
    throw new Error("the primary and sticky add-to-cart buttons disagree");
  }
  return verdicts[0]!;
}

function atcDisabled(host: HTMLElement): boolean {
  return atcButtons(host).every((b) => b.disabled);
}

function sizeChip(host: HTMLElement, label: string): HTMLButtonElement {
  const chip = Array.from(host.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === label,
  );
  if (!chip) throw new Error(`no size chip ${label}`);
  return chip as HTMLButtonElement;
}

describe("PDP stock agreement", () => {
  it("keeps the availability line and the Add to Bag button on the same variation across a size click", () => {
    const { root, host } = mount(variableProduct(), COLOURWAY);
    try {
      // Default selection is the first payload-order variation for the
      // colourway — size 61, onbackorder. In stock, and both elements say so.
      expect(
        availabilityStatus(host),
        "positive control: the availability line rendered at all",
      ).toBe("ON_BACKORDER");
      expect(buttonSaysOutOfStock(host)).toBe(false);
      expect(atcDisabled(host)).toBe(false);

      act(() => {
        sizeChip(host, "52").click();
      });

      // Size 52 is variation 277417: outofstock. Both elements must follow it.
      expect(availabilityStatus(host)).toBe("OUT_OF_STOCK");
      expect(availabilityLabel(host)).toContain("Out of Stock");
      expect(buttonSaysOutOfStock(host)).toBe(true);
      expect(atcDisabled(host)).toBe(true);

      // …and back. A fix that pinned the line to "Out of Stock" would fail here.
      act(() => {
        sizeChip(host, "49").click();
      });
      expect(availabilityStatus(host)).toBe("ON_BACKORDER");
      expect(buttonSaysOutOfStock(host)).toBe(false);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("agrees on every size, with the line and the button read from the same verdict", () => {
    const { root, host } = mount(variableProduct(), COLOURWAY);
    try {
      for (const size of SIZE_ORDER) {
        act(() => {
          sizeChip(host, size).click();
        });
        const expected = VARIATIONS.find((v) => v.size === size)!.stockStatus;
        expect(
          buttonSaysOutOfStock(host),
          `size ${size}: the button must match the variation`,
        ).toBe(expected === "outofstock");
        expect(
          availabilityStatus(host) === "OUT_OF_STOCK",
          `size ${size}: the availability line must agree with the button`,
        ).toBe(buttonSaysOutOfStock(host));
      }
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });

  it("agrees on a simple product, whose line is the streamed slot", () => {
    const { root, host } = mount(simpleProduct());
    try {
      expect(availabilityStatus(host)).toBe("ON_BACKORDER");
      expect(buttonSaysOutOfStock(host)).toBe(false);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});
