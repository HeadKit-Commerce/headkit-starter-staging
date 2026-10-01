"use server";

/**
 * Email marketing server actions — subscribe + status via commerce GraphQL.
 * No-ops safely when the store has no Klaviyo connection.
 *
 * Layout / RSC chrome must use {@link getEmailMarketingStatus} (cached), not
 * these actions, so Cache Components prerender stays unblocked.
 */

import { createHash } from "node:crypto";

import { createServerHeadkit } from "@/lib/sdk.server";
import {
  getEmailMarketingStatus,
  type EmailMarketingStatusResult,
} from "@/lib/email-marketing";
import { errorFields, logger } from "@/lib/logger";

/**
 * DO NOT re-export a type from this file.
 *
 * A `"use server"` module is rewritten by Next's server-actions loader into a
 * list of RUNTIME re-exports — `export {X as '<action-id>'} from 'ACTIONS_MODULE'`
 * — and under Turbopack that rewrite does not distinguish a type-only export
 * from a value one. `export type { EmailMarketingStatusResult };` therefore
 * compiled to a runtime binding for a name that only ever existed in the type
 * system, and the module threw on evaluation:
 *
 *   ReferenceError: EmailMarketingStatusResult is not defined
 *     at .next-internal/server/app/products/[...slug]/page/actions.js
 *
 * That is a 500 on every route whose action graph includes this file — which is
 * every PDP — and it is INVISIBLE to `tsc --noEmit`, because at the type level
 * the re-export is perfectly legal. It was introduced with the Klaviyo
 * integration (81a140fc, PR #103) and had no consumer: nothing imports
 * `EmailMarketingStatusResult` from this module. Import it from
 * `@/lib/email-marketing`, which is a plain module and can export types freely.
 *
 * Found while running the add-on suite for plan 15.2a-03: 8 of its 17 cases were
 * failing on a 500 PDP before this line was removed, and all 8 pass after.
 */

export type SubscribeEmailSource = "footer" | "checkout" | "form" | "other";

export type SubscribeEmailActionResult = {
  success: boolean;
  error?: string;
};

/** Public status for client components (checkout, etc.). */
export async function getEmailMarketingStatusAction(): Promise<EmailMarketingStatusResult> {
  return getEmailMarketingStatus();
}

/**
 * Correlation token for a subscribe, never the address itself.
 *
 * The subscriber's address is personal data and these logs are retained and
 * broadly readable, so no line carries it. The first 16 hex of the SHA-256 of
 * the lowercased address is enough to find a known submission after the fact,
 * and it is the SAME derivation commerce logs as `email_hash`
 * (`hashEmailForLog` in services/commerce/internal/service/email_marketing_service.go),
 * so a storefront line and a commerce line can be joined on it.
 */
function emailHash(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

/**
 * Subscribe an email when marketing is enabled.
 * Returns success=false (no throw) when disabled or on soft failures so UI can no-op.
 *
 * Every non-success path logs one structured line through `lib/logger.ts`. That
 * is deliberately redundant with commerce's own
 * `email_marketing_subscribe_result` line: this one is the only record when the
 * request never REACHES commerce (gateway down, SDK transport failure), where
 * commerce by definition logs nothing. Neither line carries the address or any
 * key material — see {@link emailHash}.
 */
export async function subscribeEmailAction(input: {
  email: string;
  source: SubscribeEmailSource;
  firstName?: string;
  lastName?: string;
}): Promise<SubscribeEmailActionResult> {
  const email = input.email.trim();
  if (!email) {
    logger.error("email_marketing_subscribe_rejected", {
      source: input.source,
      reason: "email_missing",
    });
    return { success: false, error: "Email is required" };
  }

  const hash = emailHash(email);

  try {
    const result = await createServerHeadkit().emailMarketing.subscribe({
      email,
      source: input.source,
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
    });

    if (result.userErrors?.length) {
      const first = result.userErrors[0];
      logger.error("email_marketing_subscribe_rejected", {
        source: input.source,
        emailHash: hash,
        reason: "user_error",
        code: first?.code ?? "",
        message: first?.message ?? "",
      });
      return {
        success: false,
        error: first?.message ?? "Subscribe failed",
      };
    }

    const success = Boolean(result.success);
    if (!success) {
      // Commerce answers success=false with no user error when the store has no
      // usable email connection — the no-op case, which is NOT a failure.
      logger.info("email_marketing_subscribe_noop", {
        source: input.source,
        emailHash: hash,
      });
    }
    return { success };
  } catch (err) {
    // `errorFields` is the bounded reader — it never emits an SDK error message
    // that may carry a raw upstream body (see its docblock).
    logger.error("email_marketing_subscribe_unreachable", {
      source: input.source,
      emailHash: hash,
      ...errorFields(err),
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : "Subscribe failed",
    };
  }
}
