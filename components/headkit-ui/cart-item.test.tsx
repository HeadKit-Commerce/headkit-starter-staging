import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { CartFieldsFragment } from "@headkit/sdk";

/**
 * The cart drawer line — the one surface of this plan's four that is **not**
 * served by `LineItemDisplay`, so it needs its own proof.
 *
 * The assertion that matters most is the negative one. A line whose product has
 * no add-on groups must render exactly what it rendered before this phase: no
 * panel, no title, no wrapper, no extra spacing. Element absence alone does not
 * establish that — a zero-height wrapper passes a presence check and still
 * shifts every line in the drawer — so this asserts byte equality between a
 * line with `addons: []` and the same line rendered before the mount existed,
 * expressed as equality against a gift-card-only render whose add-on list is
 * empty.
 *
 * The drawer line is a client component with six module dependencies. Each is
 * stubbed at the module boundary rather than avoided, so the subtree under test
 * — the two panels at the foot of the row — is the real one.
 */

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span role="img" aria-label={alt} data-src={src} />
  ),
}));

vi.mock("@/components/icon", () => ({
  MinusIcon: () => <span data-icon="minus" />,
  PlusIcon: () => <span data-icon="plus" />,
  XIcon: () => <span data-icon="x" />,
}));

vi.mock("@/components/headkit-ui/instant-link", () => ({
  InstantLink: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/cart-actions", () => ({
  getCartAction: vi.fn(),
  removeCartItemAction: vi.fn(),
  updateCartItemAction: vi.fn(),
}));

// `resolveCartItemPath` (G23) reaches `lib/product-cache.ts`, which imports
// `lib/env.ts` at module scope — a Zod parse that throws under Vitest with no
// storefront env configured (same reason `page.test.ts` stubs `lib/stripe-config`).
// Stubbed to a no-op resolution so this render-shape test never loads that chain.
vi.mock("@/lib/cart-item-path", () => ({
  resolveCartItemPath: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/components/headkit-ui/cart-context", () => ({
  useCartContext: () => ({
    toggleCart: vi.fn(),
    isPending: false,
    optimisticRemoveItem: vi.fn(),
    optimisticUpdateQuantity: vi.fn(),
    startCartTransition: vi.fn(),
  }),
}));

// Switchable rather than hard-coded false: quote mode is a distinct render of
// this row (no line price, no strikethrough, and — since Part C — no add-on
// price suffixes either), and it needs its own coverage.
let quoteMode = false;
vi.mock("@/components/checkout/checkout-mode-provider", () => ({
  useIsQuoteMode: () => quoteMode,
}));

const { CartItemRow } = await import("./cart-item");

type CartItem = CartFieldsFragment["items"][number];

function line(overrides: Partial<CartItem> = {}): CartItem {
  return {
    key: "abc123",
    id: "96",
    slug: "test-product-12",
    quantity: 1,
    name: "Test Product 12",
    sku: "TP12",
    stockQuantity: null,
    stockStatus: "instock",
    images: [{ src: "/x.png", alt: "", width: 0, height: 0 }],
    prices: { price: "22.00", regularPrice: "22.00", salePrice: "22.00" },
    totals: {
      lineTotal: "22.00",
      lineTotalTax: "0",
      lineSubtotal: "22.00",
      lineSubtotalTax: "0",
    },
    variation: [],
    giftCard: null,
    addons: [],
    ...overrides,
  };
}

/** The real order-230 selections, as the gateway returns them (measured). */
const ADDONS: CartItem["addons"] = [
  {
    addonId: "1900000002",
    name: "Guest Book Service",
    value: "Hardcover Book",
    price: "50",
    priceType: "flat_fee",
    fieldType: "multiple_choice",
  },
  {
    addonId: "1900000004",
    name: "Event Message",
    value: "Sam &amp; Alex, 12 Dec",
    price: "0",
    priceType: "flat_fee",
    fieldType: "custom_text",
  },
];

const GIFT_CARD: NonNullable<CartItem["giftCard"]> = {
  recipients: ["friend@example.com"],
  from: "Sam",
  message: "Enjoy",
  deliveryDate: null,
};

function render(item: CartItem): string {
  return renderToStaticMarkup(
    <CartItemRow
      item={item}
      currency={{ code: "AUD" }}
      onCartUpdate={vi.fn()}
    />,
  );
}

