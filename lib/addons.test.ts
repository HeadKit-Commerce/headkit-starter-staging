import { describe, expect, it, vi } from "vitest";
import {
  addonPricePrefix,
  attributeAddonError,
  buildAddonsConfiguration,
  buildAddonsVerify,
  estimateAddonsTotal,
  formatAddonPriceSuffix,
  hasBlockingAddon,
  visibleAddonOptions,
  type AddonGroupShape,
  type AddonSelection,
} from "./addons";

/**
 * The wire contract these tests lock is NOT this module's invention — it is the
 * WooCommerce Product Add-Ons extension's own, measured in 14.1-RESEARCH
 * (§Pitfall 5, §Price Semantics) and re-measured live in 14.1-04. Getting one
 * row of the encoder table wrong does not fail here; it fails at the store with
 * `woocommerce_pao_invalid_addon_value`, which is why every shipped type has its
 * own case rather than being covered "in aggregate".
 *
 * Two properties are load-bearing beyond mere correctness:
 *
 *  1. A wire index is the option's position in the array the theme SENT, never
 *     its position among the options that were rendered. 14.1-01 measured that
 *     `get_product_addons()` publishes `visibility: 0` options rather than
 *     stripping them, and the extension's validator indexes into that same
 *     array — so a client that reindexes buys a different option at a different
 *     price (R1). The hidden-option cases below are that property, not polish.
 *
 *  2. No price the client computed can reach the request. `estimateAddonsTotal`
 *     is a preview for the shopper's eyes only; `buildAddonsConfiguration` has
 *     no field one could travel in, and a test asserts the estimate's own value
 *     appears nowhere in the builder's output.
 */

const OPTION = (
  label: string,
  price: string,
  priceType = "flat_fee",
  visibility = 1,
): AddonGroupShape["options"][number] => ({
  label,
  price,
  priceType,
  visibility,
});

const GROUP = (
  over: Partial<AddonGroupShape> & Pick<AddonGroupShape, "id" | "type">,
): AddonGroupShape => ({
  name: "Group",
  price: "",
  priceType: "flat_fee",
  options: [],
  ...over,
});

/** Every key the storefront puts on the wire must be a run of digits — the
 *  extension compares `(int) $addon['id'] === $key` (RESEARCH Pitfall 4). */
function expectDigitKeys(config: Record<string, unknown>): void {
  for (const key of Object.keys(config)) {
    expect(key).toMatch(/^[0-9]+$/);
  }
}

describe("visibleAddonOptions", () => {
  it("suppresses a hidden option while keeping every other option's received index", () => {
    const group = GROUP({
      id: "1",
      type: "multiple_choice",
      options: [
        OPTION("Hidden Legacy", "5", "flat_fee", 0),
        OPTION("Classic White", ""),
        OPTION("Sequin Gold", "25"),
      ],
    });

    const rendered = visibleAddonOptions(group);

    expect(rendered.map((r) => r.option.label)).toEqual([
      "Classic White",
      "Sequin Gold",
    ]);
    // The rendered list is 2 long, but the indexes are 1 and 2 — the positions
    // in the array the theme sent. Renumbering these to 0 and 1 is the mis-buy.
    expect(rendered.map((r) => r.index)).toEqual([1, 2]);
  });

  it("returns every option in received order when none is hidden", () => {
    const group = GROUP({
      id: "1",
      type: "checkbox",
      options: [OPTION("A", ""), OPTION("B", "10")],
    });
    expect(visibleAddonOptions(group).map((r) => r.index)).toEqual([0, 1]);
  });
});

