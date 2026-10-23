/**
 * ONE walk over a thrown gateway error, for every module that classifies one
 * by its GraphQL `extensions`.
 *
 * Shape-driven rather than `instanceof GraphQLError`, deliberately: the SDK
 * wraps a transport failure in a `ConnectionError` carrying the real error as
 * `cause`, a Server Action's throw can be re-wrapped on its way out of the
 * action boundary, and the one thing every arrangement preserves is the
 * `extensions` bag. The walk follows `errors[]` entries and the `cause` chain,
 * bounded so a self-referential `cause` cannot spin.
 *
 * Two classifiers read the same post-payment throw — `lib/order-refusal.ts`
 * (`ORDER_REFUSED`: refused outright, payment reversed) and
 * `lib/order-validation.ts` (`ORDER_VALIDATION`: one field to correct, payment
 * stands). A second copy of this traversal is how one of them comes to see a
 * wrapped error the other misses, so neither may re-implement it.
 *
 * It classifies by CODE only. There is deliberately no "match the message"
 * helper here: a WooCommerce message is translated merchant copy, never a
 * contract.
 */

/** How deep the `cause` chain is followed before giving up. */
const MAX_DEPTH = 8;

/**
 * Every `extensions` bag reachable from a thrown error, outermost first: an
 * error's own `extensions`, then its `errors[]` entries, then the same for
 * `cause`. Returns `[]` for a plain `Error`, a string, null and undefined —
 * i.e. for every TRANSIENT failure, which is what makes "no bag" an answer.
 */
export function errorExtensionBags(
  error: unknown,
): Array<Record<string, unknown>> {
  const bags: Array<Record<string, unknown>> = [];
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_DEPTH && current !== undefined && current !== null;
    depth++
  ) {
    const own = extensionsOf(current);
    if (own) bags.push(own);
    const entries = (current as { errors?: unknown }).errors;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        const bag = extensionsOf(entry);
        if (bag) bags.push(bag);
      }
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === current) break;
    current = next;
  }
  return bags;
}

function extensionsOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) return null;
  const extensions = (value as { extensions?: unknown }).extensions;
  if (typeof extensions !== "object" || extensions === null) return null;
  return extensions as Record<string, unknown>;
}

/** A bag's string field, trimmed, or "" when absent or not a string. */
export function extensionString(
  bag: Record<string, unknown>,
  key: string,
): string {
  const value = bag[key];
  return typeof value === "string" ? value.trim() : "";
}

/** A bag's string-array field, trimmed and de-blanked, or `[]`. */
export function extensionStringList(
  bag: Record<string, unknown>,
  key: string,
): string[] {
  const value = bag[key];
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * The first human-readable message on a thrown error, for a LOG line only —
 * never rendered, never matched.
 */
export function firstErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  return "unknown error";
}
