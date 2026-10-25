// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StockAlert } from "@/lib/stock-hold";
import {
  consumeShopperRemovedLine,
  markShopperRemovedLine,
  previousCheckoutLines,
  rememberCheckoutLines,
  resetShopperCartEdits,
  scheduleForgetCheckoutLines,
  unseenRemovedLines,
} from "./shopper-cart-edit";

const both = new Map<string, string>([
  ["last", "Hold Last Unit"],
  ["plenty", "Hold Plenty"],
]);
const plentyOnly = new Map<string, string>([["plenty", "Hold Plenty"]]);

beforeEach(() => {
  resetShopperCartEdits();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  resetShopperCartEdits();
});

describe("unseenRemovedLines", () => {
  it("names a line that left the cart", () => {
    expect(unseenRemovedLines(both, plentyOnly, [])).toEqual([
      { kind: "removed", name: "Hold Last Unit" },
    ]);
  });

  it("says nothing the first time the cart is seen", () => {
    expect(unseenRemovedLines(null, plentyOnly, [])).toEqual([]);
  });

  it("skips a line the shopper removed", () => {
    markShopperRemovedLine("last");
    expect(unseenRemovedLines(both, plentyOnly, [])).toEqual([]);
    expect(consumeShopperRemovedLine("last")).toBe(false);
  });

  it("does not repeat a removed alert already on screen", () => {
    const existing: StockAlert[] = [
      { kind: "removed", name: "Hold Last Unit" },
    ];
    expect(unseenRemovedLines(both, plentyOnly, existing)).toEqual([]);
  });
});

describe("rememberCheckoutLines", () => {
  it("survives a remount of the same Checkout Session", () => {
    rememberCheckoutLines("cs_test", both);
    expect(previousCheckoutLines("cs_test")).toEqual(both);
  });

  it("keeps the lines in sessionStorage for the refresh that remounts empty", () => {
    rememberCheckoutLines("cs_test", both);
    const raw = sessionStorage.getItem("hk-checkout-seen-lines");
    resetShopperCartEdits();
    sessionStorage.setItem("hk-checkout-seen-lines", raw ?? "");
    expect(previousCheckoutLines("cs_test")).toEqual(both);
    expect(
      unseenRemovedLines(previousCheckoutLines("cs_test"), plentyOnly, []),
    ).toEqual([{ kind: "removed", name: "Hold Last Unit" }]);
  });

  it("keeps in-memory lines when the refresh mints a new session id", () => {
    rememberCheckoutLines("cs_test", both);
    expect(previousCheckoutLines("cs_new")).toEqual(both);
  });

  it("does not restore another session's lines after a reload", () => {
    rememberCheckoutLines("cs_test", both);
    const raw = sessionStorage.getItem("hk-checkout-seen-lines");
    resetShopperCartEdits();
    sessionStorage.setItem("hk-checkout-seen-lines", raw ?? "");
    expect(previousCheckoutLines("cs_other")).toBeNull();
  });

  it("forgets lines after checkout has left the screen", () => {
    vi.useFakeTimers();
    rememberCheckoutLines("cs_test", both);
    scheduleForgetCheckoutLines();
    vi.advanceTimersByTime(20_000);
    expect(previousCheckoutLines("cs_test")).toBeNull();
  });
});
