import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * **The order confirmation when items sold out during payment.**
 *
 * WHAT THIS COVERS — the clean `/checkout/success/{orderId}` render (no
 * session) driven with an order carrying `stockShortfall`, in the three
 * shapes that matter, with the GA4 event captured from the emitter's props:
 *
 * - fully refunded (an Afterpay order refunded in full): the sold-out notice is
 *   the page's `<h1>`, NO "order is confirmed" anywhere, status Refunded and
 *   "won't be shipped", the line struck and tagged, Paid / Refunded / Total
 *   charged, Contact us — and no `purchase` at all;
 * - partly refunded (one line kept, one sold out): the notice, then the usual confirmation
 *   reading "The rest of your order is confirmed", lines tagged Confirmed /
 *   Sold out — refunded, the money rows, and a `purchase` for the kept amount;
 * - no shortfall, and a quote: the page exactly as before (no notice, no
 *   tags, the Total row, the full `purchase`).
 *
 * Every case calls the REAL page with the REAL `lib/stock-shortfall.ts` and
 * `lib/ga4-ecommerce.ts`; only the server actions, cookies, branding and the
 * emitter are stubbed.
 *
 * WHERE IT STOPS — no CSS is loaded and no box is laid out, so the amber card,
 * the strike-through and the layout are screenshots in the PR; nothing reaches
 * commerce, and nothing pushes to a real `dataLayer`.
 */

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_HEADKIT_PUBLIC_KEY ??= "pk_test";
  process.env.NEXT_PUBLIC_GRAPHQL_URL ??= "http://localhost:4000/graphql";
  process.env.HEADKIT_PRIVATE_KEY ??= "sk_test";
});

const getOrderAction = vi.fn();
const checkoutType = { value: "cart" };

vi.mock("@/app/checkout/actions", () => ({
  getOrderAction: (...args: unknown[]) => getOrderAction(...args),
  getCheckoutSessionAction: vi.fn(),
  processCheckoutOrderAction: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
}));

vi.mock("@/lib/branding", () => ({
  getBranding: async () => ({
    storeSettings: { checkoutType: checkoutType.value },
  }),
}));

/** `ClearCart` reads the cart provider, which a bare server render lacks. */
vi.mock("@/components/checkout/clear-cart", () => ({
  ClearCart: () => null,
}));

/** The emitter renders nothing on a server; expose the event it was handed. */
vi.mock("@/components/analytics/ga4-ecommerce-emitter", () => ({
  Ga4EcommerceEmitter: ({ event }: { event: unknown }) => (
    <script
      data-testid="ga4-event"
      type="application/json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(event ?? null) }}
    />
  ),
}));

function line(
  id: string,
  name: string,
  quantity: number,
  subtotal: string,
  tax: string,
) {
  return {
    key: `rest-${id}`,
    id,
    quantity,
    name,
    sku: `SKU-${id}`,
    images: [],
    prices: { price: "0", regularPrice: "0", salePrice: "0" },
    totals: {
      lineSubtotal: subtotal,
      lineSubtotalTax: tax,
      lineTotal: subtotal,
      lineTotalTax: tax,
    },
    variation: [],
    giftCard: null,
    addons: [],
  };
}

const ADDRESS = {
  firstName: "Callan",
  lastName: "Taylor",
  company: "",
  address1: "1 Rundle Mall",
  address2: "",
  city: "Adelaide",
  state: "SA",
  postcode: "5000",
  country: "AU",
  email: "callan@example.com",
  phone: "0400000000",
};

/** Order #279063 as the gateway returned it (shopper details invented). */
const FULL_ORDER = {
  id: "279063",
  databaseId: "279063",
  orderNumber: "279063",
  status: "refunded",
  paymentMethodTitle: "Afterpay [Test]",
  total: "499.00",
  currency: { code: "AUD", symbol: "$", minorUnit: 2 },
  billingAddress: ADDRESS,
  shippingAddress: ADDRESS,
  items: [
    line(
      "276070",
      "Time SPECIALE 12 B1 MTB Pedals - Black/Gold, Large",
      1,
      "453.64",
      "45.36",
    ),
  ],
  coupons: [],
  totals: {
    totalItems: "453.64",
    totalItemsTax: "0",
    totalDiscount: "0",
    totalDiscountTax: "0",
    totalShipping: "0",
    totalShippingTax: "0",
    totalPrice: "499.00",
    totalTax: "45.36",
  },
  shippingLines: [
    {
      methodTitle: "Free shipping",
      total: "0",
      methodId: "free_shipping",
      pickupLocation: null,
      pickupAddress: null,
      pickupDetails: null,
    },
  ],
  stockShortfall: {
    refundStatus: "REFUNDED",
    fullyRefunded: true,
    refundTotal: "499.00",
    shippingRefund: "0.00",
    paymentRefund: "499.00",
    giftCardRefund: "0.00",
    lines: [
      {
        productId: "276074",
        name: "Time SPECIALE 12 B1 MTB Pedals - Black/Gold, Large",
        quantity: 1,
        refundAmount: "499.00",
      },
    ],
  },
};

