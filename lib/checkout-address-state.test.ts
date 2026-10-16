import { describe, expect, it } from "vitest";

import {
  countryRequiresState,
  resolveStateForCountry,
} from "@/lib/checkout-address-state";

/**
 * The two rules that keep a checkout address's `state` coherent with the
 * country beside it. Both exist because of one production refusal
 * (www.bikesociety.com.au, 2026-10-16): an AU `VIC` left in the form through a
 * country switch to NZ, pushed back out to WooCommerce, answered
 * `invalid_state` — "The provided state (VIC) is not valid. Must be one of:
 * NTL, AUK, … OTA, STL" — which stopped the shopper at Delivery with a generic
 * "the store rejected this cart operation" toast and no field to correct.
 *
 * What these cases pin, in the order they matter:
 *
 *   1. the exact production pair (NZ + VIC) resolves to no state at all, and
 *      the reverse (AU + an NZ region) does too — a mismatch is symmetric;
 *   2. NZ does NOT require a state while AU does, so the form can no longer
 *      demand one it has no field to collect;
 *   3. a country we keep no state table for behaves exactly as before — its
 *      value passes through untouched rather than being silently dropped.
 *      Same for a hand-typed name on the no-Stripe fallback path, which is a
 *      free-text input.
 *
 * What they cannot see: whether WooCommerce agrees. The code tables mirror
 * `woocommerce/i18n/states.php` and the required-state rule mirrors
 * `WC_Countries::get_country_locale()`; that those mirrors are faithful is a
 * claim about the upstream store, verified against the production error body
 * quoted above (NZ with an empty state is accepted; NZ with `VIC` is not).
 */

describe("resolveStateForCountry", () => {
  it("drops the state from the production refusal (NZ carrying AU's VIC)", () => {
    expect(resolveStateForCountry("NZ", "VIC")).toBe("");
  });

  it("drops a mismatch in the other direction too (AU carrying an NZ region)", () => {
    expect(resolveStateForCountry("AU", "AUK")).toBe("");
  });

  it("keeps a state that belongs to the selected country", () => {
    expect(resolveStateForCountry("AU", "VIC")).toBe("VIC");
    expect(resolveStateForCountry("NZ", "AUK")).toBe("AUK");
  });

  it("keeps a code both countries share, under either of them", () => {
    // AU Tasmania and NZ Tasman are both `TAS`; the lookup is per country, so
    // a shared code must not read as a mismatch for either.
    expect(resolveStateForCountry("AU", "TAS")).toBe("TAS");
    expect(resolveStateForCountry("NZ", "TAS")).toBe("TAS");
  });

  it("matches the country and the code case-insensitively, returning the value as given", () => {
    expect(resolveStateForCountry("au", "vic")).toBe("vic");
    expect(resolveStateForCountry(" NZ ", " AUK ")).toBe("AUK");
  });

  it("passes through a state for a country it keeps no table for", () => {
    // No table means no evidence of a mismatch, so behaviour is unchanged for
    // every country a store might add before its codes are enumerated.
    expect(resolveStateForCountry("US", "CA")).toBe("CA");
    expect(resolveStateForCountry("GB", "Greater London")).toBe(
      "Greater London",
    );
  });

  it("keeps a hand-typed region name, which only the no-Stripe path can produce", () => {
    // `Victoria` is a state of no country's code list, so there is no positive
    // evidence of a mismatch and the free-text input is not silently emptied.
    expect(resolveStateForCountry("AU", "Victoria")).toBe("Victoria");
  });

  it("sends no state when there is no country to own it", () => {
    expect(resolveStateForCountry("", "VIC")).toBe("");
    expect(resolveStateForCountry(undefined, "VIC")).toBe("");
    expect(resolveStateForCountry(null, "VIC")).toBe("");
  });

  it("normalises an absent or blank state to an empty string", () => {
    expect(resolveStateForCountry("AU", "")).toBe("");
    expect(resolveStateForCountry("AU", "   ")).toBe("");
    expect(resolveStateForCountry("AU", undefined)).toBe("");
    expect(resolveStateForCountry("NZ", null)).toBe("");
  });
});

describe("countryRequiresState", () => {
  it("does not require one for NZ", () => {
    // WooCommerce's NZ locale is `state => { required: false, label: 'Region' }`
    // and the Stripe address element renders no State field there, so requiring
    // one is an error the shopper cannot clear.
    expect(countryRequiresState("NZ")).toBe(false);
  });

  it("still requires one for AU and for the other countries that do", () => {
    expect(countryRequiresState("AU")).toBe(true);
    expect(countryRequiresState("US")).toBe(true);
    expect(countryRequiresState("CA")).toBe(true);
  });

  it("reads the country case-insensitively", () => {
    expect(countryRequiresState("au")).toBe(true);
    expect(countryRequiresState(" nz ")).toBe(false);
  });

  it("requires nothing when no country is selected", () => {
    // The form's own "Country is required" issue covers that case; adding a
    // second error for a field the shopper cannot reach only obscures it.
    expect(countryRequiresState("")).toBe(false);
    expect(countryRequiresState(undefined)).toBe(false);
    expect(countryRequiresState(null)).toBe(false);
  });

  it("defaults an un-tabled country to not requiring one", () => {
    // Deliberate direction: a wrong `required` strands the shopper with no
    // field to type into, while a wrong `optional` costs at most the upstream
    // refusal that WooCommerce is the authority on anyway.
    expect(countryRequiresState("GB")).toBe(false);
  });
});
