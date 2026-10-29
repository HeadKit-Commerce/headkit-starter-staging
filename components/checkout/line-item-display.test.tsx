import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * `LineItemDisplay` is one component serving three of this plan's four
 * surfaces — the checkout summary, the order confirmation and the account order
 * detail. It takes its optional panel data as an explicit prop, so adding the
 * add-ons panel means editing the component **and** all three call sites; the
 * pattern map's claim that the work collapses to two files is wrong, and the
 * call-site assertions at the bottom of this file are what keep it honest.
 *
 * The property that costs the most if it breaks is the *negative* one: a line
 * with no add-on selections must render exactly what it rendered before this
 * phase. An empty wrapper is invisible to a presence check and shifts every
 * line on four surfaces, so the assertion here is byte equality between the
 * "prop omitted" and "prop present but empty" renders, not element absence.
 *
 * `next/image` is stubbed to a plain `<img>`: outside the Next runtime the real
 * component reaches for loader config this test has no business supplying. The
 * stub sits below the part of the tree under test — every add-on assertion
 * reads markup the stub never touches.
 */

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    className,
  }: {
    src: string;
    alt: string;
    className?: string;
    // A stub, not a rendered image: `next/image`'s LCP guidance is about pages
    // shipped to shoppers, and nothing below this line is under test.
  }) => (
    <span role="img" aria-label={alt} data-src={src} className={className} />
  ),
}));

const { LineItemDisplay } = await import("./line-item-display");

const BASE = {
  name: "Test Product 12",
  images: [{ src: "/x.png", alt: "" }],
  quantity: 1,
  lineTotal: 22,
  currency: "AUD",
  hideLineTotal: false,
  hideAddonPrices: false,
};

/**
 * The real order-230 selections, as the gateway returns them (measured).
 * Prices are the ones `order_provider_addons_test.go` pins off the same order's
 * `_pao_ids` meta.
 */
const ORDER_230 = [
  {
    addonId: "1900000001",
    name: "Add-ons",
    value: "Animated Welcome Screen",
    price: "10",
    priceType: "flat_fee",
  },
  {
    addonId: "1900000002",
    name: "Guest Book Service",
    value: "Hardcover Book",
    price: "50",
    priceType: "flat_fee",
  },
  {
    addonId: "1900000004",
    name: "Event Message",
    value: "Sam &amp; Alex, 12 Dec",
    price: "0",
    priceType: "flat_fee",
  },
];

const GIFT_CARD = {
  recipients: ["friend@example.com"],
  from: "Sam",
  message: "Enjoy",
  deliveryDate: null,
};

const SRC_DIR = resolve(__dirname);
const APP_DIR = resolve(SRC_DIR, "../../app");

const sources: Record<string, string> = {
  "line-item-display.tsx": readFileSync(
    resolve(SRC_DIR, "line-item-display.tsx"),
    "utf8",
  ),
  "cart.tsx": readFileSync(resolve(SRC_DIR, "cart.tsx"), "utf8"),
  "success/[orderId]/page.tsx": readFileSync(
    resolve(APP_DIR, "checkout/success/[orderId]/page.tsx"),
    "utf8",
  ),
  "account orders/[orderId]/page.tsx": readFileSync(
    resolve(APP_DIR, "account/(private)/orders/[orderId]/page.tsx"),
    "utf8",
  ),
};

describe("LineItemDisplay — a line with no add-ons is unchanged", () => {
  it("renders byte-identically whether the prop is omitted or an empty list", () => {
    const omitted = renderToStaticMarkup(<LineItemDisplay {...BASE} />);
    const empty = renderToStaticMarkup(
      <LineItemDisplay {...BASE} addons={[]} />,
    );
    expect(empty).toBe(omitted);
  });

  it("contributes no panel ground, no title and no wrapper", () => {
    const markup = renderToStaticMarkup(<LineItemDisplay {...BASE} />);
    expect(markup).not.toContain("bg-primary/5");
    expect(markup).not.toContain(">Options</p>");
    expect(markup).not.toContain("space-y-0.5");
  });

  it("leaves the gift-card line untouched when only a gift card is present", () => {
    const withGift = renderToStaticMarkup(
      <LineItemDisplay {...BASE} giftCard={GIFT_CARD} />,
    );
    const withGiftAndEmptyAddons = renderToStaticMarkup(
      <LineItemDisplay {...BASE} giftCard={GIFT_CARD} addons={[]} />,
    );
    expect(withGiftAndEmptyAddons).toBe(withGift);
    expect(withGift).toContain(">Gift card</p>");
  });
});

