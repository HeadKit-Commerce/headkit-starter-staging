import { afterEach, describe, expect, it, vi } from "vitest";
import {
  billingCountryFieldMessage,
  billingCountryRefusalMessage,
  countryRefusal,
  isCountryAllowed,
  logCountryRefusal,
  NO_COUNTRY_RESTRICTION,
  normalizeCountriesMode,
  normalizeCountryList,
  resolveAllowedCountries,
  shippingCountryRefusalMessage,
  type AllowedCountries,
  type CountryPolicy,
} from "./allowed-countries";

/**
 * The pure rules of the pre-charge country gate. Covers the decision and the
 * sentences only — which gate calls them, and in what order against the
 * writes, is asserted beside each gate (card step, billing step, wallet).
 */

const specific = (countries: string[]): CountryPolicy => ({
  countries,
  mode: "specific",
});
const allExcept = (countries: string[]): CountryPolicy => ({
  countries,
  mode: "all_except",
});

const AU_NZ_STORE: AllowedCountries = {
  billing: specific(["AU", "NZ"]),
  shipping: specific(["AU"]),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isCountryAllowed — WooCommerce's three modes", () => {
  it("`all` refuses nothing, whatever the list says", () => {
    expect(isCountryAllowed("US", { countries: ["AU"], mode: "all" })).toBe(
      true,
    );
    expect(isCountryAllowed("US", { countries: [], mode: "all" })).toBe(true);
  });

  it("`specific` allows only the listed countries", () => {
    expect(isCountryAllowed("AU", specific(["AU", "NZ"]))).toBe(true);
    expect(isCountryAllowed("nz", specific(["AU", "NZ"]))).toBe(true);
    expect(isCountryAllowed("US", specific(["AU", "NZ"]))).toBe(false);
  });

  it("`all_except` refuses only the listed countries", () => {
    expect(isCountryAllowed("US", allExcept(["RU"]))).toBe(true);
    expect(isCountryAllowed("RU", allExcept(["RU"]))).toBe(false);
  });

  it("an empty list allows everything under both list modes", () => {
    expect(isCountryAllowed("US", specific([]))).toBe(true);
    expect(isCountryAllowed("US", allExcept([]))).toBe(true);
  });

  it("allows whatever it cannot decide: no policy, no country, junk", () => {
    expect(isCountryAllowed("US", null)).toBe(true);
    expect(isCountryAllowed("US", undefined)).toBe(true);
    expect(isCountryAllowed("", specific(["AU"]))).toBe(true);
    expect(isCountryAllowed(null, specific(["AU"]))).toBe(true);
    expect(isCountryAllowed("Atlantis", specific(["AU"]))).toBe(true);
  });

  it("reads an English country name the way the finalize does", () => {
    expect(isCountryAllowed("United States", specific(["AU"]))).toBe(false);
    expect(isCountryAllowed("New Zealand", specific(["NZ"]))).toBe(true);
  });
});

describe("resolveAllowedCountries — the gateway's fields", () => {
  it("a missing policy is no restriction", () => {
    expect(resolveAllowedCountries(null)).toBe(NO_COUNTRY_RESTRICTION);
    expect(resolveAllowedCountries(undefined)).toBe(NO_COUNTRY_RESTRICTION);
  });

  it("takes billing's mode from the gateway and keeps shipping a plain list", () => {
    expect(
      resolveAllowedCountries({
        allowedBillingCountries: ["au", "NZ", "AU"],
        allowedShippingCountries: ["AU"],
        allowedBillingCountriesMode: "specific",
      }),
    ).toEqual({
      billing: { countries: ["AU", "NZ"], mode: "specific" },
      shipping: { countries: ["AU"], mode: "specific" },
    });
  });

  it("`all` with empty lists is the gateway's no-restriction pair", () => {
    const policy = resolveAllowedCountries({
      allowedBillingCountries: [],
      allowedShippingCountries: [],
      allowedBillingCountriesMode: "all",
    });
    expect(
      countryRefusal({ billingCountry: "US", shippingCountry: "US", policy }),
    ).toBeNull();
  });

  it("billing and shipping are independent axes", () => {
    // Sells everywhere, ships to AU only.
    const policy = resolveAllowedCountries({
      allowedBillingCountries: [],
      allowedShippingCountries: ["AU"],
      allowedBillingCountriesMode: "all",
    });
    expect(isCountryAllowed("US", policy.billing)).toBe(true);
    expect(isCountryAllowed("US", policy.shipping)).toBe(false);
  });

  it("absent fields resolve to a policy that refuses nothing", () => {
    const policy = resolveAllowedCountries({});
    expect(
      countryRefusal({ billingCountry: "US", shippingCountry: "US", policy }),
    ).toBeNull();
  });
});

