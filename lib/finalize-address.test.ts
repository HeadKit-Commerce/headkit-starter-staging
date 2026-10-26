import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINALIZE_ADDRESS_LOG_PREFIX,
  buildFinalizeAddresses,
} from "./finalize-address";

/**
 * A finalize never sends `country: ""` (or a country NAME): WooCommerce
 * validates against a CODE list and refuses the already-paid order. Each geo
 * field falls back across every source and is OMITTED when none carries it.
 */

const FULL = {
  firstName: "Ada",
  lastName: "Lovelace",
  address1: "1 Queen Street",
  address2: "Unit 2",
  city: "Adelaide",
  state: "SA",
  postcode: "5000",
  country: "AU",
  phone: "0400000000",
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("buildFinalizeAddresses", () => {
  it("builds the same pair as before when every source is complete", () => {
    const { billingAddress, shippingAddress, omittedFields } =
      buildFinalizeAddresses(
        { billingCookie: FULL, sessionShipping: FULL },
        { billingEmail: "ada@example.com", phonePolicy: "emit-empty" },
      );
    expect(billingAddress).toEqual({ ...FULL, email: "ada@example.com" });
    expect(shippingAddress).toEqual(FULL);
    expect(omittedFields).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("falls back across sources for a missing country instead of sending ''", () => {
    const { billingAddress, shippingAddress } = buildFinalizeAddresses({
      billingCookie: { ...FULL, country: "" },
      sessionShipping: { ...FULL, country: "NZ" },
    });
    expect(billingAddress.country).toBe("NZ");
    expect(shippingAddress.country).toBe("NZ");
  });

  it("maps a country NAME to its code", () => {
    const { billingAddress } = buildFinalizeAddresses({
      billingCookie: { ...FULL, country: "New Zealand" },
    });
    expect(billingAddress.country).toBe("NZ");
  });

  it("skips an unusable country and keeps walking the chain", () => {
    const { billingAddress } = buildFinalizeAddresses({
      billingCookie: { ...FULL, country: "Narnia" },
      sessionBilling: { ...FULL, country: "gb" },
    });
    expect(billingAddress.country).toBe("GB");
  });

  it("OMITS a geo field no source carries, and logs field names only", () => {
    const { billingAddress, shippingAddress, omittedFields } =
      buildFinalizeAddresses(
        {
          billingCookie: { ...FULL, country: "", state: "", postcode: "" },
        },
        { context: "test" },
      );
    for (const address of [billingAddress, shippingAddress]) {
      expect("country" in address).toBe(false);
      expect("state" in address).toBe(false);
      expect("postcode" in address).toBe(false);
    }
    expect(omittedFields).toEqual([
      "billing.country",
      "billing.state",
      "billing.postcode",
      "shipping.country",
      "shipping.state",
      "shipping.postcode",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]?.join(" ") ?? "";
    expect(line).toContain(FINALIZE_ADDRESS_LOG_PREFIX);
    // No personal data reaches the log.
    expect(line).not.toContain("Queen Street");
    expect(line).not.toContain("Ada");
  });

  it("never emits an empty country, state or postcode for any source shape", () => {
    const shapes = [{}, { country: "" }, { country: "  " }, { country: "??" }];
    for (const shape of shapes) {
      const { billingAddress, shippingAddress } = buildFinalizeAddresses({
        billingCookie: shape,
        sessionShipping: shape,
      });
      for (const address of [billingAddress, shippingAddress]) {
        for (const field of ["country", "state", "postcode"] as const) {
          if (field in address) expect(address[field]).not.toBe("");
        }
      }
    }
  });

  it("keeps each page's phone policy", () => {
    const noPhone = { ...FULL, phone: "" };
    expect(
      buildFinalizeAddresses(
        { billingCookie: noPhone },
        { phonePolicy: "emit-empty" },
      ).billingAddress.phone,
    ).toBe("");
    expect(
      "phone" in
        buildFinalizeAddresses(
          { billingCookie: noPhone },
          { phonePolicy: "omit-empty" },
        ).billingAddress,
    ).toBe(false);
    expect(
      buildFinalizeAddresses(
        { billingCookie: noPhone },
        { billingPhoneFallback: "0411111111" },
      ).billingAddress.phone,
    ).toBe("0411111111");
  });

  it("replaces a repeated billing given name with the shipping surname on the same street", () => {
    const { billingAddress, shippingAddress } = buildFinalizeAddresses({
      billingCookie: { ...FULL, lastName: "Ada" },
      sessionShipping: { ...FULL, lastName: "Lovelace" },
    });
    expect(billingAddress.firstName).toBe("Ada");
    expect(billingAddress.lastName).toBe("Lovelace");
    expect(shippingAddress.lastName).toBe("Lovelace");
  });

  it("fills an empty billing surname from shipping", () => {
    const { billingAddress } = buildFinalizeAddresses({
      billingCookie: { ...FULL, lastName: "" },
      sessionShipping: FULL,
    });
    expect(billingAddress.lastName).toBe("Lovelace");
  });

  it("keeps a real billing surname", () => {
    const { billingAddress } = buildFinalizeAddresses({
      billingCookie: { ...FULL, lastName: "Byron" },
      sessionShipping: { ...FULL, lastName: "Lovelace" },
    });
    expect(billingAddress.lastName).toBe("Byron");
  });

  it("does not borrow a surname from a different street", () => {
    const { billingAddress } = buildFinalizeAddresses({
      billingCookie: {
        ...FULL,
        lastName: "Ada",
        address1: "9 Other Street",
      },
      sessionShipping: FULL,
    });
    expect(billingAddress.lastName).toBe("Ada");
  });

  it("keeps the whole-address precedence the pages used", () => {
    const shippingCookie = { ...FULL, city: "Darwin" };
    const sessionBilling = { ...FULL, city: "Hobart" };
    const { billingAddress, shippingAddress } = buildFinalizeAddresses({
      sessionBilling,
      shippingCookie,
    });
    expect(billingAddress.city).toBe("Hobart");
    expect(shippingAddress.city).toBe("Darwin");
  });
});
