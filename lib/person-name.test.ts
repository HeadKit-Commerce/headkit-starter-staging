import { describe, expect, it } from "vitest";
import { personNameFromAddressValue, surnameFromDonor } from "./person-name";

describe("personNameFromAddressValue", () => {
  it("keeps a multi-word surname from the combined name", () => {
    expect(personNameFromAddressValue({ name: "Ada García López" })).toEqual({
      firstName: "Ada",
      lastName: "García López",
    });
  });

  it("reads a normal two-part name", () => {
    expect(personNameFromAddressValue({ name: "Ada Lovelace" })).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("prefers a structured surname when the combined name repeats the given name", () => {
    expect(
      personNameFromAddressValue({
        name: "Ada Ada",
        firstName: "Ada",
        lastName: "Lovelace",
      }),
    ).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });

  it("prefers a structured surname when the combined name has none", () => {
    expect(
      personNameFromAddressValue({
        name: "Ada",
        firstName: "Ada",
        lastName: "Lovelace",
      }),
    ).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });

  it("keeps the combined surname when that is the name the shopper can see", () => {
    expect(
      personNameFromAddressValue({
        name: "Ada Lovelace",
        firstName: "Ada",
        lastName: "Byron",
      }),
    ).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });

  it("leaves a genuine repeated given name when nothing else was collected", () => {
    expect(
      personNameFromAddressValue({ name: "John John", lastName: "John" }),
    ).toEqual({ firstName: "John", lastName: "John" });
  });
});

describe("surnameFromDonor", () => {
  const street = { address1: "1 Queen Street" };

  it("borrows the shipping surname when billing repeated the given name", () => {
    expect(
      surnameFromDonor(
        { firstName: "Ada", lastName: "Ada", ...street },
        { firstName: "Ada", lastName: "Lovelace", ...street },
      ),
    ).toBe("Lovelace");
  });

  it("borrows when the billing surname is empty", () => {
    expect(
      surnameFromDonor(
        { firstName: "Ada", lastName: "", ...street },
        { firstName: "Ada", lastName: "García López", ...street },
      ),
    ).toBe("García López");
  });

  it("keeps a real billing surname", () => {
    expect(
      surnameFromDonor(
        { firstName: "Ada", lastName: "Byron", ...street },
        { firstName: "Ada", lastName: "Lovelace", ...street },
      ),
    ).toBe("");
  });

  it("does not borrow across a different street", () => {
    expect(
      surnameFromDonor(
        { firstName: "Ada", lastName: "Ada", address1: "9 Other Street" },
        { firstName: "Ada", lastName: "Lovelace", ...street },
      ),
    ).toBe("");
  });

  it("does not borrow from a different given name", () => {
    expect(
      surnameFromDonor(
        { firstName: "Grace", lastName: "", ...street },
        { firstName: "Ada", lastName: "Lovelace", ...street },
      ),
    ).toBe("");
  });
});