describe("buildAddonsConfiguration", () => {
  it("emits an ARRAY of indexes for a checkbox group", () => {
    const addons = [
      GROUP({
        id: "1900000001",
        type: "checkbox",
        options: [OPTION("A", ""), OPTION("B", "10"), OPTION("C", "20")],
      }),
    ];
    const config = buildAddonsConfiguration(addons, { "1900000001": [0, 2] });
    expect(config).toEqual({ "1900000001": [0, 2] });
    expectDigitKeys(config);
  });

  it("emits an array for a checkbox group even when one option is chosen", () => {
    // The asymmetry that catches people: checkbox is an array of one, NOT a
    // scalar. The shape comes from the group's `type`, never from the value.
    const addons = [
      GROUP({
        id: "1900000001",
        type: "checkbox",
        options: [OPTION("A", ""), OPTION("B", "10")],
      }),
    ];
    expect(buildAddonsConfiguration(addons, { "1900000001": 1 })).toEqual({
      "1900000001": [1],
    });
  });

  it("emits a BARE INTEGER for a multiple_choice group", () => {
    const addons = [
      GROUP({
        id: "1900000002",
        type: "multiple_choice",
        options: [OPTION("Hardcover", "50"), OPTION("Personalised", "95")],
      }),
    ];
    const config = buildAddonsConfiguration(addons, { "1900000002": 1 });
    expect(config).toEqual({ "1900000002": 1 });
    expect(Array.isArray(config["1900000002"])).toBe(false);
    expectDigitKeys(config);
  });

  it("emits a string for custom_text", () => {
    const addons = [GROUP({ id: "1900000004", type: "custom_text" })];
    const config = buildAddonsConfiguration(addons, {
      "1900000004": "Sam & Alex, 12 Dec",
    });
    expect(config).toEqual({ "1900000004": "Sam & Alex, 12 Dec" });
    expectDigitKeys(config);
  });

  it("emits a string for custom_textarea", () => {
    const addons = [GROUP({ id: "1900000105", type: "custom_textarea" })];
    const config = buildAddonsConfiguration(addons, {
      "1900000105": "Two hours, outdoor setup",
    });
    expect(config).toEqual({ "1900000105": "Two hours, outdoor setup" });
    expectDigitKeys(config);
  });

  it("emits a string for datepicker", () => {
    const addons = [GROUP({ id: "1900000106", type: "datepicker" })];
    const config = buildAddonsConfiguration(addons, {
      "1900000106": "2026-12-12",
    });
    expect(config).toEqual({ "1900000106": "2026-12-12" });
    expectDigitKeys(config);
  });

  it("emits a NUMBER for input_multiplier, even when the control held a string", () => {
    const addons = [
      GROUP({
        id: "1900000107",
        type: "input_multiplier",
        price: "5",
        priceType: "quantity_based",
      }),
    ];
    const config = buildAddonsConfiguration(addons, { "1900000107": "40" });
    expect(config).toEqual({ "1900000107": 40 });
    expect(typeof config["1900000107"]).toBe("number");
    expectDigitKeys(config);
  });

  it("emits a NUMBER for custom_price, even when the control held a string", () => {
    const addons = [GROUP({ id: "1900000108", type: "custom_price" })];
    const config = buildAddonsConfiguration(addons, { "1900000108": "25.50" });
    expect(config).toEqual({ "1900000108": 25.5 });
    expect(typeof config["1900000108"]).toBe("number");
    expectDigitKeys(config);
  });

  it("never emits a heading entry, whatever the selection state holds", () => {
    const addons = [
      GROUP({ id: "1900000101", type: "heading" }),
      GROUP({
        id: "1900000102",
        type: "multiple_choice",
        options: [OPTION("Gold", "25")],
      }),
    ];
    const config = buildAddonsConfiguration(addons, {
      // A heading has no control, so this value can only arrive by accident —
      // and the extension's validators skip headings entirely (cart.php:247).
      "1900000101": 0,
      "1900000102": 0,
    });
    expect(config).toEqual({ "1900000102": 0 });
    expect(Object.keys(config)).not.toContain("1900000101");
  });

  it("never emits a file_upload entry — it is out of scope (D-14.1-05)", () => {
    const addons = [GROUP({ id: "1900000201", type: "file_upload" })];
    expect(
      buildAddonsConfiguration(addons, {
        "1900000201": "https://example.test/a.png",
      }),
    ).toEqual({});
  });

  it("omits a group with no selection — an unselected REQUIRED group is simply absent", () => {
    const addons = [
      GROUP({
        id: "1900000003",
        type: "multiple_choice",
        options: [OPTION("Classic White", ""), OPTION("Sequin Gold", "25")],
      }),
    ];
    // The server rejects this, and that rejection is what the shopper sees.
    // The client does not pre-empt it (D-14.1-02).
    expect(buildAddonsConfiguration(addons, {})).toEqual({});
  });

  it("omits a text group whose value is blank or whitespace", () => {
    const addons = [GROUP({ id: "1900000004", type: "custom_text" })];
    expect(buildAddonsConfiguration(addons, { "1900000004": "   " })).toEqual(
      {},
    );
  });

  it("omits a checkbox group whose selection is an empty array", () => {
    const addons = [
      GROUP({
        id: "1900000001",
        type: "checkbox",
        options: [OPTION("A", "")],
      }),
    ];
    expect(buildAddonsConfiguration(addons, { "1900000001": [] })).toEqual({});
  });

  it("omits a numeric group whose value is blank or unparseable", () => {
    const addons = [
      GROUP({ id: "1900000107", type: "input_multiplier", price: "5" }),
      GROUP({ id: "1900000108", type: "custom_price" }),
    ];
    expect(
      buildAddonsConfiguration(addons, {
        "1900000107": "",
        "1900000108": "abc",
      }),
    ).toEqual({});
  });

  it("emits index 1 for the second RECEIVED option even when the first is hidden and not rendered", () => {
    // The core R1 property. The rendered list here is one element long; if the
    // encoder took the rendered position the wire value would be 0, and the
    // shopper would be charged for the hidden legacy option instead.
    const addons = [
      GROUP({
        id: "1900000003",
        type: "multiple_choice",
        options: [
          OPTION("Hidden Legacy", "5", "flat_fee", 0),
          OPTION("Classic White", ""),
        ],
      }),
    ];
    const rendered = visibleAddonOptions(addons[0]!);
    expect(rendered).toHaveLength(1);

    const config = buildAddonsConfiguration(addons, {
      "1900000003": rendered[0]!.index,
    });
    expect(config).toEqual({ "1900000003": 1 });
  });

  it("keeps checkbox indexes aligned to the received array when a middle option is hidden", () => {
    const addons = [
      GROUP({
        id: "1900000001",
        type: "checkbox",
        options: [
          OPTION("A", ""),
          OPTION("Hidden", "5", "flat_fee", 0),
          OPTION("C", "20"),
        ],
      }),
    ];
    const rendered = visibleAddonOptions(addons[0]!);
    const config = buildAddonsConfiguration(addons, {
      "1900000001": rendered.map((r) => r.index),
    });
    expect(config).toEqual({ "1900000001": [0, 2] });
  });

  it("drops a group whose id is not a run of digits rather than putting it on the wire", () => {
    const addons = [
      GROUP({ id: "229-0", type: "custom_text" }),
      GROUP({ id: "1900000004", type: "custom_text" }),
    ];
    const config = buildAddonsConfiguration(addons, {
      "229-0": "positional field_name, never a wire key (D-14.1-03)",
      "1900000004": "ok",
    });
    expect(config).toEqual({ "1900000004": "ok" });
    expectDigitKeys(config);
  });

  it("carries no key or value derived from the estimated total", () => {
    const addons = [
      GROUP({
        id: "1900000002",
        type: "multiple_choice",
        options: [OPTION("Hardcover", "50")],
      }),
      GROUP({ id: "1900000108", type: "custom_price" }),
    ];
    const selection: AddonSelection = {
      "1900000002": 0,
      "1900000108": "25.50",
    };
    const estimate = estimateAddonsTotal(addons, selection, 1299, 1);
    expect(estimate).toBeGreaterThan(0);

    const config = buildAddonsConfiguration(addons, selection);
    const serialised = JSON.stringify(config);

    // Neither the total nor its add-on component may appear anywhere in the
    // payload, under any key. There is no price field by construction — this
    // asserts that construction rather than trusting it.
    expect(serialised).not.toContain(String(estimate));
    expect(serialised).not.toContain("1374.5");
    expect(serialised).not.toContain("price");
    expect(Object.values(config)).not.toContain(estimate);
  });
});

