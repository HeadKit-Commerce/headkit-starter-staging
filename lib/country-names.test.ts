import { describe, expect, it } from "vitest";
import {
  allCountryCodes,
  countryCodeFrom,
  countryName,
  countryNameList,
} from "./country-names";

describe("country-names", () => {
  it("normalises codes and English names to ISO-2", () => {
    expect(countryCodeFrom("au")).toBe("AU");
    expect(countryCodeFrom(" New Zealand ")).toBe("NZ");
    expect(countryCodeFrom("United States")).toBe("US");
    expect(countryCodeFrom("Narnia")).toBe("");
    expect(countryCodeFrom("")).toBe("");
    expect(countryCodeFrom(null)).toBe("");
  });

  it("maps a name to its ISO code, never to a reserved or withdrawn alias", () => {
    // `Intl` also names UK / FX / DD / SU, which sort after the real codes.
    expect(countryCodeFrom("United Kingdom")).toBe("GB");
    expect(countryCodeFrom("France")).toBe("FR");
    expect(countryCodeFrom("Germany")).toBe("DE");
    expect(countryCodeFrom("Russia")).toBe("RU");
  });

  it("lists the assigned countries once, without aggregates", () => {
    const codes = allCountryCodes();
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThanOrEqual(249);
    for (const pseudo of ["EU", "UN", "UK", "ZZ", "SU"]) {
      expect(codes).not.toContain(pseudo);
    }
  });

  it("reads codes as names", () => {
    expect(countryName("nz")).toBe("New Zealand");
    expect(countryNameList(["AU"])).toBe("Australia");
    expect(countryNameList(["AU", "NZ", "US"])).toBe(
      "Australia, New Zealand or United States",
    );
    expect(countryNameList([])).toBe("");
  });
});
