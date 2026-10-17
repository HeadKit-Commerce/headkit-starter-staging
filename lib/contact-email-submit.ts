/** Which side-effect path the contact-step submit must take. */
export type ContactSubmitDecision = "recreate" | "advance" | "update-email";

/** Inputs to the contact-step submit branch decision. */
export interface ContactSubmitInput {
  /** The email the step started with (prefill / restored). Raw — normalized inside. */
  initialEmail: string;
  /** The email the shopper submitted. Raw — normalized inside. */
  submittedEmail: string;
  /**
   * The email currently on the Stripe Checkout Session, or `null`/`undefined`
   * when the checkout state is not "success" (session not readable).
   */
  sessionEmail: string | null | undefined;
  /** Whether an onRefreshSession (session-recreate) path is available. */
  hasRefreshSession: boolean;
}

/**
 * Pure, node-testable extraction of the contact-step handleSubmit branch
 * order (ENG-801). Reproduces the component's branches EXACTLY:
 *
 *   (a) "recreate"     — the email changed FROM a prior value and a refresh
 *                        path exists: the session must be recreated (Stripe
 *                        render-locks a `customer_email` set at create;
 *                        recreate-then-updateEmail is the ENG-801 model).
 *                        First entry on an email-less session is NOT a change.
 *   (b) "advance"      — the email is unchanged, a prefill exists, AND the
 *                        session already carries an email: Stripe forbids
 *                        `updateEmail` with an unchanged email, so the
 *                        session is left alone. The component still pushes
 *                        the email to the CART (checkout plan v3 §4.4: the
 *                        store's Klaviyo Started Checkout fires from
 *                        WooCommerce's update-customer route).
 *   (c) "update-email" — everything else: push the email onto the session
 *                        (`actions.updateEmail`) and the cart before advancing.
 *
 * WHY branch (c) matters — the safety net: sessions are created email-LESS
 * (ENG-801) and the returning-shopper prefill is applied at PROVIDER mount
 * (CheckoutElementsProvider `options.defaultValues.email`). A session's
 * email can therefore still be empty at submit time: the prefill arrived
 * async (after provider mount, missed by defaultValues) or the bounded
 * updateEmail push in CheckoutSteps has not landed yet. Submitting an
 * UNCHANGED prefill against such a session must NOT be swallowed by branch
 * (b): `sessionEmail` reads empty, so branch (c) fires and pushes the email
 * onto the session before the step advances. The bounded push is only a
 * loop-guarded best effort — this submit path is the guarantee.
 *
 * Emails are normalized (trim + lowercase) before comparison, mirroring the
 * component. A `null`/`undefined` sessionEmail means the checkout state is
 * not "success"; that maps to `stripeHasNoEmail === false` in the component
 * (the condition requires a successful state), so an unchanged prefill still
 * advances. Pure: no I/O, no Stripe types.
 */
export function decideContactSubmit(
  input: ContactSubmitInput,
): ContactSubmitDecision {
  const initial = input.initialEmail.trim().toLowerCase();
  const submitted = input.submittedEmail.trim().toLowerCase();
  const emailChanged = submitted !== initial;

  // ENG-801: sessions are created email-less — first entry is not a "change"
  // from a prior email, so push via updateEmail instead of recreating the session.
  if (input.hasRefreshSession && emailChanged && initial.length > 0) {
    return "recreate";
  }

  const stripeHasNoEmail =
    input.sessionEmail != null && !input.sessionEmail.trim();
  const hasInitialEmail = initial.length > 0;
  if (!stripeHasNoEmail && hasInitialEmail && !emailChanged) return "advance";

  return "update-email";
}