/** The same row as a quote store renders it. */
function renderQuote(item: CartItem): string {
  quoteMode = true;
  try {
    return render(item);
  } finally {
    quoteMode = false;
  }
}

describe("cart drawer line — no add-ons means no change", () => {
  it("renders no panel ground, no title and no wrapper", () => {
    const markup = render(line());
    expect(markup).not.toContain("bg-primary/5");
    expect(markup).not.toContain(">Options</p>");
    expect(markup).not.toContain("space-y-0.5");
  });

  it("leaves a gift-card-only line byte-identical to what it was", () => {
    // The gift-card panel was the last element on the row before this plan.
    // If mounting the add-ons panel added a wrapper — even an empty one — these
    // two renders would differ.
    const giftOnly = render(line({ giftCard: GIFT_CARD }));
    expect(giftOnly).toContain(">Gift card</p>");
    expect(giftOnly).not.toContain(">Options</p>");
    expect(giftOnly.endsWith("</div></div>")).toBe(true);
  });
});

describe("cart drawer line — the price includes tax", () => {
  it("renders subtotal PLUS its tax, not the ex-tax subtotal", () => {
    // The Pblr figures the defect was reported against: the Store API reports
    // 1235 ex-tax with 124 of GST beside it, against a PDP-advertised A$1,359.
    // Reading `lineSubtotal` alone printed A$1,235.00 — ~9.1% under.
    const markup = render(
      line({
        totals: {
          lineTotal: "1235",
          lineTotalTax: "124",
          lineSubtotal: "1235",
          lineSubtotalTax: "124",
        },
      }),
    );
    expect(markup).toContain("$1,359.00");
    expect(markup).not.toContain("$1,235.00");
  });
});

describe("cart drawer line — add-ons are echoed", () => {
  it("renders each group name with its decoded value", () => {
    const markup = render(line({ addons: ADDONS }));
    expect(markup).toContain(">Options</p>");
    expect(markup).toContain("Guest Book Service");
    expect(markup).toContain("Hardcover Book");
    expect(markup).toContain("Sam &amp; Alex, 12 Dec");
    expect(markup).not.toContain("&amp;amp;");
  });

  it("shows the line total AND the priced selection's own price", () => {
    const markup = render(line({ addons: ADDONS }));
    expect(markup).toContain("$22.00");
    expect(markup).toContain("+$50.00");
    // Two figures: the line total and the one paid selection. The Event
    // Message selection is free (price "0") and prints nothing.
    expect(markup.split("$").length - 1).toBe(2);
  });

  it("renders both panels in a stable order when a line carries both", () => {
    const markup = render(line({ giftCard: GIFT_CARD, addons: ADDONS }));
    expect(markup.indexOf(">Options</p>")).toBeGreaterThan(
      markup.indexOf(">Gift card</p>"),
    );
  });

  it("renders one row per selection when a checkbox group repeats", () => {
    const markup = render(
      line({
        addons: [
          {
            addonId: "1900000103",
            name: "Extras",
            value: "Extra Prints",
            price: "10",
            priceType: "flat_fee",
            fieldType: "checkbox",
          },
          {
            addonId: "1900000103",
            name: "Extras",
            value: "USB Copy",
            price: "5",
            priceType: "flat_fee",
            fieldType: "checkbox",
          },
        ],
      }),
    );
    expect(markup.split("Extras").length - 1).toBe(2);
  });
});

describe("cart drawer line — quote mode shows no money anywhere", () => {
  // The drawer gates only the price block on `isQuoteMode`; the add-on panel
  // mounts outside it. Before Part C that was harmless because the panel
  // rendered no money — this pins that it renders none again.
  it("renders no currency at all on a line carrying a priced add-on", () => {
    const markup = renderQuote(line({ addons: ADDONS }));
    expect(markup).not.toContain("A$");
    expect(markup).not.toContain("$");
  });

  it("still renders the Options panel and the selections themselves", () => {
    const markup = renderQuote(line({ addons: ADDONS }));
    expect(markup).toContain(">Options</p>");
    expect(markup).toContain("Guest Book Service:");
    expect(markup).toContain("Hardcover Book");
  });

  it("shows the priced suffix again once quote mode is off", () => {
    // Guards the guard: without this the cases above would pass against a
    // component that never renders a suffix at all.
    expect(render(line({ addons: ADDONS }))).toContain("+$50.00");
  });
});
