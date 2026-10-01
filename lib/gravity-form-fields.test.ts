import { describe, expect, it } from "vitest";
import {
  CHECKBOX_VALUE_SEPARATOR,
  buildFormDefaultValues,
  decodeCheckboxSelection,
  encodeCheckboxSelection,
  hasRenderableChoices,
  isCheckboxChecked,
  isCheckedDefault,
  isDescriptionAbove,
  isLabelVisible,
  resolvableTextDefault,
  selectedChoiceValues,
  validationMessage,
  type FormFieldSettings,
} from "./gravity-form-fields";
import { snakeCase } from "./gravity-form-utils";

function field(props: Partial<FormFieldSettings>): FormFieldSettings {
  return { type: "text", label: "Field", defaultValue: "", ...props };
}

describe("isLabelVisible", () => {
  it("hides a label only for hidden_label", () => {
    expect(isLabelVisible(field({ labelPlacement: "hidden_label" }))).toBe(
      false,
    );
    expect(isLabelVisible(field({ labelPlacement: "" }))).toBe(true);
    expect(isLabelVisible(field({}))).toBe(true);
  });

  it("treats the form-level alignment values as visible", () => {
    // `labelPlacement` names two different settings in Gravity Forms. On a FORM
    // it carries label alignment, all of which are visible; reading one of
    // those as "hidden" would blank a shopper-facing label.
    for (const placement of ["top_label", "left_label", "right_label"]) {
      expect(isLabelVisible(field({ labelPlacement: placement }))).toBe(true);
    }
  });
});

describe("isDescriptionAbove", () => {
  it("is above only when the resolved placement says so", () => {
    expect(isDescriptionAbove(field({ descriptionPlacement: "above" }))).toBe(
      true,
    );
    expect(isDescriptionAbove(field({ descriptionPlacement: "below" }))).toBe(
      false,
    );
    // Absent — an older commerce build or theme. Gravity Forms' own default.
    expect(isDescriptionAbove(field({}))).toBe(false);
  });
});

describe("validationMessage", () => {
  it("prefers the merchant's Custom Validation Message", () => {
    expect(
      validationMessage(
        field({ errorMessage: "We need your email to reply." }),
        "Email is required",
      ),
    ).toBe("We need your email to reply.");
  });

  it("falls back to the storefront's copy when none is set", () => {
    expect(validationMessage(field({}), "Email is required")).toBe(
      "Email is required",
    );
    expect(
      validationMessage(field({ errorMessage: "   " }), "Email is required"),
    ).toBe("Email is required");
  });
});

describe("checkbox value codec", () => {
  it("round-trips multiple choice values", () => {
    const encoded = encodeCheckboxSelection(["Road", "Gravel"]);
    expect(encoded).toBe(`Road${CHECKBOX_VALUE_SEPARATOR}Gravel`);
    expect(decodeCheckboxSelection(encoded)).toEqual(["Road", "Gravel"]);
  });

  it("survives choice values containing punctuation a merchant might type", () => {
    // The separator is a C0 control character precisely because a comma, a
    // semicolon or a pipe is ordinary merchant text.
    const values = ["Road, Gravel & Track", "Yes|No", "A;B"];
    expect(decodeCheckboxSelection(encodeCheckboxSelection(values))).toEqual(
      values,
    );
  });

  it("reads the legacy single-box representation", () => {
    // The pre-existing single-box checkbox submitted these two literals, and a
    // value in that shape must keep meaning what it meant.
    expect(isCheckboxChecked("true")).toBe(true);
    expect(isCheckboxChecked("false")).toBe(false);
    expect(isCheckboxChecked("")).toBe(false);
    expect(isCheckboxChecked(undefined)).toBe(false);
  });

  it("treats an empty selection as nothing ticked", () => {
    expect(decodeCheckboxSelection(encodeCheckboxSelection([]))).toEqual([]);
    expect(isCheckboxChecked(encodeCheckboxSelection([]))).toBe(false);
  });
});

describe("selectedChoiceValues", () => {
  it("reads the editor's pre-selected ticks", () => {
    const f = field({
      type: "radio",
      choices: [
        { text: "Call me", value: "Call me", isSelected: true },
        { text: "Email me", value: "Email me", isSelected: false },
      ],
    });
    expect(selectedChoiceValues(f)).toEqual(["Call me"]);
  });

  it("returns every ticked choice, in definition order", () => {
    const f = field({
      type: "checkbox",
      choices: [
        { text: "Road", value: "Road", isSelected: true },
        { text: "Gravel", value: "Gravel" },
        { text: "Track", value: "Track", isSelected: true },
      ],
    });
    expect(selectedChoiceValues(f)).toEqual(["Road", "Track"]);
  });

  it("falls back to a defaultValue that names a real choice", () => {
    const f = field({
      type: "select",
      defaultValue: "Brighton",
      choices: [
        { text: "Adelaide City", value: "Adelaide City" },
        { text: "Brighton", value: "Brighton" },
      ],
    });
    expect(selectedChoiceValues(f)).toEqual(["Brighton"]);
  });

  it("ignores a defaultValue that names no choice", () => {
    const f = field({
      type: "select",
      defaultValue: "Glenelg",
      choices: [{ text: "Brighton", value: "Brighton" }],
    });
    expect(selectedChoiceValues(f)).toEqual([]);
  });
});

