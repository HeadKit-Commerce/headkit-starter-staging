import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where the pre-charge country gate's policy COMES FROM, driven through the
 * real `getCountryPolicy` with the gateway read mocked.
 *
 * Covers: the value arrives off the commerce graph with NO dashboard-api
 * configured (the shape that shipped the fork's gate silently off), a failed
 * or field-less read falls back to "no gate" and logs once, and the next call
 * reaches the gateway again. Does NOT run a Next cache handler: `"use cache"`
 * is inert under vitest, so "a failure is never stored" rests on the throw
 * leaving the cached scope (asserted here as the read being re-issued) plus
 * the argument in the module header.
 */

const executeRequest = vi.fn();
const logError = vi.fn();

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));
vi.mock("@headkit/sdk", () => ({
  executeRequest: (...args: unknown[]) => executeRequest(...args),
  GetBrandingDocument: { kind: "Document" },
}));
vi.mock("@/lib/headkit-transport", () => ({
  headkitTransportOpts: () => ({ url: "https://gateway.test/graphql" }),
}));
// The rehearsal shape: no dashboard-api URL or token at all. Nothing in the
// policy read may depend on either.
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@/lib/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/logger")>()),
  logger: {
    error: (...args: unknown[]) => logError(...args),
    info: vi.fn(),
  },
}));
vi.mock("@/lib/branding", () => {
  throw new Error("the country policy must not import lib/branding");
});

import { getCountryPolicy } from "./country-policy";
import { NO_COUNTRY_RESTRICTION } from "./allowed-countries";

const GATEWAY_AU_NZ = {
  commerce: {
    branding: {
      iconUrl: null,
      primaryColor: null,
      secondaryColor: null,
      allowedBillingCountries: ["AU", "NZ"],
      allowedShippingCountries: ["AU", "NZ"],
      allowedBillingCountriesMode: "specific",
    },
  },
};

beforeEach(() => {
  executeRequest.mockReset();
  logError.mockReset();
});

describe("getCountryPolicy", () => {
  it("reads the store's policy off the commerce graph, with no dashboard-api configured", async () => {
    executeRequest.mockResolvedValue(GATEWAY_AU_NZ);
    await expect(getCountryPolicy()).resolves.toEqual({
      billing: { countries: ["AU", "NZ"], mode: "specific" },
      shipping: { countries: ["AU", "NZ"], mode: "specific" },
    });
    expect(executeRequest).toHaveBeenCalledTimes(1);
    expect(logError).not.toHaveBeenCalled();
  });

  it("a failed read is NO gate for this request, and says so once", async () => {
    executeRequest.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(getCountryPolicy()).resolves.toBe(NO_COUNTRY_RESTRICTION);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith("country_gate.policy_unavailable", {
      name: "Error",
      message: "ECONNREFUSED",
    });
  });

  it("`data: null` is a failure, not 'no restriction'", async () => {
    executeRequest.mockResolvedValue(null);
    await expect(getCountryPolicy()).resolves.toBe(NO_COUNTRY_RESTRICTION);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("a gateway that predates the fields is a failure too, and is logged", async () => {
    // The SDK transport strips an unknown field and retries, so an older
    // gateway answers SUCCESSFULLY with the keys absent.
    executeRequest.mockResolvedValue({
      commerce: {
        branding: { iconUrl: null, primaryColor: null, secondaryColor: null },
      },
    });
    await expect(getCountryPolicy()).resolves.toBe(NO_COUNTRY_RESTRICTION);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0]?.[1]?.message)).toContain(
      "allowedBillingCountriesMode",
    );
  });

  it("the next call after a failure reads the gateway again", async () => {
    executeRequest.mockRejectedValueOnce(new Error("timeout"));
    executeRequest.mockResolvedValueOnce(GATEWAY_AU_NZ);
    await expect(getCountryPolicy()).resolves.toBe(NO_COUNTRY_RESTRICTION);
    await expect(getCountryPolicy()).resolves.toMatchObject({
      billing: { countries: ["AU", "NZ"] },
    });
    expect(executeRequest).toHaveBeenCalledTimes(2);
  });
});
