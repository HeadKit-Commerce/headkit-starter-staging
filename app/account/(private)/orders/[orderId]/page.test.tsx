import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { getFloatVal } from "@/lib/utils";

/**
 * The account order-detail page — order HISTORY, so every figure renders.
 *
 * This page mounts `AddonDetails` through `LineItemDisplay`, and quote-mode
 * price suppression deliberately does NOT reach it. A placed order here is a
 * record of what was actually charged, so its line prices, add-on price
 * suffixes and totals block all render even on a quote store; suppression
 * belongs on the pre-purchase surfaces (`components/checkout/cart.tsx` and the
 * confirmation page), where a quote genuinely has no price yet.
 *
 * `getBranding` is still mocked so a store-level `checkoutType` cannot leak in
 * and change what this page shows — the whole point is that it cannot. Both
 * mocks are at the module boundary, so the subtree under test — the line rows
 * and the totals block — is the real one.
 */

const getOrderAction = vi.fn();
const getBranding = vi.fn();

vi.mock("@/app/checkout/actions", () => ({
  getOrderAction: (...args: unknown[]) => getOrderAction(...args),
}));

vi.mock("@/lib/branding", () => ({
  getBranding: () => getBranding(),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <span role="img" aria-label={alt} data-src={src} />
  ),
}));

const { default: Page } = await import("./page");

/** One placed order carrying a priced add-on, as the gateway returns it. */
function order(overrides: Record<string, unknown> = {}) {
  return {
    id: "230",
    databaseId: 230,
    date: null,
    status: "processing",
    total: "$110.00",
    paymentMethodTitle: "Credit card",
    currency: { code: "AUD" },
    totals: {
      totalItems: "100",
      totalItemsTax: "0",
      totalDiscount: "0",
      totalDiscountTax: "0",
      totalShipping: "10",
      totalShippingTax: "1",
      totalTax: "11",
      totalPrice: "121",
    },
    shippingLines: [],
    shippingAddress: null,
    billingAddress: null,
    items: [
      {
        key: "abc123",
        name: "Glam Booth",
        quantity: 1,
        images: [],
        variation: [],
        prices: { price: "110" },
        totals: {
          lineSubtotal: "100",
          lineSubtotalTax: "10",
          lineTotal: "100",
          lineTotalTax: "10",
        },
        addons: [
          {
            addonId: "1900000002",
            name: "Guest Book Service",
            value: "Hardcover Book",
            price: "50",
            priceType: "flat_fee",
            fieldType: "multiple_choice",
          },
        ],
      },
    ],
    ...overrides,
  };
}

async function render(checkoutType: string): Promise<string> {
  getBranding.mockResolvedValue({ storeSettings: { checkoutType } });
  return renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ orderId: "230" }),
      searchParams: Promise.resolve({ key: "wc_order_abc" }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrderAction.mockResolvedValue(order());
});

describe("account order detail — a quote store's history still shows the money", () => {
  it("renders the per-option add-on price suffix", async () => {
    // The pre-purchase surfaces suppress this in quote mode; order history
    // must not, because the charge already happened.
    expect(await render("quote")).toContain("+$50.00");
  });

  it("renders the line price beside each row", async () => {
    expect(await render("quote")).toContain("$110.00");
  });

  it("renders the whole totals block", async () => {
    const markup = await render("quote");
    expect(markup).toContain(">Subtotal</p>");
    expect(markup).toContain(">Includes tax</p>");
    expect(markup).toContain(">Total</h2>");
    expect(markup).toContain("$121.00");
  });

  it("is unaffected by a quote payment method on the order itself", async () => {
    getOrderAction.mockResolvedValue(
      order({ paymentMethodTitle: "Quote request" }),
    );
    expect(await render("payment")).toContain("+$50.00");
  });
});

/** The money in a labelled totals row, e.g. `row(markup, "Subtotal")`. */
function row(markup: string, label: string): number {
  const match = new RegExp(`>${label}</p><p>−?\\$([\\d,]+\\.\\d\\d)</p>`).exec(
    markup,
  );
  if (!match?.[1]) {
    throw new Error(`no "${label}" totals row in the rendered output`);
  }
  return Number(match[1].replace(/,/g, ""));
}

describe("account order detail — the totals block reconciles", () => {
  it("reads the Subtotal from the LINES, not the order's ex-tax roll-up", async () => {
    // The fixture's cart-level totalItemsTax is "0" (commerce hard-codes it on
    // the order path) while the LINE carries subtotal 100 + tax 10. Reading the
    // cart-level field would render 100.00 here; only summing the lines gives
    // 110.00. Scoped to the Subtotal ROW because 110.00 is also the line-row
    // figure, so a whole-page `toContain` cannot tell the two apart.
    expect(row(await render("payment"), "Subtotal")).toBe(110);
  });

  it("Subtotal + Shipping equals the order's own Total", async () => {
    const markup = await render("payment");

    expect(row(markup, "Subtotal") + row(markup, "Shipping")).toBe(
      getFloatVal(order().totals.totalPrice),
    );
  });

  it("renders the inclusive line total and the add-on price", async () => {
    const markup = await render("payment");
    expect(markup).toContain("$110.00");
    expect(markup).toContain("+$50.00");
    expect(markup).toContain(">Includes tax</p>");
  });
});