describe("buildAddonsVerify", () => {
  it("maps the chosen index to the label rendered for it, per selected group", () => {
    const addons = [
      GROUP({
        id: "1900000001",
        type: "checkbox",
        options: [
          OPTION("Sharing Station (Included)", ""),
          OPTION("Animated Welcome Screen", "10"),
        ],
      }),
      GROUP({
        id: "1900000003",
        type: "multiple_choice",
        options: [OPTION("Classic White", ""), OPTION("Sequin Gold", "25")],
      }),
    ];
    expect(
      buildAddonsVerify(addons, {
        "1900000001": [0, 1],
        "1900000003": 1,
      }),
    ).toEqual({
      "1900000001": {
        "0": "Sharing Station (Included)",
        "1": "Animated Welcome Screen",
      },
      "1900000003": { "1": "Sequin Gold" },
    });
  });

  it("omits a group with no selection", () => {
    const addons = [
      GROUP({
        id: "1900000003",
        type: "multiple_choice",
        options: [OPTION("Classic White", "")],
      }),
    ];
    expect(buildAddonsVerify(addons, {})).toEqual({});
  });

  it("omits groups that address no option — text, date and numeric types", () => {
    const addons = [
      GROUP({ id: "1900000004", type: "custom_text" }),
      GROUP({ id: "1900000106", type: "datepicker" }),
      GROUP({ id: "1900000107", type: "input_multiplier", price: "5" }),
    ];
    expect(
      buildAddonsVerify(addons, {
        "1900000004": "Sam",
        "1900000106": "2026-12-12",
        "1900000107": "40",
      }),
    ).toEqual({});
  });

  it("keys by the RECEIVED index when an earlier option is hidden", () => {
    const addons = [
      GROUP({
        id: "1900000003",
        type: "multiple_choice",
        options: [
          OPTION("Hidden Legacy", "5", "flat_fee", 0),
          OPTION("Classic White", ""),
        ],
      }),
    ];
    expect(buildAddonsVerify(addons, { "1900000003": 1 })).toEqual({
      "1900000003": { "1": "Classic White" },
    });
  });

  it("echoes the label byte-for-byte, without decoding entities", () => {
    // The theme compares sanitize_title(echoed) against sanitize_title(stored),
    // and `stored` is the encoded form. Decoding here would make an honest
    // selection look like drift.
    const addons = [
      GROUP({
        id: "1900000003",
        type: "multiple_choice",
        options: [OPTION("Sam &amp; Alex", "")],
      }),
    ];
    expect(buildAddonsVerify(addons, { "1900000003": 0 })).toEqual({
      "1900000003": { "0": "Sam &amp; Alex" },
    });
  });

  it("ignores an index that addresses no option", () => {
    const addons = [
      GROUP({
        id: "1900000003",
        type: "multiple_choice",
        options: [OPTION("Classic White", "")],
      }),
    ];
    expect(buildAddonsVerify(addons, { "1900000003": 99 })).toEqual({});
  });
});

