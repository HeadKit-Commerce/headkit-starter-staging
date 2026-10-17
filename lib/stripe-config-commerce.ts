import { headkitTransportOpts } from "@/lib/headkit-transport";
import type { StorefrontStripeConfig } from "./stripe-config";

/**
 * Commerce ConfigForStore keys. `null` means commerce is unavailable
 * (older revision, transport error) and the dashboard fallback should run.
 * An empty accountId is a successful answer, not a miss: with a publishable key
 * it is direct mode (an enterprise store's own account), without one it means
 * no Stripe — `fetchStripeConfig` tells the two apart.
 *
 * The query is inlined rather than imported from `@headkit/sdk` so the
 * mirrored starter still type-checks against the currently published SDK
 * (GetStorefrontStripeConfigDocument is not in @headkit/sdk@1.3.1).
 */
const COMMERCE_STRIPE_CONFIG_QUERY = /* GraphQL */ `
  query GetStorefrontStripeConfig {
    commerce {
      stripeConfig {
        publishableKey
        stripeAccountId
        testMode
        bnplMessagingEnabled
      }
    }
  }
`;

/**
 * Coerce a commerce GraphQL `data` payload into storefront Stripe config.
 * Returns null when the shape is missing or unusable (unknown-field miss).
 */
export function mapCommerceStripeConfigResponse(
  data: unknown,
): StorefrontStripeConfig | null {
  if (!data || typeof data !== "object") return null;
  const commerce = (data as { commerce?: unknown }).commerce;
  if (!commerce || typeof commerce !== "object") return null;
  const raw = (commerce as { stripeConfig?: unknown }).stripeConfig;
  if (!raw || typeof raw !== "object") return null;
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.publishableKey !== "string") return null;
  if (typeof cfg.stripeAccountId !== "string") return null;
  return {
    publishableKey: cfg.publishableKey,
    accountId: cfg.stripeAccountId,
    bnplMessagingEnabled: cfg.bnplMessagingEnabled === true,
  };
}

export async function fetchCommerceStripeConfig(): Promise<StorefrontStripeConfig | null> {
  try {
    const opts = headkitTransportOpts();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-headkit-key": opts.apiKey,
    };
    if (opts.secretKey) {
      headers["x-headkit-secret-key"] = opts.secretKey;
    }
    const res = await fetch(opts.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: COMMERCE_STRIPE_CONFIG_QUERY }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: unknown;
      errors?: unknown;
    };
    if (json.errors) return null;
    return mapCommerceStripeConfigResponse(json.data);
  } catch {
    return null;
  }
}