describe("isCheckedDefault", () => {
  it("accepts the affirmative tokens", () => {
    for (const value of ["true", "1", "Yes", "ON", "checked", "selected"]) {
      expect(isCheckedDefault(value)).toBe(true);
    }
  });

  it("accepts a value naming one of the field's own choices", () => {
    expect(isCheckedDefault("Subscribe", [{ value: "Subscribe" }])).toBe(true);
  });

  it("refuses anything it cannot parse", () => {
    // Pre-ticking a marketing opt-in because a value could not be read is the
    // one failure mode that subscribes someone who did not ask.
    expect(isCheckedDefault("perhaps")).toBe(false);
    expect(isCheckedDefault("")).toBe(false);
    expect(isCheckedDefault(undefined)).toBe(false);
    expect(isCheckedDefault("false")).toBe(false);
  });
});

describe("resolvableTextDefault", () => {
  it("drops a Gravity Forms merge tag this storefront cannot expand", () => {
    // Live on the rehearsal store: form 2's Email field carries this.
    expect(resolvableTextDefault("{user:user_email}")).toBe("");
    expect(resolvableTextDefault("Hello {embed_url}")).toBe("");
  });

  it("keeps a plain default", () => {
    expect(resolvableTextDefault("Adelaide City")).toBe("Adelaide City");
    expect(resolvableTextDefault(null)).toBe("");
  });
});

describe("buildFormDefaultValues", () => {
  it("pre-selects a radio from the editor's tick", () => {
    // The live shape of form 3 ("Product Enquiry") on the rehearsal store.
    const values = buildFormDefaultValues(
      [
        field({
          type: "radio",
          label: "Im interested...",
          choices: [
            {
              text: "Call me to arrange purchase",
              value: "Call me to arrange purchase",
              isSelected: true,
            },
            {
              text: "Email me more details",
              value: "Email me more details",
              isSelected: false,
            },
          ],
        }),
      ],
      snakeCase,
    );
    expect(values["im_interested"]).toBe("Call me to arrange purchase");
  });

  it("packs every pre-ticked choice of a Checkboxes field", () => {
    const values = buildFormDefaultValues(
      [
        field({
          type: "checkbox",
          label: "Interests",
          choices: [
            { text: "Road", value: "Road", isSelected: true },
            { text: "Gravel", value: "Gravel" },
            { text: "Track", value: "Track", isSelected: true },
          ],
        }),
      ],
      snakeCase,
    );
    expect(decodeCheckboxSelection(values["interests"])).toEqual([
      "Road",
      "Track",
    ]);
  });

  it("keeps the legacy true/false pair for a checkbox with no choices", () => {
    const values = buildFormDefaultValues(
      [
        field({
          type: "checkbox",
          label: "Join our mailing list",
          defaultValue: "1",
        }),
        field({ type: "checkbox", label: "I agree to the terms" }),
      ],
      snakeCase,
    );
    expect(values["join_our_mailing_list"]).toBe("true");
    expect(values["i_agree_to_the_terms"]).toBe("false");
  });

  it("never pre-ticks a choice field the editor left untouched", () => {
    const values = buildFormDefaultValues(
      [
        field({
          type: "select",
          label: "Preferred Store",
          choices: [
            {
              text: "Adelaide City",
              value: "Adelaide City",
              isSelected: false,
            },
            { text: "Brighton", value: "Brighton", isSelected: false },
          ],
        }),
        field({
          type: "checkbox",
          label: "Interests",
          choices: [{ text: "Road", value: "Road", isSelected: false }],
        }),
      ],
      snakeCase,
    );
    expect(values["preferred_store"]).toBe("");
    expect(isCheckboxChecked(values["interests"])).toBe(false);
  });
});

describe("hasRenderableChoices", () => {
  it("separates a Checkboxes field from a choice-less add-on checkbox", () => {
    expect(
      hasRenderableChoices(
        field({ type: "checkbox", choices: [{ text: "A", value: "A" }] }),
      ),
    ).toBe(true);
    expect(hasRenderableChoices(field({ type: "checkbox" }))).toBe(false);
    expect(hasRenderableChoices(field({ type: "checkbox", choices: [] }))).toBe(
      false,
    );
  });
});
