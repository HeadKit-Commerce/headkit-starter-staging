/**
 * Names collected by Stripe's Address Element, and the surname an Afterpay
 * return sometimes drops.
 *
 * The element reports a combined `name` and, when it split the field, separate
 * `firstName` / `lastName`. Preferring `name.split(" ")[1]` did two wrong
 * things: it kept only the second word of a multi-word surname, and a combined
 * name of "Firstname Firstname" (the billing-same-as-shipping checkbox, and
 * Afterpay's given name written into both halves) hid a real `lastName`.
 *
 * WooCommerce then requires `last_name`. Copying the given name into that
 * empty field is what printed "Firstname Firstname" on the order.
 */

export interface PersonNameParts {
  firstName: string;
  lastName: string;
}

export interface PersonNameSource {
  // `| undefined` is required. `exactOptionalPropertyTypes` rejects an
  // explicit `undefined`, and Stripe's Address Element types its split
  // name fields that way.
  name?: string | null | undefined;
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
}

export interface SurnameCandidate {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  address1?: string | null | undefined;
}

function text(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function sameWord(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

/**
 * Split an Address Element change into the given name and the rest of the
 * surname. A structured `lastName` wins only when the combined name omitted a
 * surname or repeated the given name.
 */
export function personNameFromAddressValue(
  value: PersonNameSource | null | undefined,
): PersonNameParts {
  const structuredFirst = text(value?.firstName);
  const structuredLast = text(value?.lastName);
  const full = text(value?.name).replace(/\s+/g, " ");
  const space = full.indexOf(" ");
  const combinedFirst = space < 0 ? full : full.slice(0, space);
  const combinedLast = space < 0 ? "" : full.slice(space + 1).trim();
  const first = structuredFirst || combinedFirst;
  const given = first.toLowerCase();
  const repeated =
    combinedLast !== "" && combinedLast.toLowerCase() === given && given !== "";
  const structuredUsable =
    structuredLast !== "" &&
    !sameWord(structuredLast, first) &&
    (combinedLast === "" || repeated);

  return {
    firstName: first,
    lastName: structuredUsable
      ? structuredLast
      : combinedLast || structuredLast,
  };
}

/**
 * A surname to borrow when `target` has none, or only its given name again.
 *
 * The donor must be the same person (same given name) on the same street.
 * A billing name typed for a different address is left as it was entered,
 * including a genuine "John John".
 */
export function surnameFromDonor(
  target: SurnameCandidate | null | undefined,
  donor: SurnameCandidate | null | undefined,
): string {
  const first = text(target?.firstName);
  const last = text(target?.lastName);
  if (last && !sameWord(last, first)) return "";

  const donorFirst = text(donor?.firstName);
  const donorLast = text(donor?.lastName);
  if (!donorLast || sameWord(donorLast, donorFirst || first)) return "";
  if (first && donorFirst && !sameWord(first, donorFirst)) return "";

  const targetStreet = text(target?.address1).toLowerCase();
  const donorStreet = text(donor?.address1).toLowerCase();
  if (targetStreet && donorStreet && targetStreet !== donorStreet) return "";

  return donorLast;
}
