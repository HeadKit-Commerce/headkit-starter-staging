import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AddonDetails, type AddonDisplay } from "./addon-details";

/**
 * `AddonDetails` — the cart / checkout / confirmation / account echo of the
 * shopper's add-on selections (PAO-03), and the same component's silence when
 * there are none (PAO-04).
 *
 * Rendered through `react-dom/server` rather than a DOM testing library: the
 * starter's vitest environment is `node` and this phase's dependency budget is
 * zero (UI-SPEC § Registry Safety). `app/checkout/finalising/page.test.tsx` is
 * the in-repo precedent for the technique.
 *
 * Four properties are load-bearing and none of them is assumed:
 *
 *   1. an empty selection list contributes **no element at all** — not an empty
 *      div, not a zero-height wrapper. A wrapper is invisible to a presence
 *      check but shifts every line on four surfaces;
 *   2. values a shopper typed are HTML-entity **decoded** (14.1-03 measured the
 *      order side returning `Sam &amp; Alex, 12 Dec`) and then rendered as React
 *      children, so they come back **escaped**. Decode-then-escape, never
 *      raw HTML;
 *   3. **each priced option shows its own price**, in the format its price type
 *      means, and a free option shows none. This REVERSES UI-SPEC U-03, whose
 *      suppression rested on a measurement of `prices.price` (the line's unit
 *      price, which PAO does divide a flat fee into) misattributed to
 *      `extensions.headkit.addons_selection[].price`, which is the field this
 *      component receives and which is quantity-invariant. Re-measured on the
 *      local e2e stack — see the component doc for the transcript;
 *   4. the panel's three off-scale spacing values are **byte-identical** to
 *      `gift-card-details.tsx`. That identity is the feature — the two panels
 *      must be indistinguishable when a cart carries both (UI-SPEC Dimension 5
 *      FLAG). A test, not a comment, is what stops a later reviewer
 *      "normalising" them to the 4px scale.
 */

/**
 * The real order-230 selections, as the gateway returns them (measured).
 *
 * The prices are the ones `order_provider_addons_test.go` pins off the same
 * order's `_pao_ids` meta — 10 / 50 / 25 / 0, all `flat_fee` — so this fixture
 * and the Go extractor's fixture describe one order.
 */
