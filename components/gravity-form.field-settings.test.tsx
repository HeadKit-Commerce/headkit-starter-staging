// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/**
 * What a merchant configures in the WordPress form editor, rendered.
 *
 * Three settings used to reach nothing, and they were lost in three different
 * places: `isSelected` on a choice and a field's `description` were transmitted
 * by the WordPress theme and dropped by the commerce subgraph; the Appearance
 * block (Field Label Visibility, Description Placement) and the Custom
 * Validation Message were never emitted by the theme; and the renderer drew a
 * Checkboxes field as ONE boolean box, ignoring `choices` entirely, so a field
 * with two choices rendered one box and silently lost the second.
 *
 * The form definition arrives in an EFFECT, which is why this is a jsdom test
 * and not `renderToStaticMarkup`: the bug that hid every default was that React
 * Hook Form reads `defaultValues` on mount only, so a default captured before
 * the fetch resolved was never re-applied. Nothing about that is observable in
 * a render with no effects.
 *
 * The radio fixture is the LIVE definition of form 3 ("Product Enquiry") on the
 * Bike Society rehearsal store, read 2026-10-01 — its first choice really does
 * carry `isSelected: true`, set in the editor, and really did render unselected.
 *
 * What this does NOT cover:
 * - Drop Down. Radix's Select keeps its selected-item text in a collection that
 *   only populates with open content, which jsdom cannot drive; the pre-selected
 *   value is covered by `lib/gravity-form-fields.test.ts` and in a real browser.
 * - the Checkboxes submission reaching Gravity Forms. That needs a live form
 *   with a Checkboxes field and a real submission, neither of which was
 *   available; `lib/gravity-form-utils.test.ts` holds the payload shape and the
 *   theme harness holds the input-id rule it is keyed on.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Radix's Checkbox measures itself through `useSize`, which jsdom has no
// implementation for. Nothing here asserts a size.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver =
  NoopResizeObserver;

/**
 * Type into a React-controlled input.
 *
 * React keeps its own value tracker on the DOM node, so assigning `.value`
 * directly and dispatching `input` is swallowed as a no-op change. Going
 * through the prototype setter is what makes React see it.
 */
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Submit the form the way React sees it.
 *
 * NOT `requestSubmit()`: that runs the browser's own constraint validation
 * first, and an `<input type="email">` holding malformed text fails it, so the
 * submit event never fires and the app's validation never runs. That is real
 * browser behaviour, not a jsdom quirk — which is why a field's Custom
 * Validation Message is only ever seen for a failure the browser lets through.
 * Dispatching the event directly exercises the handler under test.
 */
async function submitForm(form: HTMLFormElement | null): Promise<void> {
  form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

type Choice = {
  text: string;
  value: string;
  isSelected: boolean;
  inputId: string;
};

type FieldNode = {
  databaseId: number;
  type: string;
  label: string;
  isRequired: boolean;
  placeholder?: string | null;
  defaultValue?: string | null;
  description?: string | null;
  visibility?: string | null;
  labelPlacement?: string | null;
  descriptionPlacement?: string | null;
  errorMessage?: string | null;
  choices?: { nodes: Choice[] } | null;
};

const submitted = vi.hoisted(() => ({
  calls: [] as unknown[],
}));

const formDefinition = vi.hoisted(() => ({
  fields: [] as unknown[],
}));

vi.mock("@/lib/gravity-form-actions", () => ({
  getGravityFormById: vi.fn(async () => ({
    gfForm: {
      submitButton: { text: "Send" },
      formFields: { nodes: formDefinition.fields },
    },
  })),
  submitGravityForm: vi.fn(async (input: unknown) => {
    submitted.calls.push(input);
    return { submitGfForm: { confirmation: { message: "Thanks!" } } };
  }),
}));

const subscribed = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/email-marketing-actions", () => ({
  subscribeEmailAction: vi.fn(async (input: unknown) => {
    subscribed.calls.push(input);
    return { success: true };
  }),
}));

const { GravityForm } = await import("./gravity-form");

function choice(
  text: string,
  opts: { isSelected?: boolean; inputId?: string; value?: string } = {},
): Choice {
  return {
    text,
    value: opts.value ?? text,
    isSelected: opts.isSelected ?? false,
    inputId: opts.inputId ?? "",
  };
}

