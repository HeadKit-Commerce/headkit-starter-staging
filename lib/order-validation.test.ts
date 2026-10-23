import { describe, expect, it } from "vitest";
import { GraphQLError } from "@headkit/sdk";
import {
  allowedCountriesOrAll,
  blockedOrderBody,
  completeOrderFormFields,
  completeOrderPrefill,
  completeOrderSide,
  orderValidationBody,
  orderValidationContactSentence,
  orderValidationFormShape,
  orderValidationFromError,
  orderValidationIsRecoverable,
  parseValidationField,
  type OrderValidationFailure,
} from "./order-validation";

/**
 * The classifier is driven with the exact `field` values commerce emits
 * (`services/commerce/internal/provider/woocommerce/checkout_validation.go`):
 * `billing_email`, `billing_country`, `shipping_country`, `unknown`,
 * `<side>_<attribute>`, and a bare `<attribute>` when the side was unresolved.
 */

function typed(extensions: Record<string, unknown>): GraphQLError {
  return new GraphQLError([
    {
      message: "this order needs a corrected detail",
      extensions: { code: "ORDER_VALIDATION", ...extensions },
    },
  ]);
}

function failure(
  overrides: Partial<OrderValidationFailure> = {},
): OrderValidationFailure {
  return {
    reason: "woocommerce_rest_invalid_address_country",
    side: "billing",
    attribute: "country",
    message: null,
    allowedCountries: ["AU", "NZ"],
    ...overrides,
  };
}

describe("parseValidationField", () => {
  it.each([
    ["billing_email", "billing", "email"],
    ["billing_country", "billing", "country"],
    ["shipping_country", "shipping", "country"],
    ["shipping_postcode", "shipping", "postcode"],
    ["billing_address_1", "billing", "address_1"],
    ["postcode", "billing", "postcode"],
    ["unknown", "billing", null],
    ["", "billing", null],
    ["billing_shoe_size", "billing", null],
  ] as const)("%s → %s / %s", (field, side, attribute) => {
    expect(parseValidationField(field)).toEqual({ side, attribute });
  });
});

describe("orderValidationFromError", () => {
  it("reads the typed contract", () => {
    expect(
      orderValidationFromError(
        typed({
          reason: "woocommerce_rest_invalid_address_country",
          field: "billing_country",
          message: "Sorry, we do not allow orders from the provided country",
          allowedCountries: ["au", "NZ", "nz", "Australia"],
        }),
      ),
    ).toEqual({
      reason: "woocommerce_rest_invalid_address_country",
      side: "billing",
      attribute: "country",
      message: "Sorry, we do not allow orders from the provided country",
      allowedCountries: ["AU", "NZ"],
    });
  });

  it("is null for an untyped WooCommerce sentence — prose is never a contract", () => {
    expect(
      orderValidationFromError(
        new Error(
          "Sorry, we do not allow orders from the provided country (United States (US))",
        ),
      ),
    ).toBeNull();
  });

  it("is null for the refusal code and for a transient failure", () => {
    expect(
      orderValidationFromError(
        new GraphQLError([
          { message: "x", extensions: { code: "ORDER_REFUSED" } },
        ]),
      ),
    ).toBeNull();
    expect(orderValidationFromError(new Error("socket hang up"))).toBeNull();
  });
});

describe("form shape", () => {
  it("re-collects the billing block for a billing country", () => {
    const f = failure();
    expect(orderValidationIsRecoverable(f)).toBe(true);
    expect(orderValidationFormShape(f)).toBe("billing-address");
    expect(completeOrderFormFields(f)).toContain("country");
    expect(completeOrderSide(f)).toBe("billing");
  });

  it("asks only for an email for a missing receipt email", () => {
    const f = failure({ attribute: "email", allowedCountries: [] });
    expect(orderValidationFormShape(f)).toBe("email");
    expect(completeOrderFormFields(f)).toEqual(["email"]);
  });

  it("asks for one field, on its own side, for a single attribute", () => {
    const f = failure({
      side: "shipping",
      attribute: "postcode",
      allowedCountries: [],
    });
    expect(orderValidationFormShape(f)).toBe("single-field");
    expect(completeOrderFormFields(f)).toEqual(["postcode"]);
    expect(completeOrderSide(f)).toBe("shipping");
  });

  it("takes the whole billing block for an unnamed field", () => {
    const f = failure({ attribute: null, allowedCountries: [] });
    expect(orderValidationFormShape(f)).toBe("billing-address");
  });

  it("is BLOCKED, with no form, for a country the store does not ship to", () => {
    const f = failure({ side: "shipping", message: "We do not ship there." });
    expect(orderValidationIsRecoverable(f)).toBe(false);
    expect(orderValidationFormShape(f)).toBe("none");
    expect(completeOrderFormFields(f)).toEqual([]);
    expect(blockedOrderBody(f, "12")).toBe("We do not ship there.");
    expect(blockedOrderBody({ ...f, message: null }, "12")).toContain(
      "order #12",
    );
  });

  it("offers WooCommerce's countries, else every country — never a guess", () => {
    expect(allowedCountriesOrAll(failure())).toEqual(["AU", "NZ"]);
    const all = allowedCountriesOrAll(failure({ allowedCountries: [] }));
    expect(all.length).toBeGreaterThan(200);
    expect(all).toContain("US");
  });
});

describe("copy", () => {
  it("rewrites the billing-country refusal into a fix, naming countries not codes", () => {
    const body = orderValidationBody(failure(), "278931", "US");
    expect(body).toContain("United States");
    expect(body).toContain("Australia or New Zealand");
    expect(body).toContain("order #278931");
    expect(body).not.toMatch(/\b(US|AU|NZ)\b/);
  });

  it("names 'your order' when there is no order id (cart page)", () => {
    expect(orderValidationBody(failure(), "")).toContain("your order");
    expect(orderValidationContactSentence("").tail).not.toContain("#");
    expect(orderValidationContactSentence("7").tail).toContain("order #7");
  });

  it("prefers WooCommerce's sentence for any other field", () => {
    expect(
      orderValidationBody(
        failure({ attribute: "postcode", message: "Postcode is invalid." }),
        "1",
      ),
    ).toBe("Postcode is invalid.");
  });

  it("never renders the WooCommerce code", () => {
    for (const f of [
      failure(),
      failure({ attribute: "email" }),
      failure({ attribute: null }),
    ]) {
      expect(orderValidationBody(f, "1")).not.toContain("woocommerce_");
    }
  });
});

describe("completeOrderPrefill", () => {
  const shipping = {
    firstName: "Ada",
    address1: "1 Queen Street",
    country: "AU",
  };
  const billing = {
    firstName: "Wallet",
    address1: "1 Market Street",
    city: "San Francisco",
    country: "US",
    email: "billing@example.com",
  };

  it("opens a billing correction from the SHIPPING address, billing as fallback", () => {
    const prefill = completeOrderPrefill(failure(), { shipping, billing });
    expect(prefill.firstName).toBe("Ada");
    expect(prefill.city).toBe("San Francisco");
    expect(prefill.country).toBe("AU");
    expect(prefill.email).toBe("billing@example.com");
  });

  it("never seeds the select with the rejected country", () => {
    const prefill = completeOrderPrefill(failure(), {
      shipping: { country: "US" },
      billing,
    });
    expect(prefill.country).toBe("");
  });

  it("opens a shipping correction from shipping alone", () => {
    const prefill = completeOrderPrefill(
      failure({ side: "shipping", attribute: "postcode" }),
      { shipping, billing },
    );
    expect(prefill.city).toBe("");
    expect(prefill.address1).toBe("1 Queen Street");
  });
});
