/**
 * Pure helpers for detecting marketing opt-in fields in Gravity Forms.
 */

import {
  decodeCheckboxSelection,
  type FormChoiceSettings,
} from "./gravity-form-fields";

const MARKETING_LABEL =
  /newsletter|mailing\s*list|email\s*me|marketing|subscribe|opt[\s-]?in|keep\s*me\s*(updated|informed)/i;

/** True when a checkbox label looks like a marketing / list opt-in. */
export function isMarketingOptInLabel(
  label: string | null | undefined,
): boolean {
  if (!label) return false;
  return MARKETING_LABEL.test(label);
}

/**
 * Extract the first email-shaped value from a flat form values map.
 * Prefers keys containing "email".
 */
export function extractEmailFromFormValues(
  values: Record<string, string>,
): string | null {
  const entries = Object.entries(values);
  const preferred = entries.find(
    ([key, value]) =>
      /email/i.test(key) && typeof value === "string" && value.includes("@"),
  );
  if (preferred?.[1]) return preferred[1].trim();

  for (const [, value] of entries) {
    if (
      typeof value === "string" &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ) {
      return value.trim();
    }
  }
  return null;
}

/** The field shape opt-in detection needs. */
export interface OptInCandidateField {
  type: string;
  label: string;
  choices?: ReadonlyArray<FormChoiceSettings> | undefined;
}

/**
 * True when a marketing-labelled checkbox in `fields` is ticked in `values`
 * (keys are snake_cased labels).
 *
 * Two representations have to satisfy this, and both are live:
 *
 *  - A checkbox field with NO choices submits the literal `"true"` / `"false"`
 *    pair, which is what this read before multi-choice rendering existed and
 *    what the Klaviyo subscribe path was built against.
 *  - A Checkboxes field WITH choices submits its selected choice values packed
 *    by `encodeCheckboxSelection`, because Gravity Forms reads such a field per
 *    choice. For those, the opt-in wording is usually the merchant's CHOICE
 *    text rather than the field label, so a SELECTED choice whose text reads as
 *    marketing counts too.
 *
 * `decodeCheckboxSelection` drops the negative tokens, so `"false"` and `""`
 * are not ticks under either shape. A ticked choice whose own value happens to
 * be a negative token therefore reads as NOT opted in — the fail-closed
 * direction, which is the right one for consent.
 */
export function hasMarketingOptIn(
  fields: ReadonlyArray<OptInCandidateField>,
  values: Record<string, string>,
  snakeCase: (label: string) => string,
): boolean {
  for (const field of fields) {
    if (field.type !== "checkbox") continue;

    const selected = decodeCheckboxSelection(values[snakeCase(field.label)]);
    if (selected.length === 0) continue;

    if (isMarketingOptInLabel(field.label)) return true;

    const selectedValues = new Set(selected);
    for (const choice of field.choices ?? []) {
      if (!selectedValues.has(choice.value)) continue;
      if (isMarketingOptInLabel(choice.text)) return true;
    }
  }
  return false;
}
