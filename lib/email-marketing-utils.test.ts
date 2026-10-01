import { describe, expect, it } from "vitest";
import {
  extractEmailFromFormValues,
  hasMarketingOptIn,
  isMarketingOptInLabel,
} from "./email-marketing-utils";
import { snakeCase } from "./gravity-form-utils";
import { encodeCheckboxSelection } from "./gravity-form-fields";

describe("isMarketingOptInLabel", () => {
  it("matches common marketing labels", () => {
    expect(isMarketingOptInLabel("Subscribe to newsletter")).toBe(true);
    expect(isMarketingOptInLabel("Email me with offers")).toBe(true);
    expect(isMarketingOptInLabel("Join our mailing list")).toBe(true);
    expect(isMarketingOptInLabel("Marketing opt-in")).toBe(true);
  });

  it("rejects unrelated checkboxes", () => {
    expect(isMarketingOptInLabel("I agree to the terms")).toBe(false);
    expect(isMarketingOptInLabel("Ship to a different address")).toBe(false);
  });
});

describe("extractEmailFromFormValues", () => {
  it("prefers email-keyed fields", () => {
    expect(
      extractEmailFromFormValues({
        email: "a@example.com",
        name: "Ada",
      }),
    ).toBe("a@example.com");
  });

  it("falls back to any email-shaped value", () => {
    expect(
      extractEmailFromFormValues({
        your_address: "b@example.com",
      }),
    ).toBe("b@example.com");
  });
});

describe("hasMarketingOptIn", () => {
  it("is true when a marketing checkbox is checked", () => {
    const fields = [
      { type: "checkbox", label: "Subscribe to newsletter" },
      { type: "email", label: "Email" },
    ];
    expect(
      hasMarketingOptIn(
        fields,
        { subscribe_to_newsletter: "true", email: "a@example.com" },
        snakeCase,
      ),
    ).toBe(true);
  });

  it("is false when unchecked", () => {
    const fields = [{ type: "checkbox", label: "Subscribe to newsletter" }];
    expect(
      hasMarketingOptIn(
        fields,
        { subscribe_to_newsletter: "false" },
        snakeCase,
      ),
    ).toBe(false);
  });
});

describe("hasMarketingOptIn: both checkbox representations", () => {
  // Criterion the multi-choice change must not break: a single-choice marketing
  // opt-in has to keep reaching the subscribe path. Both shapes are live — a
  // checkbox field with no choices still submits "true"/"false", while a
  // Checkboxes field with choices submits its ticked choice values packed.

  it("fires for the legacy single-box shape, by field label", () => {
    const fields = [{ type: "checkbox", label: "Join our mailing list" }];
    expect(
      hasMarketingOptIn(fields, { join_our_mailing_list: "true" }, snakeCase),
    ).toBe(true);
    expect(
      hasMarketingOptIn(fields, { join_our_mailing_list: "false" }, snakeCase),
    ).toBe(false);
  });

  it("fires for a single-CHOICE Checkboxes field, by field label", () => {
    const fields = [
      {
        type: "checkbox",
        label: "Newsletter",
        choices: [{ text: "Yes please", value: "Yes please" }],
      },
    ];
    expect(
      hasMarketingOptIn(
        fields,
        { newsletter: encodeCheckboxSelection(["Yes please"]) },
        snakeCase,
      ),
    ).toBe(true);
    expect(
      hasMarketingOptIn(
        fields,
        { newsletter: encodeCheckboxSelection([]) },
        snakeCase,
      ),
    ).toBe(false);
  });

  it("fires when the marketing wording is on the CHOICE, not the field label", () => {
    // The common Gravity Forms shape: a neutral field label (often hidden) with
    // the opt-in sentence typed as the choice.
    const fields = [
      {
        type: "checkbox",
        label: "Preferences",
        choices: [
          { text: "Ship to a different address", value: "ship-elsewhere" },
          { text: "Add me to the mailing list", value: "subscribe" },
        ],
      },
    ];
    expect(
      hasMarketingOptIn(
        fields,
        { preferences: encodeCheckboxSelection(["subscribe"]) },
        snakeCase,
      ),
    ).toBe(true);
    // A ticked NON-marketing choice on the same field must not opt anyone in.
    expect(
      hasMarketingOptIn(
        fields,
        { preferences: encodeCheckboxSelection(["ship-elsewhere"]) },
        snakeCase,
      ),
    ).toBe(false);
  });

  it("does not fire for a multi-choice field with nothing ticked", () => {
    const fields = [
      {
        type: "checkbox",
        label: "Newsletter",
        choices: [{ text: "Yes", value: "Yes" }],
      },
    ];
    expect(hasMarketingOptIn(fields, { newsletter: "" }, snakeCase)).toBe(
      false,
    );
  });
});
