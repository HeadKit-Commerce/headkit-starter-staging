// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

/**
 * An add-to-cart WooCommerce refuses for stock arrives from commerce as
 * `CART_STOCK_UNAVAILABLE` with a sentence written for the shopper (the unit
 * may be held by another checkout, or the bag asks for more than is left).
 * It is not an add-on rejection, so the PDP must show that sentence rather
 * than the add-on banner's "review your options above", which sends the
 * shopper looking for a field that is not wrong. Every other unattributable
 * code keeps the add-on copy.
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

const hoisted = vi.hoisted(() => ({ addToCart: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: (): string => "/products/wedge-cover",
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
  addToCartAction: (...args: unknown[]): unknown => hoisted.addToCart(...args),
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

import { ProductDetail } from "@/components/headkit-ui/product-detail";

const STOCK_SENTENCE =
  "There isn't enough of this item available to add that quantity right now. Another shopper may be checking out with the last of it, so please try again in a few minutes or add fewer.";
const ADDON_COPY =
  "We couldn't add this to your cart. Please review your options above and try again.";

function product(): unknown {
  return {
    id: 264347,
    slug: "wedge-cover",
    name: "Wedge Cover",
    type: "SIMPLE",
    stockStatus: "instock",
    stockQuantity: 1,
    price: "16.95",
    regularPrice: "16.95",
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

async function pressAddToCart(): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<ProductDetail product={product() as never} />);
  });
  const button = Array.from(host.querySelectorAll("button")).find((b) =>
    /add to cart/i.test(b.textContent ?? ""),
  );
  if (!button) throw new Error("no add-to-cart button rendered");
  await act(async () => {
    button.click();
  });
  return host;
}

function banner(host: HTMLElement): string {
  return host.querySelector('[role="alert"]')?.textContent?.trim() ?? "";
}

describe("PDP add-to-cart stock rejection", () => {
  beforeEach(() => {
    hoisted.addToCart.mockReset();
    document.body.innerHTML = "";
  });

  it("shows commerce's stock sentence, not the add-on banner copy", async () => {
    hoisted.addToCart.mockResolvedValue({
      success: false,
      error: STOCK_SENTENCE,
      addonError: { code: "CART_STOCK_UNAVAILABLE", message: STOCK_SENTENCE },
    });
    const host = await pressAddToCart();
    expect(hoisted.addToCart).toHaveBeenCalledTimes(1);
    expect(banner(host)).toBe(STOCK_SENTENCE);
    expect(host.textContent).not.toContain(ADDON_COPY);
  });

  it("decodes entities the way every other rendered message is decoded", async () => {
    hoisted.addToCart.mockResolvedValue({
      success: false,
      error: "x",
      addonError: {
        code: "CART_STOCK_UNAVAILABLE",
        message: "There isn&#039;t enough of this item available.",
      },
    });
    const host = await pressAddToCart();
    expect(banner(host)).toBe("There isn't enough of this item available.");
  });

  it("keeps the add-on copy for an unreviewed CART_REJECTED", async () => {
    hoisted.addToCart.mockResolvedValue({
      success: false,
      error: "The store rejected this cart operation.",
      addonError: {
        code: "CART_REJECTED",
        message: "The store rejected this cart operation.",
      },
    });
    const host = await pressAddToCart();
    expect(banner(host)).toBe(ADDON_COPY);
  });
});