/** The B8 shape the partial artboard draws. */
const PARTIAL_ORDER = {
  ...FULL_ORDER,
  id: "279057",
  databaseId: "279057",
  orderNumber: "279057",
  status: "processing",
  paymentMethodTitle: "Visa ending 4242 (Stripe)",
  total: "51.85",
  items: [
    line("8001", "Pro Tool 750ml Storage Bottle", 1, "18.14", "1.81"),
    line(
      "9001",
      "Specialized MY16 Stumpjumper/Epic Upper Eyelet Shock Bolt",
      2,
      "18.09",
      "1.81",
    ),
  ],
  totals: {
    ...FULL_ORDER.totals,
    totalShipping: "10.91",
    totalShippingTax: "1.09",
    totalPrice: "51.85",
    totalTax: "4.71",
  },
  shippingLines: [
    {
      methodTitle: "Standard",
      total: "10.91",
      methodId: "flat_rate",
      pickupLocation: null,
      pickupAddress: null,
      pickupDetails: null,
    },
  ],
  stockShortfall: {
    refundStatus: "REFUNDED",
    fullyRefunded: false,
    refundTotal: "19.90",
    shippingRefund: "0.00",
    paymentRefund: "19.90",
    giftCardRefund: "0.00",
    lines: [
      {
        productId: "9001",
        name: "Specialized MY16 Stumpjumper/Epic Upper Eyelet Shock Bolt",
        quantity: 2,
        refundAmount: "19.90",
      },
    ],
  },
};

const PLAIN_ORDER = {
  ...PARTIAL_ORDER,
  status: "processing",
  stockShortfall: null,
};

async function render(order: unknown): Promise<string> {
  getOrderAction.mockResolvedValue(order);
  const { default: Page } =
    await import("@/app/checkout/success/[orderId]/page");
  const element = await Page({
    params: Promise.resolve({ orderId: "279063" }),
    searchParams: Promise.resolve({ key: "wc_order_abc" }),
  });
  return renderToStaticMarkup(element);
}

function ga4Event(html: string): unknown {
  const match = html.match(
    /<script data-testid="ga4-event" type="application\/json">(.*?)<\/script>/,
  );
  return match ? JSON.parse(match[1]!) : undefined;
}