describe("estimateAddonsTotal", () => {
  const flatFee = GROUP({
    id: "1",
    type: "multiple_choice",
    options: [OPTION("Late pack-down", "50", "flat_fee")],
  });
  const quantityBased = GROUP({
    id: "2",
    type: "multiple_choice",
    options: [OPTION("Extra hour", "20", "quantity_based")],
  });
  const percentageBased = GROUP({
    id: "3",
    type: "multiple_choice",
    options: [OPTION("Premium finish", "10", "percentage_based")],
  });
  const multiplier = GROUP({
    id: "4",
    type: "input_multiplier",
    price: "5",
    priceType: "quantity_based",
  });
  const customPrice = GROUP({
    id: "5",
    type: "custom_price",
    price: "",
    priceType: "flat_fee",
  });

  it("case 1 — flat_fee is charged ONCE PER LINE, not per unit", () => {
    // Measured (RESEARCH §Price Semantics rule 3): a $50 flat fee on qty 2
    // reports as +$25/unit in the Store API. That division is a reporting
    // artifact of the response, not of the charge.
    const atOne = estimateAddonsTotal([flatFee], { "1": 0 }, 100, 1);
    const atThree = estimateAddonsTotal([flatFee], { "1": 0 }, 100, 3);

    expect(atOne).toBe(150);
    expect(atThree).toBe(350);
    expect(atOne - 100 * 1).toBe(50);
    expect(atThree - 100 * 3).toBe(50);
  });

  it("case 2 — quantity_based is added per unit and multiplies with quantity", () => {
    expect(estimateAddonsTotal([quantityBased], { "2": 0 }, 100, 1)).toBe(120);
    expect(estimateAddonsTotal([quantityBased], { "2": 0 }, 100, 3)).toBe(360);
  });

  it("case 3 — percentage_based adds base x pct/100, per unit", () => {
    expect(estimateAddonsTotal([percentageBased], { "3": 0 }, 100, 2)).toBe(
      220,
    );
  });

  it("case 4 — input_multiplier multiplies the GROUP price by the typed number", () => {
    // The group prices, not an option — six of the eight shipped types do
    // (14.1-03's Rule 2 deviation). Its price_type still governs the line.
    expect(estimateAddonsTotal([multiplier], { "4": "10" }, 100, 1)).toBe(150);
    expect(estimateAddonsTotal([multiplier], { "4": "10" }, 100, 2)).toBe(300);
  });

  it("case 5 — custom_price contributes the typed amount itself", () => {
    expect(estimateAddonsTotal([customPrice], { "5": "25.50" }, 100, 2)).toBe(
      225.5,
    );
  });

  it("returns the base line total unchanged when nothing priced is selected", () => {
    expect(
      estimateAddonsTotal([flatFee, quantityBased], {}, 1299, 2),
    ).toBeCloseTo(2598, 5);
  });

  it("treats an option whose price is empty, zero or absent as contributing nothing", () => {
    const free = GROUP({
      id: "6",
      type: "checkbox",
      options: [
        OPTION("Sharing Station (Included)", ""),
        OPTION("Zero priced", "0"),
      ],
    });
    expect(estimateAddonsTotal([free], { "6": [0, 1] }, 1299, 1)).toBe(1299);
  });

  it("sums several groups and several checkbox options together", () => {
    const combined = estimateAddonsTotal(
      [flatFee, quantityBased, percentageBased],
      { "1": 0, "2": 0, "3": 0 },
      100,
      2,
    );
    // base 200 + flat 50 + quantity 20x2 + percentage 100x0.1x2 = 310
    expect(combined).toBe(310);
  });
});

