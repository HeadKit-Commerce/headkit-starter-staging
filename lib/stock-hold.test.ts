import { describe, expect, it } from "vitest";
import {
  bagAlertsFromSearch,
  bagUrl,
  holdOutcomeFromError,
  holdRefusalFromError,
  lineDisplayName,
  paymentIntentIdFromClientSecret,
  planStockCorrections,
  stockAlertText,
  type StockAlert,
} from "./stock-hold";

const lines = [
  {
    key: "k-small",
    name: "Base Layer",
    quantity: 1,
    variation: [{ value: "White" }, { value: "Small" }],
  },
  { key: "k-gloves", name: "Gloves", quantity: 3, variation: [] },
  { key: "k-frame", name: "Frame", quantity: 2 },
];

describe("planStockCorrections — one correction and one alert per refused line (plan v3 §2.2)", () => {
  it("removes an unavailable line and reduces a short one to what is available", () => {
    const { corrections, alerts } = planStockCorrections(
      [
        { code: "OUT_OF_STOCK", itemKey: "k-small", available: 0 },
        { code: "INSUFFICIENT_STOCK", itemKey: "k-gloves", available: 2 },
      ],
      lines,
    );
    expect(corrections).toEqual([
      { itemKey: "k-small", action: "remove", quantity: 0 },
      { itemKey: "k-gloves", action: "reduce", quantity: 2 },
    ]);
    expect(alerts).toEqual([
      { kind: "removed", name: "Base Layer – White, Small" },
      { kind: "reduced", name: "Gloves", quantity: 2 },
    ]);
  });

  it("removes a line another shopper's hold has taken (insufficient, available 0)", () => {
    expect(
      planStockCorrections(
        [{ code: "INSUFFICIENT_STOCK", itemKey: "k-gloves", available: 0 }],
        lines,
      ).corrections,
    ).toEqual([{ itemKey: "k-gloves", action: "remove", quantity: 0 }]);
  });

  it("removes a no-longer-purchasable line whatever it says is available", () => {
    expect(
      planStockCorrections(
        [{ code: "NOT_PURCHASABLE", itemKey: "k-gloves", available: 5 }],
        lines,
      ).corrections,
    ).toEqual([{ itemKey: "k-gloves", action: "remove", quantity: 0 }]);
  });

  it("reduces a sold-individually line to one", () => {
    expect(
      planStockCorrections(
        [{ code: "QUANTITY_LIMIT", itemKey: "k-frame", available: 1 }],
        lines,
      ).corrections,
    ).toEqual([{ itemKey: "k-frame", action: "reduce", quantity: 1 }]);
  });

  it("removes a short line whose remaining count is not reported, rather than guess", () => {
    expect(
      planStockCorrections(
        [{ code: "INSUFFICIENT_STOCK", itemKey: "k-gloves" }],
        lines,
      ).corrections,
    ).toEqual([{ itemKey: "k-gloves", action: "remove", quantity: 0 }]);
  });

  it("turns issues that name no line of this cart into ONE generic alert and no correction", () => {
    const { corrections, alerts } = planStockCorrections(
      [
        { code: "OUT_OF_STOCK" },
        { code: "OUT_OF_STOCK", itemKey: "not-in-cart" },
      ],
      lines,
    );
    expect(corrections).toEqual([]);
    expect(alerts).toEqual([{ kind: "unnamed" }]);
  });

  it("corrects a line once even when two issues name it", () => {
    const { corrections } = planStockCorrections(
      [
        { code: "OUT_OF_STOCK", itemKey: "k-small", available: 0 },
        { code: "INSUFFICIENT_STOCK", itemKey: "k-small", available: 0 },
      ],
      lines,
    );
    expect(corrections).toHaveLength(1);
  });
});

