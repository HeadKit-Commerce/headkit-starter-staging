/**
 * The Gravity Forms field settings the storefront renders from, and the value
 * codec a multi-choice checkbox needs. Pure, so each rule is testable without
 * mounting the client component.
 *
 * ## What was lost, and where
 *
 * A merchant configures a form in the WordPress form editor; the storefront
 * used to ignore most of what they set. The loss happened in three places, and
 * this module is the storefront third:
 *
 *  1. The theme transmitted `description` and every choice's `isSelected`, and
 *     the commerce subgraph's mapping dropped them.
 *  2. The theme never emitted the Appearance block (`labelPlacement`,
 *     `descriptionPlacement`) or the Custom Validation Message (`errorMessage`)
 *     at all — theme 0.4.68 adds them.
 *  3. The renderer drew a Checkboxes field as ONE boolean box labelled with the
 *     FIELD label, ignoring `choices` entirely. A field with two choices
 *     rendered one box and silently lost the second.
 *
 * ## Defaults are the half that is easy to get wrong
 *
 * `GravityForm` fetches the definition in an effect, so its first render has no
 * fields and `useForm` captures `{}` as its defaults. React Hook Form reads
 * `defaultValues` on mount only, so without a re-apply NOTHING in the
 * definition is honoured — measured on the deployed rehearsal store 2026-10-01,
 * where form 2's Email field carries `defaultValue: "{user:user_email}"` and
 * rendered empty.
 *
 * Deliberately NOT decided here: whether a marketing box SHOULD be pre-ticked.
 * That is a consent question with different answers in different jurisdictions,
 * so the checked state is read from the form definition and is never hard-coded
 * on. An unrecognised default leaves the box CLEAR.
 */

/** The field shape these rules need — a subset of the SDK's field node. */
export interface FormFieldSettings {
  type: string;
  label: string;
  defaultValue: string;
  description?: string | undefined;
  /** `""` (visible) or `"hidden_label"`; anything else reads as visible. */
  labelPlacement?: string | undefined;
  /** `"above"` or `"below"`; anything else reads as below. */
  descriptionPlacement?: string | undefined;
  /** Appearance -> Custom Validation Message. */
  errorMessage?: string | undefined;
  choices?: FormChoiceSettings[] | undefined;
}

/** A single choice, as the gateway now exposes it. */
export interface FormChoiceSettings {
  text: string;
  value: string;
  /** The editor's pre-selected tick. */
  isSelected?: boolean | undefined;
  /** Gravity Forms input id for this choice, e.g. `"3.11"`. */
  inputId?: string | undefined;
}

/**
 * A Gravity Forms merge tag, e.g. `{user:user_email}` or `{embed_url}`.
 *
 * The storefront has no merge-tag resolver — these are expanded by Gravity
 * Forms when IT renders a form, not by the REST payload. Seeding one verbatim
 * would put the literal string `{user:user_email}` in a shopper's email box, so
 * a default containing one is dropped entirely rather than shown.
 */
const MERGE_TAG = /\{[^{}]+\}/;

const AFFIRMATIVE = new Set([
  "true",
  "1",
  "yes",
  "y",
  "on",
  "checked",
  "selected",
]);

/**
 * Tokens that mean "not ticked". The legacy single-box checkbox submitted the
 * literal `"false"`, so it has to keep meaning unchecked even though the new
 * representation uses an empty string.
 */
const NEGATIVE = new Set(["false", "0", "no", "n", "off", "unchecked"]);

/**
 * Separator for a multi-choice checkbox field's selected values inside the one
 * string React Hook Form holds per field.
 *
 * ASCII UNIT SEPARATOR: a Gravity Forms choice value is arbitrary merchant text
 * and may well contain a comma, a semicolon or a pipe, but cannot realistically
 * contain a C0 control character — the WordPress form editor gives a merchant
 * no way to type one. A separator a merchant CAN type is a silent
 * data-corruption bug waiting for the first choice that contains it.
 */
export const CHECKBOX_VALUE_SEPARATOR = "\u001f";

/** True when a choice field carries choices that must be rendered. */
export function hasRenderableChoices(field: FormFieldSettings): boolean {
  return (field.choices?.length ?? 0) > 0;
}

/** Pack a Checkboxes field's selected choice values into one form value. */
export function encodeCheckboxSelection(values: ReadonlyArray<string>): string {
  return values.join(CHECKBOX_VALUE_SEPARATOR);
}

/**
 * Unpack a Checkboxes field's form value into selected choice values.
 *
 * Tolerates the LEGACY single-box representation: `"true"` decodes to one
 * selection and `"false"` / `""` to none, so a form value written in the old
 * shape still reads as checked. That is what keeps the marketing opt-in path
 * working for a checkbox field that carries no choices.
 */
export function decodeCheckboxSelection(
  value: string | null | undefined,
): string[] {
  const raw = value ?? "";
  if (raw === "") return [];
  return raw
    .split(CHECKBOX_VALUE_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part !== "" && !NEGATIVE.has(part.toLowerCase()));
}