describe("formatAddonPriceSuffix", () => {
  it("renders the three price types in three distinct formats", () => {
    expect(formatAddonPriceSuffix("50", "flat_fee", "USD")).toBe("+$50.00");
    expect(formatAddonPriceSuffix("20", "quantity_based", "USD")).toBe(
      "+$20.00 each",
    );
    expect(formatAddonPriceSuffix("10", "percentage_based", "USD")).toBe(
      "+10%",
    );
  });

  it("renders no suffix at all when the price is empty, zero or absent", () => {
    expect(formatAddonPriceSuffix("", "flat_fee", "USD")).toBeNull();
    expect(formatAddonPriceSuffix("0", "flat_fee", "USD")).toBeNull();
    expect(formatAddonPriceSuffix(undefined, "flat_fee", "USD")).toBeNull();
  });
});

describe("addonPricePrefix", () => {
  /** The `ch` multiplier out of the calc() expression — the reserved room. */
  const reserved = (currency: string): number => {
    const padding = addonPricePrefix(currency).paddingLeft;
    expect(
      padding,
      `${currency} produced no padding override at all`,
    ).toBeDefined();
    const match = /([\d.]+)ch/.exec(padding!);
    expect(
      match,
      `${currency}'s reservation carries no ch term — the room is not derived ` +
        `from the prefix: ${padding}`,
    ).not.toBeNull();
    return Number(match![1]);
  };

  it("derives the symbol Intl produces for the store's currency", () => {
    // The multi-character half — the currencies that reproduce UAT gap 2.
    // AUD / NZD / CAD used to be here; `formatPrice` now prints them in their
    // own locale, so they join the single-character half below.
    expect(addonPricePrefix("BRL").symbol).toBe("R$");
    expect(addonPricePrefix("HKD").symbol).toBe("HK$");
    // CHF formats as `CHF 0.00`; the separating space is stripped with the
    // digits, so three characters reach the reservation, not four.
    expect(addonPricePrefix("CHF").symbol).toBe("CHF");
    // The single-character half — the currencies that never showed the defect.
    expect(addonPricePrefix("USD").symbol).toBe("$");
    expect(addonPricePrefix("AUD").symbol).toBe("$");
    expect(addonPricePrefix("NZD").symbol).toBe("$");
    expect(addonPricePrefix("CAD").symbol).toBe("$");
    expect(addonPricePrefix("EUR").symbol).toBe("€");
    expect(addonPricePrefix("GBP").symbol).toBe("£");
  });

  it("never yields an empty symbol for a currency the store can be set to", () => {
    for (const currency of [
      "AUD",
      "NZD",
      "CAD",
      "CHF",
      "BRL",
      "USD",
      "EUR",
      "GBP",
    ]) {
      expect(
        addonPricePrefix(currency).symbol.length,
        `${currency} rendered no symbol at all`,
      ).toBeGreaterThan(0);
    }
  });

  it("reserves STRICTLY more room the longer the prefix is — USD < BRL < CHF", () => {
    // An INEQUALITY over the parsed multiplier, deliberately not an equality
    // against a literal padding string: a literal would re-encode exactly the
    // kind of constant this function exists to remove, and would pass while the
    // reservation was wrong for every currency at once.
    expect(reserved("USD")).toBeLessThan(reserved("BRL"));
    expect(reserved("BRL")).toBeLessThan(reserved("CHF"));
  });

  it("fails if HKD ever stops being multi-character, so the coverage above cannot go vacuous", () => {
    // The self-invalidation guard. If a future formatPrice or locale change
    // renders HKD as a bare `$`, every multi-character case above silently
    // becomes a single-character case and stops testing the defect. This is
    // where that goes red instead. (AUD was the guard until `formatPrice`
    // began printing it as `$`; HKD has no entry in its locale map.)
    expect(
      addonPricePrefix("HKD").symbol.length,
      "HKD no longer renders a multi-character symbol — the multi-character " +
        "coverage in this describe is now vacuous and the geometric e2e case " +
        "will report absence of failure rather than a pass",
    ).toBeGreaterThan(1);
  });

  it("leaves the primitive's own padding alone when the symbol comes back empty", async () => {
    // Scoped to this test (`doMock` + `resetModules`, not a hoisted `vi.mock`)
    // so the rest of this file keeps the real formatter. No real currency
    // strips to nothing, so this defensive branch is only reachable here — and
    // it matters: an empty symbol with a computed override would reserve the
    // gap and nothing else, i.e. LESS room than today.
    vi.resetModules();
    vi.doMock("@/lib/utils", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/utils")>("@/lib/utils");
      return { ...actual, formatPrice: () => "0.00" };
    });
    const { addonPricePrefix: withEmptySymbol } = await import("./addons");
    const result = withEmptySymbol("ZZZ");
    expect(result.symbol).toBe("");
    expect(
      result.paddingLeft,
      "an empty symbol produced a padding override — that reserves the gap " +
        "and nothing else, which is less room than the primitive already has",
    ).toBeUndefined();
    vi.doUnmock("@/lib/utils");
    vi.resetModules();
  });
});

