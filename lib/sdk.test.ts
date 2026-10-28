import { describe, expect, it, vi } from "vitest";

// `lib/sdk` builds its clients at import and throws without a store key.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_HEADKIT_PUBLIC_KEY ??= "pk_test";
});

import { RETRY_URL_MARKER, retryGatewayUrl } from "./sdk";

/**
 * `retryGatewayUrl` gives a retry a request identity of its own, so Next's
 * fetch cache cannot answer it with the failure it is retrying. That is
 * measured against a real `next build`, not here — this pins the shape of the
 * URL it produces and that it degrades to the SDK default when there is no URL.
 */
describe("retryGatewayUrl", () => {
  it("adds the retry marker without touching the rest of the URL", () => {
    expect(retryGatewayUrl("https://graph.example.test/graphql")).toBe(
      `https://graph.example.test/graphql?${RETRY_URL_MARKER}=1`,
    );
  });

  it("keeps an existing query string and replaces a stale marker", () => {
    expect(
      retryGatewayUrl(
        `http://localhost:4000/graphql?a=1&${RETRY_URL_MARKER}=0`,
      ),
    ).toBe(`http://localhost:4000/graphql?a=1&${RETRY_URL_MARKER}=1`);
  });

  it("differs from the original, which is the whole point", () => {
    const url = "https://graph.example.test/graphql";
    expect(retryGatewayUrl(url)).not.toBe(url);
  });

  it("returns undefined for an unset or unparseable URL so the SDK default applies", () => {
    expect(retryGatewayUrl(undefined)).toBeUndefined();
    expect(retryGatewayUrl("")).toBeUndefined();
    expect(retryGatewayUrl("not a url")).toBeUndefined();
  });
});