const ORDER_230: AddonDisplay[] = [
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
    addonId: "1900000003",
    name: "Backdrop Design",
    value: "Sequin Gold",
    price: "25",
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

/** A free selection — the shape every "no suffix" case below is built from. */
function free(addonId: string, name: string, value: string): AddonDisplay {
  return { addonId, name, value, price: "0", priceType: "flat_fee" };
}

function render(addons: AddonDisplay[], currency = "AUD"): string {
  return renderToStaticMarkup(
    <AddonDetails addons={addons} currency={currency} hidePrice={false} />,
  );
}

/** HeadKit Quote mode: the same panel, with every price suffix suppressed. */
function renderQuote(addons: AddonDisplay[], currency = "AUD"): string {
  return renderToStaticMarkup(
    <AddonDetails addons={addons} currency={currency} hidePrice />,
  );
}

const SRC_DIR = resolve(__dirname);
const addonSource = readFileSync(resolve(SRC_DIR, "addon-details.tsx"), "utf8");
const giftCardSource = readFileSync(
  resolve(SRC_DIR, "gift-card-details.tsx"),
  "utf8",
);

/** The panel's outermost `className="…"` literal, verbatim. */
function panelClasses(source: string): string {
  const match = /className="([^"]*rounded-\[3px\][^"]*)"/.exec(source);
  if (!match?.[1]) throw new Error("no panel className found in source");
  return match[1];
}

/** One declared class whose prefix matches, e.g. `px-` → `px-3`. */
function classWithPrefix(classes: string, prefix: string): string {
  const found = classes.split(/\s+/).find((c) => c.startsWith(prefix));
  if (!found)
    throw new Error(`no class starting with "${prefix}" in ${classes}`);
  return found;
}

describe("AddonDetails — the empty case (PAO-04)", () => {
  it("renders zero DOM nodes for an empty selection list", () => {
    expect(render([])).toBe("");
  });

  it("renders no wrapper, no heading and no whitespace for an empty list", () => {
    const markup = render([]);
    expect(markup).not.toContain("<div");
    expect(markup).not.toContain("Options");
    expect(markup).toHaveLength(0);
  });
});

describe("AddonDetails — the shopper sees what they configured", () => {
  it("renders the panel title the copywriting contract specifies", () => {
    expect(render(ORDER_230)).toContain(">Options</p>");
  });

  it("renders every selection, in the order received", () => {
    const markup = render(ORDER_230);
    for (const a of ORDER_230) expect(markup).toContain(a.name);
    const positions = ORDER_230.map((a) => markup.indexOf(a.name));
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
  });

  it("pairs each group name with its chosen value", () => {
    const markup = render([ORDER_230[1]!]);
    expect(markup).toContain("Guest Book Service:");
    expect(markup).toContain("Hardcover Book");
  });

  it("renders one row per selection even when a group repeats (checkbox groups)", () => {
    const markup = render([
      free("1900000103", "Extras", "Extra Prints"),
      free("1900000103", "Extras", "USB Copy"),
    ]);
    expect(markup).toContain("Extra Prints");
    expect(markup).toContain("USB Copy");
    expect(markup.split("Extras:").length - 1).toBe(2);
  });
});

describe("AddonDetails — decode, then escape", () => {
  it("decodes the entity-encoded value the order path really returns", () => {
    // Measured on local order 230 through the gateway: the value arrives as
    // `Sam &amp; Alex, 12 Dec`. Decoded it is `Sam & Alex, 12 Dec`, which React
    // re-escapes to `Sam &amp; Alex, 12 Dec`. WITHOUT the decode the markup
    // would carry `&amp;amp;` — which is exactly what this asserts against.
    const markup = render([ORDER_230[3]!]);
    expect(markup).toContain("Sam &amp; Alex, 12 Dec");
    expect(markup).not.toContain("&amp;amp;");
  });

  it("decodes an entity whose decoded form is not re-escaped, so the decode is visible", () => {
    const markup = render([free("1", "Event Dates", "12 &ndash; 14 Dec")]);
    expect(markup).toContain("12 – 14 Dec");
    expect(markup).not.toContain("ndash");
  });

  it("decodes the group name too, not only the value", () => {
    const markup = render([free("1", "Rob &amp; Sam&#039;s picks", "Yes")]);
    expect(markup).toContain("Rob &amp; Sam&#x27;s picks");
    expect(markup).not.toContain("&amp;#039;");
  });

  it("escapes a shopper-supplied value that contains markup", () => {
    const markup = render([
      free("1", "Message", '<img src=x onerror="alert(1)">'),
    ]);
    expect(markup).toContain("&lt;img");
    expect(markup).not.toContain("<img");
    expect(markup).not.toContain('onerror="alert');
  });

  it("escapes a shopper-supplied value that is already double-encoded", () => {
    // `&amp;lt;script&amp;gt;` decodes once to `&lt;script&gt;`, which React
    // escapes back to `&amp;lt;script&amp;gt;`. A single decode never yields a
    // live tag, which is the property that matters.
    const markup = render([free("1", "Note", "&amp;lt;script&amp;gt;")]);
    expect(markup).not.toContain("<script");
  });

  it("never uses a raw-HTML render prop", () => {
    expect(addonSource).not.toContain("dangerouslySetInnerHTML");
  });
});

describe("AddonDetails — quote mode carries the selection but no money", () => {
  // Part C gave every priced option a suffix, but this panel mounts OUTSIDE the
  // quote-mode gates that hide the line total (`hidePrice` on LineItemDisplay,
  // `isQuoteMode` on the drawer row) — so without its own flag it leaked prices
  // into a mode built to hide them.
  it("renders no price suffix at all", () => {
    const markup = renderQuote(ORDER_230);
    expect(markup).not.toContain("A$");
    expect(markup).not.toContain("$");
  });

  it("still echoes every option name and value", () => {
    const markup = renderQuote(ORDER_230);
    for (const a of ORDER_230) expect(markup).toContain(a.name);
    expect(markup).toContain("Hardcover Book");
    expect(markup).toContain("Sequin Gold");
    expect(markup).toContain(">Options</p>");
  });

  it("differs from the priced render ONLY by the suffixes", () => {
    const priced = render([ORDER_230[1]!]);
    const quoted = renderQuote([ORDER_230[1]!]);
    expect(priced).toContain("+$50.00");
    expect(quoted).not.toContain("+$50.00");
    expect(quoted).toBe(
      priced.replace('<span class="shrink-0">+$50.00</span>', ""),
    );
  });

  it("suppresses a percentage suffix too, not just currency ones", () => {
    const markup = renderQuote([
      {
        addonId: "1900000005",
        name: "Rush Fee",
        value: "Yes",
        price: "10",
        priceType: "percentage_based",
      },
    ]);
    expect(markup).toContain("Rush Fee:");
    expect(markup).not.toContain("%");
  });
});

describe("AddonDetails — each priced option shows its own price", () => {
  it("renders a flat fee as a plain currency suffix", () => {
    const markup = render([
      {
        addonId: "1900000002",
        name: "Guest Book Service",
        value: "Hardcover Book",
        price: "50",
        priceType: "flat_fee",
      },
    ]);
    expect(markup).toContain("Hardcover Book");
    expect(markup).toContain("+$50.00");
  });

  it("renders a quantity_based price with `each`, and a percentage as a percentage", () => {
    // Rendering all three price types as `+$X` would misquote two of them —
    // the reason the suffix format is delegated to `formatAddonPriceSuffix`,
    // the same function the PDP's "Your selection" panel calls, rather than
    // re-derived here. The figures are the seeded `glam-booth-all-types`
    // group 1900000103, measured on the local stack at both quantity 1 and 3.
    const markup = render([
      {
        addonId: "1900000103",
        name: "Extra Hours",
        value: "Extra hour (per guest)",
        price: "20",
        priceType: "quantity_based",
      },
      {
        addonId: "1900000103",
        name: "Extra Hours",
        value: "Premium finish (10%)",
        price: "10",
        priceType: "percentage_based",
      },
    ]);
    expect(markup).toContain("+$20.00 each");
    expect(markup).toContain("+10%");
  });

  it("renders NO suffix for a free option", () => {
    const markup = render([free("1900000001", "Add-ons", "Sharing Station")]);
    expect(markup).toContain("Sharing Station");
    expect(markup).not.toContain("+");
    expect(markup).not.toContain("A$");
  });

  it("renders the store currency it is given, not a hard-coded one", () => {
    const priced: AddonDisplay[] = [
      {
        addonId: "1",
        name: "Extras",
        value: "Rush",
        price: "5",
        priceType: "flat_fee",
      },
    ];
    expect(render(priced, "AUD")).toContain("+$5.00");
    expect(render(priced, "USD")).toContain("+$5.00");
  });

  it("prices only the options that carry one, leaving free rows bare", () => {
    // The Pblr line the tax-display bug was reported against: two free
    // selections and two paid ones on one product.
    const markup = render([
      free("1900000001", "Add-ons", "Sharing Station (Included)"),
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
      free("1900000003", "Backdrop Design", "White"),
    ]);
    expect(markup).toContain("+$10.00");
    expect(markup).toContain("+$50.00");
    // Two suffixes, not four: the free rows contribute no money at all.
    expect(markup.split("$").length - 1).toBe(2);
  });

  it("never renders the raw price_type string", () => {
    expect(render(ORDER_230)).not.toContain("flat_fee");
  });

  it("ignores a fieldType riding along on a wider selection object", () => {
    // `fieldType` is populated for a live cart but always empty for a placed
    // order, so no display may branch on it. Same selection, two different
    // fieldTypes, byte-identical markup.
    const withField = (fieldType: string): AddonDisplay =>
      ({
        addonId: "1900000001",
        name: "Add-ons",
        value: "Animated Welcome Screen",
        price: "10",
        priceType: "flat_fee",
        fieldType,
      }) as AddonDisplay;

    expect(render([withField("checkbox")])).toBe(render([withField("")]));
  });
});

describe("AddonDetails — indistinguishable from the gift-card panel", () => {
  const addonClasses = panelClasses(addonSource);
  const giftClasses = panelClasses(giftCardSource);

  it.each([
    ["corner radius", "rounded-"],
    ["horizontal padding", "px-"],
    ["vertical padding", "py-"],
    ["row gap", "space-y-"],
    ["tinted ground", "bg-"],
    ["meta type size", "text-x"],
  ])("%s is string-identical to gift-card-details.tsx", (_label, prefix) => {
    expect(classWithPrefix(addonClasses, prefix)).toBe(
      classWithPrefix(giftClasses, prefix),
    );
  });

  it("uses the whole gift-card panel class string, in the same order", () => {
    expect(addonClasses).toBe(giftClasses);
  });

  it("gives its title the same weight and colour the gift-card title has", () => {
    expect(addonSource).toContain('className="font-semibold text-primary"');
    expect(giftCardSource).toContain('className="font-semibold text-primary"');
  });

  it("labels its rows with the same muted span the gift-card rows use", () => {
    expect(addonSource).toContain('className="text-gray-400"');
    expect(giftCardSource).toContain('className="text-gray-400"');
  });

  it("names gift-card-details.tsx as the source of the off-scale values", () => {
    expect(addonSource).toContain("gift-card-details.tsx");
  });
});