describe("normalisers", () => {
  it("drops junk entries instead of failing the list", () => {
    expect(
      normalizeCountryList(["AU", "", "nope", null, "Australia", "nz"]),
    ).toEqual(["AU", "NZ"]);
    expect(normalizeCountryList(null)).toEqual([]);
  });

  it("reads an unknown mode as `specific`, so the list is honoured", () => {
    expect(normalizeCountriesMode("ALL")).toBe("all");
    expect(normalizeCountriesMode(" all_except ")).toBe("all_except");
    expect(normalizeCountriesMode("specific")).toBe("specific");
    expect(normalizeCountriesMode("weird")).toBe("specific");
    expect(normalizeCountriesMode(null)).toBe("specific");
  });
});

describe("countryRefusal — billing vs shipping", () => {
  it("refuses a disallowed billing country first", () => {
    const refusal = countryRefusal({
      billingCountry: "US",
      shippingCountry: "GB",
      policy: AU_NZ_STORE,
    });
    expect(refusal?.axis).toBe("billing");
    expect(refusal?.country).toBe("US");
  });

  it("refuses a disallowed destination when billing is allowed", () => {
    const refusal = countryRefusal({
      billingCountry: "NZ",
      shippingCountry: "NZ",
      policy: AU_NZ_STORE,
    });
    expect(refusal).toEqual({
      axis: "shipping",
      country: "NZ",
      message: "We don't deliver to New Zealand. We deliver to Australia.",
    });
  });

  it("lets an allowed pair through", () => {
    expect(
      countryRefusal({
        billingCountry: "NZ",
        shippingCountry: "AU",
        policy: AU_NZ_STORE,
      }),
    ).toBeNull();
  });

  it("no shipping country (Click & Collect) checks billing only", () => {
    expect(
      countryRefusal({ billingCountry: "NZ", policy: AU_NZ_STORE }),
    ).toBeNull();
  });

  it("a missing policy refuses nothing", () => {
    expect(
      countryRefusal({ billingCountry: "US", shippingCountry: "US" }),
    ).toBeNull();
    expect(
      countryRefusal({
        billingCountry: "US",
        shippingCountry: "US",
        policy: null,
      }),
    ).toBeNull();
  });
});

describe("the sentences a shopper reads", () => {
  it("billing under `specific` names the alternatives and the refused country", () => {
    expect(billingCountryRefusalMessage("US", specific(["AU", "NZ"]))).toBe(
      "We can only accept payments with a billing address in Australia or New Zealand." +
        " This payment's billing address is in United States." +
        " Please use a card or billing address in one of those countries.",
    );
  });

  it("billing under `all_except` never lists the exclusions as alternatives", () => {
    const message = billingCountryRefusalMessage("RU", allExcept(["RU", "BY"]));
    expect(message).toBe(
      "We can't accept payments with a billing address in Russia." +
        " Please use a card or billing address in another country.",
    );
    expect(message).not.toContain("Belarus");
  });

  it("shipping lists a set with `and`", () => {
    expect(shippingCountryRefusalMessage("US", specific(["AU", "NZ"]))).toBe(
      "We don't deliver to United States. We deliver to Australia and New Zealand.",
    );
    expect(shippingCountryRefusalMessage("RU", allExcept(["RU"]))).toBe(
      "We don't deliver to Russia.",
    );
  });

  it("the billing field message is short", () => {
    expect(billingCountryFieldMessage("US", specific(["AU", "NZ"]))).toBe(
      "We can only accept billing addresses in Australia or New Zealand.",
    );
    expect(billingCountryFieldMessage("RU", allExcept(["RU"]))).toBe(
      "We can't accept billing addresses in Russia.",
    );
  });

  it("an allowed country has no sentence at all", () => {
    expect(billingCountryRefusalMessage("AU", specific(["AU"]))).toBeNull();
    expect(shippingCountryRefusalMessage("AU", specific(["AU"]))).toBeNull();
    expect(billingCountryFieldMessage("AU", specific(["AU"]))).toBeNull();
  });

  it("no sentence ever shows a raw code", () => {
    const message = billingCountryRefusalMessage("us", specific(["AU", "NZ"]));
    expect(message).not.toMatch(/\b(AU|NZ|US|us)\b/);
  });
});

describe("logs carry no personal data", () => {
  it("a refusal logs the axis, context, code and policy only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logCountryRefusal(
      { axis: "billing", country: "US" },
      AU_NZ_STORE,
      "wallet-confirm",
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const [prefix, payload] = warn.mock.calls[0] as [string, string];
    expect(prefix).toBe("[country-gate] refused before charge");
    expect(JSON.parse(payload)).toEqual({
      axis: "billing",
      context: "wallet-confirm",
      country: "US",
      mode: "specific",
      allowed: ["AU", "NZ"],
    });
  });
});
