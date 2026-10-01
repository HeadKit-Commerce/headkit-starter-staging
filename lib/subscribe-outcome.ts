/**
 * Fire-and-forget subscribe reporting (client side).
 *
 * The storefront calls `subscribeEmailAction` without awaiting it on purpose:
 * a slow or failing Klaviyo / HubSpot must never hold up a form submission or a
 * checkout step. That part is correct and stays. What was NOT correct is that
 * the promise was discarded outright (`void subscribeEmailAction(...)`), so a
 * failed subscribe left no trace anywhere in the browser and an action-level
 * rejection became an unhandled promise rejection.
 *
 * This helper is the handler: it never throws, never blocks, never changes what
 * the shopper sees, and reports a failure to the Sentry-style global when one is
 * registered — the same structural, import-free lookup `lib/logger.ts` uses, so
 * this module stays client-safe (no `process`, no server-only import).
 *
 * It is the BELT, not the braces. The authoritative record is server-side:
 * `subscribeEmailAction` logs every failure through `lib/logger.ts`, and commerce
 * logs every attempt and outcome (`email_marketing_subscribe_attempt` /
 * `_result` in `services/commerce/internal/service/email_marketing_service.go`).
 * Nothing here is load-bearing for an operator's log query.
 *
 * Never pass the subscriber's email address to this module. The address is
 * personal data and these reports are retained; `source` plus the action's own
 * message is what identifies a failure.
 */

/** The shape `subscribeEmailAction` resolves to, structurally (no server import). */
export type SubscribeActionResult = {
  success: boolean;
  error?: string;
};

/** Where the subscribe was triggered from — mirrors the action's source union. */
export type SubscribeOutcomeContext = {
  source: string;
};

/** Minimal Sentry-style capture surface; mirrors `lib/logger.ts`. */
interface SentryLike {
  captureMessage: (message: string, level?: "error") => void;
}

function getSentry(): SentryLike | undefined {
  const candidate = (globalThis as { Sentry?: unknown }).Sentry;
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as { captureMessage?: unknown }).captureMessage ===
      "function"
  ) {
    return candidate as SentryLike;
  }
  return undefined;
}

function capture(event: string, context: SubscribeOutcomeContext): void {
  try {
    getSentry()?.captureMessage(`${event} source=${context.source}`, "error");
  } catch {
    // A failing reporter must never surface as an app error.
  }
}

/**
 * Attach an outcome handler to a fire-and-forget subscribe.
 *
 * Returns a promise that ALWAYS resolves, so a caller may still discard it with
 * `void` and keep the submission non-blocking.
 */
export function reportSubscribeOutcome(
  pending: Promise<SubscribeActionResult>,
  context: SubscribeOutcomeContext,
): Promise<void> {
  return pending.then(
    (result) => {
      if (!result?.success) {
        capture("email_marketing_subscribe_failed", context);
      }
    },
    () => {
      // An action-level rejection (transport drop, action 500) — the case that
      // used to become an unhandled rejection.
      capture("email_marketing_subscribe_rejected", context);
    },
  );
}