/** Visible text, tags stripped, entities for the two characters the copy uses. */
function text(html: string): string {
  return html
    .replace(/<script[^>]*>.*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

beforeEach(() => {
  checkoutType.value = "cart";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("the order confirmation on a fully refunded shortfall order", () => {
  it("says the items sold out and never says the order is confirmed", async () => {
    const html = await render(FULL_ORDER);
    const visible = text(html);

    expect(html).toMatch(/<h1[^>]*>Sorry — your items sold out<\/h1>/);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(visible).toContain(
      "The items in this order sold out while your payment was processing. We've refunded the full $499.00 , including shipping, to your original payment method (Afterpay).",
    );
    expect(visible).not.toMatch(/confirmed/i);
    expect(visible).not.toContain("Thanks,");

    expect(html).toMatch(/data-testid="stock-shortfall-status"[^>]*>Refunded</);
    expect(visible).toContain("This order won't be shipped.");
    expect(visible).toContain("What happens next");
    expect(visible).toContain("Continue Shopping");
    expect(html).toContain('href="/contact"');
  });

  it("strikes the line and shows Paid / Refunded / Total charged", async () => {
    const html = await render(FULL_ORDER);
    const visible = text(html);
    expect(html).toContain("Sold out — refunded");
    expect(html).toContain("line-through");
    expect(visible).toContain("Paid with Afterpay $499.00");
    expect(visible).toContain("Refunded −$499.00");
    expect(visible).toContain("Total charged $0.00");
    expect(visible).not.toMatch(/\bTotal \$/);
  });

  it("sends no GA4 purchase", async () => {
    const html = await render(FULL_ORDER);
    // The fully refunded branch mounts no emitter at all.
    expect(ga4Event(html) ?? null).toBeNull();
  });
});

describe("the order confirmation on a partly refunded shortfall order", () => {
  it("leads with the notice, then confirms the rest", async () => {
    const html = await render(PARTIAL_ORDER);
    const visible = text(html);
    expect(html).toMatch(/<h2[^>]*>Sorry — part of your order sold out<\/h2>/);
    expect(visible).toContain(
      "2 × Specialized MY16 Stumpjumper/Epic Upper Eyelet Shock Bolt sold out while your payment was processing. We've refunded $19.90 to your original payment method. The rest of your order is confirmed below.",
    );
    expect(html).toMatch(/<h1[^>]*>Thanks, Callan!<\/h1>/);
    expect(visible).toContain("The rest of your order is confirmed.");
    expect(visible).not.toContain("Your order is confirmed.");
    expect(visible).toContain(
      "We'll send one email with your order and the refund.",
    );
    expect(html.indexOf("stock-shortfall-notice")).toBeLessThan(
      html.indexOf("<h1"),
    );
  });

  it("tags the kept and the sold-out lines, and nets the refund", async () => {
    const visible = text(await render(PARTIAL_ORDER));
    expect(visible).toMatch(
      /Pro Tool 750ml Storage Bottle Qty 1 Confirmed \$19\.95/,
    );
    expect(visible).toMatch(/Shock Bolt Qty 2 Sold out — refunded \$19\.90/);
    expect(visible).toContain("Paid $51.85");
    expect(visible).toContain("Refunded −$19.90");
    expect(visible).toContain("Total charged $31.95");
    expect(visible).toContain(
      "We'll get the rest of your order ready to ship.",
    );
  });

  it("prints the tax inside Total charged, after it, and agrees with GA4", async () => {
    // #279066: $51.85 paid, $19.90 refunded, order tax $4.71. The tax on the
    // $31.95 kept is $2.90 — $4.71 is the original order's, and must not sit
    // above Total charged where it reads as the GST on $31.95.
    const html = await render(PARTIAL_ORDER);
    const visible = text(html);
    expect(visible).toContain("Total charged $31.95 Includes tax $2.90");
    expect(visible).not.toContain("$4.71");
    expect(visible.match(/Includes tax/g)).toHaveLength(1);
    const event = ga4Event(html) as { ecommerce: { tax: number } };
    expect(event.ecommerce.tax).toBe(2.9);
  });

  it("names the payment method without the gross amount", async () => {
    const html = await render(PARTIAL_ORDER);
    const payment = text(html).match(/Payment (.*?) What happens next/)?.[1];
    expect(payment).toBeDefined();
    expect(payment).not.toContain("$");
  });

  it("sends a GA4 purchase for the kept amount only", async () => {
    const event = ga4Event(await render(PARTIAL_ORDER)) as {
      event: string;
      ecommerce: { value: number; items: { item_name: string }[] };
    };
    expect(event.event).toBe("purchase");
    expect(event.ecommerce.value).toBe(31.95);
    expect(event.ecommerce.items.map((i) => i.item_name)).toEqual([
      "Pro Tool 750ml Storage Bottle",
    ]);
  });
});

describe("an order without a shortfall renders as before", () => {
  it("confirms the order with the Total row and the full purchase", async () => {
    const html = await render(PLAIN_ORDER);
    const visible = text(html);
    expect(html).not.toContain("stock-shortfall");
    expect(html).not.toContain("line-item-shortfall-tag");
    expect(html).not.toContain("line-through");
    expect(visible).toContain("Your order is confirmed.");
    expect(visible).toContain("You will receive a confirmation email shortly.");
    expect(visible).toContain("Total $51.85");
    expect(visible).toContain("Includes tax $4.71 Total $51.85");
    expect(visible).toMatch(/Payment \$51\.85/);
    expect(visible).not.toContain("What happens next");
    const event = ga4Event(html) as { ecommerce: { value: number } };
    expect(event.ecommerce.value).toBe(51.85);
  });

  it("ignores a shortfall record in quote mode", async () => {
    checkoutType.value = "quote";
    const html = await render(PARTIAL_ORDER);
    expect(html).not.toContain("stock-shortfall");
    expect(text(html)).toContain("Your quote request was submitted.");
    expect(ga4Event(html)).toBeNull();
  });
});
