import { describe, expect, it } from "vitest";
import { GraphQLError } from "@headkit/sdk";
import {
  CART_ITEM_UNAVAILABLE,
  UNAVAILABLE_ITEM_MESSAGE,
  cartIssues,
  cartNeedsAttention,
  hasBlockingCartIssues,
  isCartItemUnavailableError,
  issueForLine,
  lineIssueMessage,
} from "./cart-issues";

// The 2026-10-17 shape: one line went out of stock (no backorders) while it
// sat in the cart; commerce attributes the issue to the line and marks it.
const soldOut = {
  issues: [
    {
      code: "OUT_OF_STOCK",
      message:
        '"Base Layer - White, Small" is out of stock and cannot be purchased.',
      itemKey: "k-small",
      productName: "Base Layer - White, Small",
    },
  ],
  items: [
    { key: "k-small", stockStatus: "outofstock" },
    { key: "k-medium", stockStatus: "instock" },
  ],
};

describe("cart issues reader", () => {
  it("reads absent or null issues (older SDK / older gateway) as none", () => {
    expect(cartIssues(undefined)).toEqual([]);
    expect(cartIssues({})).toEqual([]);
    expect(cartIssues({ issues: null })).toEqual([]);
    expect(hasBlockingCartIssues({ issues: [] })).toBe(false);
    expect(
      cartNeedsAttention({ items: [{ key: "a", stockStatus: "instock" }] }),
    ).toBe(false);
  });

  it("finds the issue for the attributed line only", () => {
    expect(issueForLine(soldOut, soldOut.items[0]!)?.code).toBe("OUT_OF_STOCK");
    expect(issueForLine(soldOut, soldOut.items[1]!)).toBeNull();
    expect(hasBlockingCartIssues(soldOut)).toBe(true);
    expect(cartNeedsAttention(soldOut)).toBe(true);
  });

  it("falls back to the line's own sold-out stock status when issues are absent", () => {
    const legacy = { items: [{ key: "k", stockStatus: "outofstock" }] };
    expect(issueForLine(legacy, legacy.items[0]!)?.code).toBe("OUT_OF_STOCK");
    expect(cartNeedsAttention(legacy)).toBe(true);
  });

  it("a backorder line is not an issue (regression)", () => {
    const backorder = {
      issues: [],
      items: [{ key: "bo", stockStatus: "onbackorder" }],
    };
    expect(issueForLine(backorder, backorder.items[0]!)).toBeNull();
    expect(cartNeedsAttention(backorder)).toBe(false);
  });

  it("tells the shopper to remove or to reduce", () => {
    expect(lineIssueMessage({ code: "OUT_OF_STOCK" })).toBe(
      UNAVAILABLE_ITEM_MESSAGE,
    );
    expect(lineIssueMessage({ code: "NOT_PURCHASABLE" })).toBe(
      UNAVAILABLE_ITEM_MESSAGE,
    );
    expect(lineIssueMessage({ code: "INSUFFICIENT_STOCK" })).toMatch(
      /reduce the quantity/,
    );
  });
});

describe("isCartItemUnavailableError", () => {
  it("recognises the SDK GraphQLError carrying the code", () => {
    const err = new GraphQLError([
      {
        message: "no longer available",
        extensions: { code: CART_ITEM_UNAVAILABLE },
      },
    ]);
    expect(isCartItemUnavailableError(err)).toBe(true);
  });

  it("recognises a plain errors[] shape and rejects everything else", () => {
    expect(
      isCartItemUnavailableError({
        errors: [{ extensions: { code: CART_ITEM_UNAVAILABLE } }],
      }),
    ).toBe(true);
    expect(
      isCartItemUnavailableError(
        new GraphQLError([
          { message: "x", extensions: { code: "ORDER_REFUSED" } },
        ]),
      ),
    ).toBe(false);
    expect(isCartItemUnavailableError(new Error(CART_ITEM_UNAVAILABLE))).toBe(
      false,
    );
    expect(isCartItemUnavailableError(null)).toBe(false);
  });
});
