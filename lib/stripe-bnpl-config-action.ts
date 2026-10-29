"use server";

import {
  getStripeConfig,
  type StorefrontStripeConfig,
} from "@/lib/stripe-config";

/**
 * Server action so the cart drawer — a client-only component mounted once in
 * the root layout with no server props (`LazyCartDrawer` is `ssr: false`) —
 * can read the same per-store Stripe config the PDP and checkout read
 * server-side. Thin wrapper: `getStripeConfig()` is already `"use cache:
 * remote"`, so this pays no extra request to the commerce graph.
 */
export async function getStripeBnplConfigAction(): Promise<StorefrontStripeConfig> {
  return getStripeConfig();
}
