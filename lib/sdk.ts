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