function field(props: Partial<FieldNode> & { databaseId: number }): FieldNode {
  return {
    type: "text",
    label: "Field",
    isRequired: false,
    placeholder: "",
    defaultValue: "",
    description: "",
    visibility: "visible",
    labelPlacement: "",
    descriptionPlacement: "below",
    errorMessage: "",
    choices: null,
    ...props,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  submitted.calls.length = 0;
  subscribed.calls.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Mount the form and let the definition effect resolve. */
async function mount(fields: FieldNode[]): Promise<void> {
  formDefinition.fields = fields;
  await act(async () => {
    root.render(<GravityForm formId="3" />);
  });
}

/**
 * Every rendered checkbox/radio, by its accessible label text.
 *
 * `FormControl` hands the primitive ONE id (`formItemId`), and the two
 * primitives place it differently: Radix put it on the element carrying
 * `role`, while Base UI (#546) renders a visible `<span role=...>` with an id
 * of its own and puts the given id on the HIDDEN native input beside it. The
 * `<label for=...>` therefore points at the input, not at the role element.
 * So the label is resolved through the sibling input when there is one, and
 * the role element — the thing with the classes, the state and the click
 * handler — is what gets returned either way.
 */
function controlsByLabel(role: "checkbox" | "radio"): Map<string, Element> {
  const out = new Map<string, Element>();
  for (const control of container.querySelectorAll(`[role="${role}"]`)) {
    const native = control.parentElement?.querySelector(
      `input[type="${role}"]`,
    );
    const id = native?.id || control.id;
    const label = id ? container.querySelector(`label[for="${id}"]`) : null;
    out.set(label?.textContent?.trim() ?? "", control);
  }
  return out;
}

/** Radix reported state as `data-state`; Base UI as a bare `data-checked`. */
function isChecked(el: Element | undefined): boolean {
  if (!el) return false;
  return (
    el.getAttribute("data-state") === "checked" ||
    el.hasAttribute("data-checked")
  );
}

describe("a choice the editor pre-selected", () => {
  it("renders a radio checked, from isSelected alone", async () => {
    // The live form 3 shape. `defaultValue` is empty on this field: isSelected
    // is the ONLY thing that says which choice starts selected.
    await mount([
      field({
        databaseId: 8,
        type: "radio",
        label: "Im interested...",
        isRequired: true,
        choices: {
          nodes: [
            choice("Call me to arrange purchase", { isSelected: true }),
            choice("Email me more details"),
          ],
        },
      }),
    ]);

    const radios = controlsByLabel("radio");
    expect(radios.size).toBe(2);
    expect(isChecked(radios.get("Call me to arrange purchase"))).toBe(true);
    expect(isChecked(radios.get("Email me more details"))).toBe(false);
  });

  it("renders a Checkboxes choice checked", async () => {
    await mount([
      field({
        databaseId: 3,
        type: "checkbox",
        label: "Interests",
        choices: {
          nodes: [
            choice("Road", { inputId: "3.1" }),
            choice("Gravel", { isSelected: true, inputId: "3.2" }),
          ],
        },
      }),
    ]);

    const boxes = controlsByLabel("checkbox");
    expect(isChecked(boxes.get("Gravel"))).toBe(true);
    expect(isChecked(boxes.get("Road"))).toBe(false);
  });

  it("leaves every box clear when the editor ticked none", async () => {
    // The consent property: nothing is ever pre-ticked by the storefront.
    await mount([
      field({
        databaseId: 3,
        type: "checkbox",
        label: "Join our mailing list",
        choices: { nodes: [choice("Yes please", { inputId: "3.1" })] },
      }),
    ]);
    expect(isChecked(controlsByLabel("checkbox").get("Yes please"))).toBe(
      false,
    );
  });
});

describe("a Checkboxes field with N choices", () => {
  it("renders one box per choice", async () => {
    // The defect: one box, labelled with the FIELD label, and every choice past
    // the first silently gone.
    await mount([
      field({
        databaseId: 3,
        type: "checkbox",
        label: "Interests",
        choices: {
          nodes: [
            choice("Road", { inputId: "3.1" }),
            choice("Gravel", { inputId: "3.2" }),
            choice("Track", { inputId: "3.11" }),
          ],
        },
      }),
    ]);

    const boxes = controlsByLabel("checkbox");
    expect([...boxes.keys()].sort()).toEqual(["Gravel", "Road", "Track"]);
    expect(container.textContent).toContain("Interests");
  });

  it("submits one value per ticked choice, keyed by its Gravity Forms input id", async () => {
    await mount([
      field({
        databaseId: 3,
        type: "checkbox",
        label: "Interests",
        choices: {
          nodes: [
            choice("Road", { inputId: "3.1" }),
            choice("Gravel", { inputId: "3.2" }),
            choice("Track", { inputId: "3.11" }),
          ],
        },
      }),
    ]);

    const boxes = controlsByLabel("checkbox");
    for (const label of ["Road", "Track"]) {
      await act(async () => {
        (boxes.get(label) as HTMLElement).click();
      });
    }
    await act(async () => {
      await submitForm(container.querySelector("form"));
    });

    expect(submitted.calls).toHaveLength(1);
    const { fieldValues } = submitted.calls[0] as {
      fieldValues: { id?: number; inputId?: string; value: string }[];
    };
    expect(fieldValues).toEqual([
      { inputId: "3.1", value: "Road" },
      { inputId: "3.11", value: "Track" },
    ]);
  });
});

describe("the single-choice marketing opt-in still works", () => {
  // The path that was just fixed, and the one the multi-choice change must not
  // break. Proven for BOTH representations: a checkbox field carrying no
  // choices (the legacy single flat "true"), and a Checkboxes field with one.

  const emailField = field({
    databaseId: 2,
    type: "email",
    label: "Email",
    isRequired: true,
  });

  it("subscribes from a choice-less checkbox, submitting the literal true", async () => {
    await mount([
      emailField,
      field({
        databaseId: 9,
        type: "checkbox",
        label: "Join our mailing list",
      }),
    ]);

    const input = container.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    await act(async () => {
      await type(input, "ada@example.com");
    });
    await act(async () => {
      (
        controlsByLabel("checkbox").get("Join our mailing list") as HTMLElement
      ).click();
    });
    await act(async () => {
      await submitForm(container.querySelector("form"));
    });

    const { fieldValues } = submitted.calls[0] as {
      fieldValues: { id?: number; value: string }[];
    };
    expect(fieldValues).toEqual(
      expect.arrayContaining([{ id: 9, value: "true" }]),
    );
    expect(subscribed.calls).toEqual([
      { email: "ada@example.com", source: "form" },
    ]);
  });

  it("subscribes from a one-choice Checkboxes field too", async () => {
    await mount([
      emailField,
      field({
        databaseId: 9,
        type: "checkbox",
        label: "Newsletter",
        choices: { nodes: [choice("Yes please", { inputId: "9.1" })] },
      }),
    ]);

    const input = container.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    await act(async () => {
      await type(input, "ada@example.com");
    });
    await act(async () => {
      (controlsByLabel("checkbox").get("Yes please") as HTMLElement).click();
    });
    await act(async () => {
      await submitForm(container.querySelector("form"));
    });

    const { fieldValues } = submitted.calls[0] as {
      fieldValues: { id?: number; inputId?: string; value: string }[];
    };
    expect(fieldValues).toEqual(
      expect.arrayContaining([{ inputId: "9.1", value: "Yes please" }]),
    );
    expect(subscribed.calls).toEqual([
      { email: "ada@example.com", source: "form" },
    ]);
  });

  it("does not subscribe when the box is left clear", async () => {
    await mount([
      emailField,
      field({
        databaseId: 9,
        type: "checkbox",
        label: "Newsletter",
        choices: { nodes: [choice("Yes please", { inputId: "9.1" })] },
      }),
    ]);
    const input = container.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    await act(async () => {
      await type(input, "ada@example.com");
    });
    await act(async () => {
      await submitForm(container.querySelector("form"));
    });

    expect(submitted.calls).toHaveLength(1);
    expect(subscribed.calls).toEqual([]);
  });
});

describe("the Appearance settings", () => {
  it("hides a label visually, keeping it for assistive technology", async () => {
    await mount([
      field({
        databaseId: 1,
        type: "text",
        label: "Your name",
        labelPlacement: "hidden_label",
      }),
      field({ databaseId: 2, type: "text", label: "Your phone" }),
    ]);

    const labels = [...container.querySelectorAll("label")];
    const hidden = labels.find((l) => l.textContent?.trim() === "Your name");
    const shown = labels.find((l) => l.textContent?.trim() === "Your phone");
    expect(hidden?.className).toContain("sr-only");
    expect(shown?.className ?? "").not.toContain("sr-only");
  });

  it("keeps a label visible for a form-level alignment value", async () => {
    // `labelPlacement` names two settings in Gravity Forms. Commerce normalises
    // the form-level alignment values away, but a storefront reading one as
    // "hidden" would blank the label, so assert the storefront's own fallback.
    await mount([
      field({
        databaseId: 1,
        type: "text",
        label: "Your name",
        labelPlacement: "left_label",
      }),
    ]);
    const label = [...container.querySelectorAll("label")].find(
      (l) => l.textContent?.trim() === "Your name",
    );
    expect(label?.className ?? "").not.toContain("sr-only");
  });

  it("places a description above or below the input, as the editor set it", async () => {
    await mount([
      field({
        databaseId: 1,
        type: "text",
        label: "Above",
        description: "Sits above",
        descriptionPlacement: "above",
      }),
      field({
        databaseId: 2,
        type: "text",
        label: "Below",
        description: "Sits below",
        descriptionPlacement: "below",
      }),
    ]);

    for (const [text, expectBefore] of [
      ["Sits above", true],
      ["Sits below", false],
    ] as const) {
      const description = [...container.querySelectorAll("p")].find(
        (p) => p.textContent?.trim() === text,
      );
      expect(description, `${text} must render`).toBeTruthy();
      const item = description?.closest("div");
      const input = item?.querySelector("input");
      expect(input, `${text} must sit beside an input`).toBeTruthy();
      const before = Boolean(
        description &&
        input &&
        description.compareDocumentPosition(input) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(before).toBe(expectBefore);
    }
  });

  it("renders no description element when the field carries none", async () => {
    await mount([field({ databaseId: 1, type: "text", label: "Name" })]);
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});

describe("the Custom Validation Message", () => {
  it("is what a shopper sees for a failed required field", async () => {
    await mount([
      field({
        databaseId: 1,
        type: "text",
        label: "Phone",
        isRequired: true,
        errorMessage: "We need a number to call you back on.",
      }),
    ]);

    await act(async () => {
      await submitForm(container.querySelector("form"));
    });

    expect(container.textContent).toContain(
      "We need a number to call you back on.",
    );
    expect(container.textContent).not.toContain("Phone is required");
  });

  it("replaces the format message too, as Gravity Forms does", async () => {
    // GF_Field::validate() sets validation_message from errorMessage whatever
    // the reason, so one custom message covers every failure on the field.
    await mount([
      field({
        databaseId: 2,
        type: "email",
        label: "Email",
        isRequired: true,
        errorMessage: "That does not look like an email address.",
      }),
    ]);

    const input = container.querySelector(
      'input[type="email"]',
    ) as HTMLInputElement;
    await act(async () => {
      await type(input, "not-an-email");
    });
    await act(async () => {
      await submitForm(container.querySelector("form"));
    });

    expect(container.textContent).toContain(
      "That does not look like an email address.",
    );
    expect(container.textContent).not.toContain("Invalid email address");
  });

  it("falls back to the storefront's own copy when the merchant set none", async () => {
    // The no-regression half: every form that carries no custom message reads
    // exactly as it reads today.
    await mount([
      field({
        databaseId: 1,
        type: "text",
        label: "Phone",
        isRequired: true,
      }),
    ]);
    await act(async () => {
      await submitForm(container.querySelector("form"));
    });
    expect(container.textContent).toContain("Phone is required");
  });
});

describe("a field definition carrying none of the new settings", () => {
  it("renders what it rendered before they existed", async () => {
    // An older commerce build or WordPress theme sends no labelPlacement,
    // descriptionPlacement, errorMessage, description, isSelected or inputId.
    await mount([
      {
        databaseId: 1,
        type: "text",
        label: "Name",
        isRequired: true,
      },
      {
        databaseId: 2,
        type: "checkbox",
        label: "Join our mailing list",
        isRequired: false,
      },
    ]);

    const label = [...container.querySelectorAll("label")].find(
      (l) => l.textContent?.trim() === "Name",
    );
    expect(label?.className ?? "").not.toContain("sr-only");
    expect(container.querySelectorAll("p")).toHaveLength(0);
    // One box, labelled with the field label, unticked.
    const boxes = controlsByLabel("checkbox");
    expect([...boxes.keys()]).toEqual(["Join our mailing list"]);
    expect(isChecked(boxes.get("Join our mailing list"))).toBe(false);

    await act(async () => {
      await submitForm(container.querySelector("form"));
    });
    expect(container.textContent).toContain("Name is required");
  });
});