describe("hasBlockingAddon", () => {
  it("is true only when a file_upload group is present", () => {
    expect(
      hasBlockingAddon([GROUP({ id: "1900000201", type: "file_upload" })]),
    ).toBe(true);
    expect(
      hasBlockingAddon([GROUP({ id: "1900000004", type: "custom_text" })]),
    ).toBe(false);
    expect(hasBlockingAddon([])).toBe(false);
  });
});

describe("attributeAddonError", () => {
  const addons = [
    GROUP({
      id: "1900000003",
      name: "Backdrop Design",
      type: "multiple_choice",
      options: [OPTION("Classic White", "")],
    }),
    GROUP({ id: "1900000004", name: "Event Message", type: "custom_text" }),
  ];

  it("resolves an error carrying an add-on id to that group", () => {
    expect(
      attributeAddonError(addons, {
        code: "woocommerce_pao_invalid_addon_value",
        message: "Invalid value for add-on ID: 1900000003, index 99",
        addonId: "1900000003",
      }).addonId,
    ).toBe("1900000003");
  });

  it("resolves an error carrying only a group name, case-insensitively", () => {
    expect(
      attributeAddonError(addons, {
        code: "woocommerce_rest_cart_invalid_product_addons",
        message: '"Backdrop Design" is a required field.',
        field: "backdrop DESIGN",
      }).addonId,
    ).toBe("1900000003");
  });

  it("falls back to the group name quoted in the message when no field is sent", () => {
    expect(
      attributeAddonError(addons, {
        code: "woocommerce_rest_cart_item_error",
        message: '"Event Message" is a required field.',
      }).addonId,
    ).toBe("1900000004");
  });

  it("gives the same answer for an entity-encoded message and its decoded twin", () => {
    // Measured twice in this phase: the cart-errors path double-encodes the
    // quotes PAO's sprintf put around the group name, the direct 400 does not.
    const encoded = attributeAddonError(addons, {
      code: "woocommerce_rest_cart_item_error",
      message: "&quot;Backdrop Design&quot; is a required field.",
    });
    const decoded = attributeAddonError(addons, {
      code: "woocommerce_rest_cart_invalid_product_addons",
      message: '"Backdrop Design" is a required field.',
    });

    expect(encoded.addonId).toBe("1900000003");
    expect(encoded.addonId).toBe(decoded.addonId);
    expect(encoded.message).toBe(decoded.message);
  });

  it("returns the message entity-decoded, verbatim otherwise", () => {
    expect(
      attributeAddonError(addons, {
        code: "headkit_addon_option_drift",
        message:
          "This product&#039;s options changed while you were choosing. Please review your selection.",
      }).message,
    ).toBe(
      "This product's options changed while you were choosing. Please review your selection.",
    );
  });

  it("returns no attribution when neither an id nor a name matches", () => {
    expect(
      attributeAddonError(addons, {
        code: "headkit_addon_option_drift",
        message:
          "This product's options changed while you were choosing. Please review your selection.",
      }).addonId,
    ).toBeNull();

    expect(
      attributeAddonError(addons, {
        code: "woocommerce_pao_invalid_addon_id",
        message: "Invalid add-on ID: 1900009999",
        addonId: "1900009999",
      }).addonId,
    ).toBeNull();
  });

  it("does not mine an id out of the required-field message — there is none in it", () => {
    // RESEARCH measured this message and it carries the group NAME and no id at
    // all, so a pattern hunting for one matches something else in a translated
    // string. Here the only digits in the sentence are a red herring.
    expect(
      attributeAddonError(addons, {
        code: "woocommerce_rest_cart_invalid_product_addons",
        message: '"Backdrop Design" is a required field. 1900000004',
        field: "Backdrop Design",
      }).addonId,
    ).toBe("1900000003");
  });
});
