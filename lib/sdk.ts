import { createClientSDK, type ClientSDK } from "@headkit/sdk";

/**
 * PK-based SDK singleton — auto-detects from NEXT_PUBLIC_HEADKIT_PUBLIC_KEY.
 * Safe to import in client components, server components, and server actions.
 *
 * For cart-aware usage: headkit.withCartToken(token).cart.get()
 */
export const headkit: ClientSDK = createClientSDK();

/**
 * The same SDK with read retries off (`maxRetries: 0`), for a read a shopper
 * waits on with a short deadline of its own — the `/search` facet read gives
 * up after 5 s, and the default backoff would keep asking a failing upstream
 * for ~30 s after that.
 */
export const headkitNoRetry: ClientSDK = createClientSDK({ maxRetries: 0 });

/**
 * The query parameter that makes a retry a DIFFERENT request. See
 * {@link retryGatewayUrl}.
 */
export const RETRY_URL_MARKER = "hk_retry";

/**
 * The gateway URL a retry is sent to: the same endpoint with a throwaway query
 * parameter the gateway ignores.
 *
 * Why a retry needs to be a different request at all: Next's fetch cache stores
 * an HTTP 200 response and replays it to an identical request. A GraphQL error
 * body is a 200, so under `next build` — where the cache is on for the SDK's POSTs —
 * the first failure of a read is stored and a retry of the SAME request is
 * answered from it without ever reaching the gateway (measured against the local
 * Docker stack: one injected failure, 18 cache hits on it, every retry
 * "failed" and the build with them). Statuses the SDK transport classifies as
 * transient (429, 5xx, connection errors) are retried by the SDK itself and are
 * not affected. The SDK sends no `cache` option and has no hook for one, so the
 * request identity is the only lever the storefront has; a proper fix is an SDK
 * option that sends `cache: "no-store"` on a retry.
 *
 * Returns `undefined` for an unset or unparseable URL, so the SDK falls back to
 * its own default exactly as {@link headkit} does.
 */
export function retryGatewayUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const marked = new URL(url);
    marked.searchParams.set(RETRY_URL_MARKER, "1");
    return marked.toString();
  } catch {
    return undefined;
  }
}

/**
 * The SDK for the ONE retry a storefront read gives itself after a failure the
 * transport does not already retry (a GraphQL error body, e.g. an undecodable
 * or timed-out subgraph response). No SDK-level retries — the first attempt
 * already had them — and a request identity of its own, so a failure the fetch
 * cache stored is not replayed back (see {@link retryGatewayUrl}).
 *
 * Use it for the SECOND attempt only; the first goes through {@link headkit}.
 */
export const headkitRetry: ClientSDK = createClientSDK({
  maxRetries: 0,
  ...(retryGatewayUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL) !== undefined
    ? { url: retryGatewayUrl(process.env.NEXT_PUBLIC_GRAPHQL_URL) as string }
    : {}),
});
