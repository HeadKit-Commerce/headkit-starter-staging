import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CartFieldsFragment } from "@headkit/sdk";

/**
 * A cart line the store already says it will not sell (it went out of stock
 * while it sat in the cart) is flagged on the line itself with the action the
 * shopper must take, because commerce refuses checkout until it is removed.
 */

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} />,
}));
vi.mock("@/components/icon", () => ({
  MinusIcon: () => <span />,
  PlusIcon: () => <span />,
  XIcon: () => <span />,
}));
vi.mock("@/components/headkit-ui/instant-link", () => ({
  InstantLink: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/cart-actions", () => ({
  getCartAction: vi.fn(),
  removeCartItemAction: vi.fn(),
  updateCartItemAction: vi.fn(),
}));
vi.mock("@/lib/cart-item-path", () => ({
  resolveCartItemPath: vi.fn().mockResolvedValue(null),
}));
let cartData: unknown = null;
vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: () => ({
    cartData,
    toggleCart: vi.fn(),
    isPending: false,
    optimisticRemoveItem: vi.fn(),
    optimisticUpdateQuantity: vi.fn(),
    startCartTransition: vi.fn(),
  }),
}));
vi.mock("@/components/checkout/checkout-mode-provider", () => ({
  useIsQuoteMode: () => false,
}));

const { CartItemRow } = await import("./cart-item");

type CartItem = CartFieldsFragment["items"][number];

function line(overrides: Partial<CartItem> = {}): CartItem {
  return {
    key: "k-small",
    id: "259987",
    slug: "base-layer",
    quantity: 1,
    name: "Base Layer",
    sku: "83883",
    stockQuantity: null,
    stockStatus: "instock",
    images: [{ src: "/x.png", alt: "", width: 0, height: 0 }],
    prices: { price: "17.27", regularPrice: "17.27", salePrice: "17.27" },
    totals: {
      lineTotal: "15.70",
      lineTotalTax: "1.57",
      lineSubtotal: "15.70",
      lineSubtotalTax: "1.57",
    },
    variation: [{ attribute: "Size", value: "Small" }],
    giftCard: null,
    addons: [],
    ...overrides,
  };
}

function render(item: CartItem): string {
  return renderToStaticMarkup(
    <CartItemRow
      item={item}
      currency={{ code: "AUD" }}
      onCartUpdate={vi.fn()}
    />,
  );
}

describe("cart line — item the store will not sell", () => {
  it("flags the attributed line with the remove action", () => {
    cartData = {
      issues: [
        {
          code: "OUT_OF_STOCK",
          message: "x",
          itemKey: "k-small",
          productName: "Base Layer - Small",
        },
      ],
    };
    const markup = render(line());
    expect(markup).toContain('data-testid="cart-item-unavailable"');
    expect(markup).toContain(
      "This item is no longer available — remove it to continue.",
    );
    expect(markup).toContain(">Remove</button>");
  });

  it("flags a line commerce marked sold out even without issues (older gateway)", () => {
    cartData = {};
    const markup = render(
      line({ stockStatus: "outofstock", stockQuantity: 0 }),
    );
    expect(markup).toContain('data-testid="cart-item-unavailable"');
  });

  it("does not flag a clean or backordered line", () => {
    cartData = {
      issues: [{ code: "OUT_OF_STOCK", message: "x", itemKey: "another-line" }],
    };
    expect(render(line())).not.toContain("cart-item-unavailable");
    expect(render(line({ stockStatus: "onbackorder" }))).not.toContain(
      "cart-item-unavailable",
    );
  });
});