describe("alert wording (plan v2 §2.3, starter says 'cart')", () => {
  it.each<[StockAlert, string]>([
    [
      { kind: "removed", name: "Base Layer – White, Small" },
      "Unfortunately Base Layer – White, Small is now unavailable and has been removed from your cart. You have not been charged.",
    ],
    [
      { kind: "reduced", name: "Gloves", quantity: 2 },
      "Unfortunately only 2 × Gloves are available. Your cart has been updated. You have not been charged.",
    ],
    [
      { kind: "reduced", name: "Gloves", quantity: 1 },
      "Unfortunately only 1 × Gloves is available. Your cart has been updated. You have not been charged.",
    ],
    [
      { kind: "unnamed" },
      "Unfortunately items in your cart are now unavailable. Your cart has been updated.",
    ],
    [
      { kind: "hold_failed" },
      "We couldn't reserve your items just now. Please try again — you have not been charged.",
    ],
  ])("%j", (alert, text) => {
    expect(stockAlertText(alert)).toBe(text);
  });

  it("names a variation line with its values", () => {
    expect(lineDisplayName(lines[0]!)).toBe("Base Layer – White, Small");
    expect(lineDisplayName({ key: "x", name: "Socks" })).toBe("Socks");
  });
});

describe("the bag hand-off", () => {
  it("round-trips the alerts through the bag URL", () => {
    const alerts: StockAlert[] = [
      { kind: "removed", name: "Base Layer – White, Small" },
      { kind: "reduced", name: "Gloves", quantity: 2 },
      { kind: "unnamed" },
    ];
    const url = bagUrl(alerts);
    expect(url.startsWith("/?bag_alerts=")).toBe(true);
    expect(bagAlertsFromSearch(url.slice(1))).toEqual(alerts);
  });

  it("drops anything malformed rather than render it", () => {
    expect(bagAlertsFromSearch("?bag_alerts=not-json")).toEqual([]);
    expect(bagAlertsFromSearch("?bag_alerts=%7B%7D")).toEqual([]);
    expect(
      bagAlertsFromSearch(
        `?bag_alerts=${encodeURIComponent(JSON.stringify([{ kind: "removed" }, { kind: "evil", name: "<script>" }, { kind: "unnamed" }]))}`,
      ),
    ).toEqual([{ kind: "unnamed" }]);
    expect(bagAlertsFromSearch("?other=1")).toEqual([]);
  });
});

describe("refusals carried by a thrown SDK error (read server-side)", () => {
  const sdkError = (extensions: Record<string, unknown>) => ({
    errors: [{ message: "x", extensions }],
  });

  it("reads a CART_ITEM_UNAVAILABLE refusal with its issues", () => {
    const issues = [{ code: "OUT_OF_STOCK", itemKey: "k", available: 0 }];
    expect(
      holdRefusalFromError(sdkError({ code: "CART_ITEM_UNAVAILABLE", issues })),
    ).toEqual({ status: "refused", issues });
  });

  it("reads CHECKOUT_STOCK_HOLD_UNAVAILABLE as unavailable", () => {
    expect(
      holdRefusalFromError(
        sdkError({ code: "CHECKOUT_STOCK_HOLD_UNAVAILABLE" }),
      ),
    ).toEqual({ status: "unavailable" });
  });

  it("does not claim an unrelated error is a refusal — but the hold itself fails closed on it", () => {
    const other = sdkError({ code: "NO_CHARGEABLE_TOTAL" });
    expect(holdRefusalFromError(other)).toBeNull();
    expect(holdRefusalFromError(new Error("network"))).toBeNull();
    expect(holdOutcomeFromError(other)).toEqual({ status: "unavailable" });
    expect(holdOutcomeFromError(new Error("network"))).toEqual({
      status: "unavailable",
    });
  });
});

it("derives a PaymentIntent id from its client secret", () => {
  expect(paymentIntentIdFromClientSecret("pi_3Abc_secret_xyz")).toBe("pi_3Abc");
  expect(paymentIntentIdFromClientSecret("seti_1_secret_x")).toBeNull();
  expect(paymentIntentIdFromClientSecret("garbage")).toBeNull();
});
