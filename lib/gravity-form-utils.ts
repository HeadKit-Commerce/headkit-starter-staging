/**
 * Pure helpers for the Gravity Forms component. Kept framework-free so the
 * field-id resolution — the part that regressed in ENG-794 — is unit-testable
 * without rendering the client component.
 */

import {
  decodeCheckboxSelection,
  type FormChoiceSettings,
} from "./gravity-form-fields";

/** Convert a label like "First Name" to "first_name" for form field keys. */
export function snakeCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/** Minimal shape of a Gravity Forms field node needed for id resolution. */
export interface GravityFieldNode {
  databaseId: number;
  label?: string | null;
}

/** A single field value submitted to Gravity Forms. */
export interface GravityFieldValue {
  id?: number;
  /** Gravity Forms INPUT id for a single Checkboxes choice, e.g. `"3.11"`. */
  inputId?: string;
  value: string;
}

/**
 * Build a map from a field's snakeCased label to its Gravity Forms databaseId,
 * across ALL fields — including hidden ones that never render. Injected/hidden
 * values (e.g. product-enquiry context) must submit WITH their numeric id or the
 * commerce provider drops them and the entry loses the data (ENG-794).
 */
export function buildFieldIdByName(
  nodes: ReadonlyArray<GravityFieldNode | null | undefined> | null | undefined,
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const node of nodes ?? []) {
    if (node?.label && node.databaseId != null) {
      map[snakeCase(node.label)] = node.databaseId;
    }
  }
  return map;
}

/**
 * A Checkboxes field, keyed by its form field name, whose value must be
 * expanded into one submitted value per selected choice.
 */
export interface CheckboxFieldSubmission {
  choices: ReadonlyArray<FormChoiceSettings>;
}

/**
 * Map a `{ fieldKey: value }` record to Gravity Forms field values, attaching
 * each value's numeric databaseId when the field is known. Unknown keys are
 * still sent (without an id) so behaviour matches the pre-existing contract.
 *
 * A Checkboxes field is the exception, and the reason `checkboxFields` exists.
 * Gravity Forms gives every choice its own input and
 * `GF_Field_Checkbox::get_value_submission()` reads ONLY those
 * (`input_{field}_{n}`), so one flat value under the field id is read by
 * nothing and discarded without an error. Such a field is expanded into one
 * value per SELECTED choice, keyed by the choice's `inputId`; an unselected
 * choice is simply absent, which is what an unticked box posts.
 *
 * A checkbox field not listed in `checkboxFields` — including one whose
 * definition carries no choices — falls through to the single flat value it has
 * always submitted.
 */
export function buildFieldValues(
  values: Record<string, string>,
  fieldIdByName: Record<string, number>,
  checkboxFields: Record<string, CheckboxFieldSubmission> = {},
): GravityFieldValue[] {
  const out: GravityFieldValue[] = [];

  for (const [key, value] of Object.entries(values)) {
    const databaseId = fieldIdByName[key];
    const stringValue = value?.toString() ?? "";
    const checkbox = checkboxFields[key];

    if (checkbox) {
      const selected = new Set(decodeCheckboxSelection(stringValue));
      for (const choice of checkbox.choices) {
        if (!selected.has(choice.value)) continue;
        // No inputId means the store's WordPress theme predates 0.4.68 and
        // cannot tell us which input to post to. Sending the choice under the
        // field id is what this storefront did before, so fall back to it
        // rather than dropping the shopper's answer.
        out.push(
          choice.inputId
            ? { inputId: choice.inputId, value: choice.value }
            : databaseId !== undefined
              ? { id: databaseId, value: choice.value }
              : { value: choice.value },
        );
      }
      continue;
    }

    out.push(
      databaseId !== undefined
        ? { id: databaseId, value: stringValue }
        : { value: stringValue },
    );
  }

  return out;
}