/** True when a checkbox field's form value represents at least one tick. */
export function isCheckboxChecked(value: string | null | undefined): boolean {
  return decodeCheckboxSelection(value).length > 0;
}

/**
 * True when a choice-less checkbox field's definition-carried default means
 * "checked".
 *
 * Accepts the affirmative tokens above, plus a value equal to one of the
 * field's own choice values — which is how Gravity Forms represents a selected
 * choice. Anything else, including an unrecognised non-empty string, is FALSE:
 * silently pre-ticking a marketing opt-in because a value could not be parsed
 * is the one failure mode that subscribes someone who did not ask.
 */
export function isCheckedDefault(
  rawDefault: string | null | undefined,
  choices?: ReadonlyArray<{ value: string }> | undefined,
): boolean {
  const value = (rawDefault ?? "").trim();
  if (!value) return false;
  if (AFFIRMATIVE.has(value.toLowerCase())) return true;
  return (choices ?? []).some(
    (choice) => choice.value.trim().toLowerCase() === value.toLowerCase(),
  );
}

/**
 * The value a non-checkbox field should start with: its definition default,
 * unless that default carries a merge tag this storefront cannot resolve.
 */
export function resolvableTextDefault(
  rawDefault: string | null | undefined,
): string {
  const value = rawDefault ?? "";
  return MERGE_TAG.test(value) ? "" : value;
}

/**
 * The choice values a field starts with, from the editor's pre-selected ticks.
 *
 * `isSelected` is how Gravity Forms stores "Default" on a choice — for Radio,
 * Drop Down and Checkboxes alike. A field's own `defaultValue` is the fallback
 * when no choice is ticked, because dynamic population writes there.
 */
export function selectedChoiceValues(field: FormFieldSettings): string[] {
  const choices = field.choices ?? [];
  const ticked = choices
    .filter((choice) => choice.isSelected)
    .map((choice) => choice.value);
  if (ticked.length > 0) return ticked;

  const fallback = resolvableTextDefault(field.defaultValue).trim();
  if (!fallback) return [];
  // Only honour a default that names a real choice; anything else would seed a
  // Drop Down or Radio with a value it cannot display.
  return choices.some((choice) => choice.value === fallback) ? [fallback] : [];
}

/**
 * The full `{ fieldName: value }` map a form definition asks the renderer to
 * start with.
 *
 * - Checkboxes WITH choices: the pre-selected choice values, packed.
 * - Checkboxes WITHOUT choices (the legacy single-box shape, and any add-on
 *   field typed `checkbox` that carries none): the `"true"` / `"false"` pair
 *   the renderer has always compared against, so that path is unchanged.
 * - Radio / Drop Down: the first pre-selected choice's value.
 * - Everything else: its resolvable text default.
 */
export function buildFormDefaultValues(
  fields: ReadonlyArray<FormFieldSettings> | null | undefined,
  snakeCase: (label: string) => string,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of fields ?? []) {
    const name = snakeCase(field.label);
    if (field.type === "checkbox") {
      values[name] = hasRenderableChoices(field)
        ? encodeCheckboxSelection(selectedChoiceValues(field))
        : isCheckedDefault(field.defaultValue, field.choices)
          ? "true"
          : "false";
      continue;
    }
    if (field.type === "radio" || field.type === "select") {
      values[name] = selectedChoiceValues(field)[0] ?? "";
      continue;
    }
    values[name] = resolvableTextDefault(field.defaultValue);
  }
  return values;
}

/**
 * Whether a field's label is shown.
 *
 * Gravity Forms stores Appearance -> Field Label Visibility on the FIELD as
 * `labelPlacement`, carrying only `""` (visible) or `"hidden_label"`. The
 * form-level property of the same name carries label ALIGNMENT
 * (top/left/right), all of which are visible, so anything but `hidden_label`
 * must read as visible — including an absent value from an older commerce
 * build or an older theme.
 *
 * Gravity Forms hides the label outright. The storefront hides it VISUALLY and
 * keeps it in the accessibility tree instead, so the input retains an
 * accessible name; what a sighted shopper sees is the same either way.
 */
export function isLabelVisible(field: FormFieldSettings): boolean {
  return field.labelPlacement !== "hidden_label";
}

/** Whether a field's description sits above its inputs rather than below. */
export function isDescriptionAbove(field: FormFieldSettings): boolean {
  return field.descriptionPlacement === "above";
}

/**
 * The message a shopper sees when a field fails validation.
 *
 * Gravity Forms uses ONE custom message per field for any failure on it —
 * `GF_Field::validate()` sets `validation_message` from `errorMessage` whatever
 * the reason — so the custom message replaces both the required and the format
 * copy. `fallback` is the storefront's own wording, used when the merchant set
 * none.
 */
export function validationMessage(
  field: FormFieldSettings,
  fallback: string,
): string {
  const custom = (field.errorMessage ?? "").trim();
  return custom === "" ? fallback : custom;
}
