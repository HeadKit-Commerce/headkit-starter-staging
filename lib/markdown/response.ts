/**
 * Cache lifetime of every Markdown mirror and of `/llms.txt`.
 *
 * Short on purpose. These bodies are built from `"use cache"` entries that
 * `/api/revalidate` expires on a catalogue edit, but an HTTP cache in front of
 * the route is a second layer no tag reaches. A price or stock figure served
 * from it must not outlive the PDP's own availability line, which is 300 s
 * (`getProductStock`), and `stale-while-revalidate` must not extend that.
 */
export const MARKDOWN_CACHE_CONTROL =
  "public, max-age=0, s-maxage=300, stale-while-revalidate=300";

/**
 * A Markdown mirror response.
 *
 * - `X-Robots-Tag: noindex` — the mirror is for agents; the HTML page stays the
 *   indexed document, and the `Link` below says which one that is.
 * - `Vary: Accept` — the same URL answers Markdown or HTML by `Accept`.
 * - `X-Content-Type-Options: nosniff` — store text is in the body; a browser
 *   must not guess it into HTML.
 */
export function markdownResponse({
  body,
  canonicalUrl,
}: {
  body: string;
  /** Absolute URL of the HTML page this is the Markdown twin of. */
  canonicalUrl: string;
}): Response {
  return new Response(body, {
    headers: {
      "Cache-Control": MARKDOWN_CACHE_CONTROL,
      "Content-Type": "text/markdown; charset=utf-8",
      Link: `<${canonicalUrl}>; rel="canonical"`,
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      Vary: "Accept",
    },
  });
}

/** The answer when the store declares no usable origin: nothing absolute can be written. */
export function markdownUnavailable(): Response {
  return new Response("Markdown representation unavailable", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}

/** The answer for a path with no Markdown twin (unknown slug, facet URL, extra segments). */
export function markdownNotFound(): Response {
  return new Response("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex",
    },
  });
}