describe("LineItemDisplay — a line with add-ons echoes them", () => {
  it("renders the panel with every group name and its decoded value", () => {
    const markup = renderToStaticMarkup(
      <LineItemDisplay {...BASE} addons={ORDER_230} />,
    );
    expect(markup).toContain(">Options</p>");
    expect(markup).toContain("Guest Book Service:");
    expect(markup).toContain("Hardcover Book");
    expect(markup).toContain("Sam &amp; Alex, 12 Dec");
    expect(markup).not.toContain("&amp;amp;");
  });

  it("renders both panels in a stable order when a line carries both", () => {
    const markup = renderToStaticMarkup(
      <LineItemDisplay {...BASE} giftCard={GIFT_CARD} addons={ORDER_230} />,
    );
    expect(markup.indexOf(">Gift card</p>")).toBeGreaterThan(-1);
    expect(markup.indexOf(">Options</p>")).toBeGreaterThan(
      markup.indexOf(">Gift card</p>"),
    );
  });

  it("shows the line total AND each priced selection's own price", () => {
    const markup = renderToStaticMarkup(
      <LineItemDisplay {...BASE} addons={ORDER_230} />,
    );
    expect(markup).toContain("$22.00");
    expect(markup).toContain("+$10.00");
    expect(markup).toContain("+$50.00");
    // Three figures: the line total plus the two priced selections. The third
    // selection (Event Message, price "0") contributes none.
    expect(markup.split("$").length - 1).toBe(3);
  });

  it("passes the line's currency down to the add-on panel", () => {
    const markup = renderToStaticMarkup(
      <LineItemDisplay {...BASE} currency="USD" addons={ORDER_230} />,
    );
    // USD renders a bare `$`; an AUD-hard-coded suffix would print `A$`.
    expect(markup).toContain("+$50.00");
    expect(markup).not.toContain("A$");
  });
});

describe("LineItemDisplay — the contract with its call sites", () => {
  it("re-exports the panel's display type, mirroring the gift-card re-export", () => {
    const src = sources["line-item-display.tsx"]!;
    expect(src).toContain("AddonDisplay");
    expect(/export type \{[^}]*AddonDisplay[^}]*\}/.test(src)).toBe(true);
    expect(/export type \{[^}]*GiftCardDisplay[^}]*\}/.test(src)).toBe(true);
  });

  it.each([
    ["cart.tsx"],
    ["success/[orderId]/page.tsx"],
    ["account orders/[orderId]/page.tsx"],
  ])("%s passes the addons prop exactly once", (file) => {
    const src = sources[file]!;
    expect(src.split(/\baddons=\{/).length - 1).toBe(1);
  });

  it.each(Object.keys(sources))(
    "%s introduces no optional chaining or null guard on the addons field",
    (file) => {
      const src = sources[file]!;
      // The schema types it `[CartItemAddonSelection!]!` with an empty default
      // (D-14.1-04): a client can never receive null, so a defensive access
      // would assert a contract the schema forbids and would hide a real
      // regression if the field ever did go missing.
      expect(/addons\s*\?\./.test(src)).toBe(false);
      expect(/\.addons\s*\?\?/.test(src)).toBe(false);
      expect(/addons\s*\|\|/.test(src)).toBe(false);
    },
  );
});

describe("LineItemDisplay — the two price gates are independent", () => {
  // They were one flag until an account-history page needed the add-on suffix
  // hidden while still showing what the shopper was charged. The two
  // single-flag cases below are the whole reason the split exists.
  const render = (hideLineTotal: boolean, hideAddonPrices: boolean): string =>
    renderToStaticMarkup(
      <LineItemDisplay
        {...BASE}
        addons={ORDER_230}
        hideLineTotal={hideLineTotal}
        hideAddonPrices={hideAddonPrices}
      />,
    );

  it("shows both figures when neither is set", () => {
    // Guards the guard: without this every negative case below would pass
    // against a component that renders no money at all.
    const markup = render(false, false);
    expect(markup).toContain("$22.00");
    expect(markup).toContain("+$50.00");
  });

  it("hideLineTotal drops the line total and LEAVES the add-on suffixes", () => {
    const markup = render(true, false);
    expect(markup).not.toContain("$22.00");
    expect(markup).toContain("+$50.00");
  });

  it("hideAddonPrices drops the suffixes and LEAVES the line total", () => {
    const markup = render(false, true);
    expect(markup).toContain("$22.00");
    expect(markup).not.toContain("+$50.00");
  });

  it("both set renders no currency at all", () => {
    const markup = render(true, true);
    expect(markup).not.toContain("A$");
    expect(markup).not.toContain("$");
  });

  it("echoes every option name and value whatever the gates say", () => {
    for (const markup of [
      render(false, false),
      render(true, false),
      render(false, true),
      render(true, true),
    ]) {
      expect(markup).toContain(">Options</p>");
      for (const a of ORDER_230) expect(markup).toContain(a.name);
    }
  });
});

describe("LineItemDisplay — a line on an order that lost items to stock", () => {
  const markup = (shortfallTag?: {
    kind: "sold-out" | "kept";
    label: string;
  }): string =>
    renderToStaticMarkup(
      <LineItemDisplay
        {...BASE}
        {...(shortfallTag === undefined ? {} : { shortfallTag })}
      />,
    );

  it("renders a line with no tag byte-for-byte as before", () => {
    const plain = markup();
    expect(markup(undefined)).toBe(plain);
    expect(
      renderToStaticMarkup(<LineItemDisplay {...BASE} shortfallTag={null} />),
    ).toBe(plain);
    expect(plain).not.toContain("line-through");
    expect(plain).not.toContain("line-item-shortfall-tag");
  });

  it("strikes a sold-out line through and tags it with the refund", () => {
    const out = markup({ kind: "sold-out", label: "Sold out — refunded" });
    expect(out).toContain("line-through");
    expect(out).toMatch(
      /data-testid="line-item-shortfall-tag"[^>]*>Sold out — refunded</,
    );
  });

  it("tags a kept line without striking it", () => {
    const out = markup({ kind: "kept", label: "Confirmed" });
    expect(out).not.toContain("line-through");
    expect(out).toMatch(
      /data-testid="line-item-shortfall-tag"[^>]*>Confirmed</,
    );
  });
});
