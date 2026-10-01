import { describe, it, expect } from "vitest";
import {
  snakeCase,
  buildFieldIdByName,
  buildFieldValues,
} from "./gravity-form-utils";
import { encodeCheckboxSelection } from "./gravity-form-fields";

describe("snakeCase", () => {
  it("lowercases, replaces whitespace, strips punctuation", () => {
    expect(snakeCase("First Name")).toBe("first_name");
    expect(snakeCase("Product URL")).toBe("product_url");
    expect(snakeCase("Product Colour")).toBe("product_colour");
    expect(snakeCase("E-mail Address!")).toBe("email_address");
  });
});

describe("buildFieldIdByName", () => {
  it("maps every field's snakeCased label to its databaseId, including hidden fields", () => {
    const nodes = [
      { databaseId: 1, label: "Name" },
      { databaseId: 2, label: "Email" },
      { databaseId: 3, label: "Message" },
      // hidden product-enquiry fields — never rendered, but must still map:
      { databaseId: 4, label: "Product Name" },
      { databaseId: 5, label: "Product URL" },
      { databaseId: 6, label: "Product Size" },
      { databaseId: 7, label: "Product Colour" },
    ];
    expect(buildFieldIdByName(nodes)).toEqual({
      name: 1,
      email: 2,
      message: 3,
      product_name: 4,
      product_url: 5,
      product_size: 6,
      product_colour: 7,
    });
  });

  it("skips nodes with a missing label and tolerates null/undefined input", () => {
    expect(
      buildFieldIdByName([
        { databaseId: 1, label: "Name" },
        { databaseId: 2, label: null },
        undefined,
        null,
      ]),
    ).toEqual({ name: 1 });
    expect(buildFieldIdByName(null)).toEqual({});
    expect(buildFieldIdByName(undefined)).toEqual({});
  });
});

describe("buildFieldValues", () => {
  const fieldIdByName = {
    name: 1,
    email: 2,
    message: 3,
    product_name: 4,
    product_url: 5,
  };

  it("attaches the numeric databaseId to every known field, visible or hidden", () => {
    const values = {
      name: "Ada",
      email: "ada@example.com",
      // injected hidden product context — the ENG-794 regression: these MUST
      // carry their id so the commerce provider does not drop them.
      product_name: "Trail Bike",
      product_url: "https://shop.test/products/trail-bike",
    };
    expect(buildFieldValues(values, fieldIdByName)).toEqual([
      { id: 1, value: "Ada" },
      { id: 2, value: "ada@example.com" },
      { id: 4, value: "Trail Bike" },
      { id: 5, value: "https://shop.test/products/trail-bike" },
    ]);
  });

  it("sends unknown keys without an id (preserves prior contract)", () => {
    expect(buildFieldValues({ mystery: "x" }, fieldIdByName)).toEqual([
      { value: "x" },
    ]);
  });

  it("coerces nullish values to empty strings", () => {
    expect(
      buildFieldValues({ name: undefined as unknown as string }, fieldIdByName),
    ).toEqual([{ id: 1, value: "" }]);
  });
});

describe("buildFieldValues: Checkboxes fields", () => {
  const fieldIdByName = { interests: 3, email: 2 };
  const choices = [
    { text: "Road", value: "Road", inputId: "3.1" },
    { text: "Gravel", value: "Gravel", inputId: "3.2" },
    { text: "Track", value: "Track", inputId: "3.11" },
  ];

  it("expands a multi-choice selection into one value per ticked choice", () => {
    // Gravity Forms reads a Checkboxes field only per input
    // (`GF_Field_Checkbox::get_value_submission()` loops `$this->inputs`), so a
    // single flat value under the field id is discarded with no error.
    const values = {
      interests: encodeCheckboxSelection(["Road", "Track"]),
      email: "ada@example.com",
    };
    expect(
      buildFieldValues(values, fieldIdByName, {
        interests: { choices },
      }),
    ).toEqual([
      { inputId: "3.1", value: "Road" },
      { inputId: "3.11", value: "Track" },
      { id: 2, value: "ada@example.com" },
    ]);
  });

  it("sends nothing for a field with no box ticked", () => {
    expect(
      buildFieldValues(
        { interests: encodeCheckboxSelection([]) },
        fieldIdByName,
        { interests: { choices } },
      ),
    ).toEqual([]);
  });

  it("keeps the single flat value for a checkbox with no choices", () => {
    // The marketing opt-in shape, and what every form submitted before. Not
    // listed in `checkboxFields`, so it falls through unchanged.
    expect(buildFieldValues({ interests: "true" }, fieldIdByName, {})).toEqual([
      { id: 3, value: "true" },
    ]);
  });

  it("falls back to the field id when the theme sent no input id", () => {
    // A store on a WordPress theme below 0.4.68 cannot tell us which input to
    // post to. Dropping the shopper's answer would be worse than sending it
    // where it has always been sent.
    expect(
      buildFieldValues(
        { interests: encodeCheckboxSelection(["Road"]) },
        fieldIdByName,
        { interests: { choices: [{ text: "Road", value: "Road" }] } },
      ),
    ).toEqual([{ id: 3, value: "Road" }]);
  });
});
