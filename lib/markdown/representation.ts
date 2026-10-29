/**
 * Which requests get a Markdown representation, and where `proxy.ts` sends them.
 *
 * Pure and dependency-free, like `lib/canonical-redirect-request.ts`: the proxy
 * runs on every request, so everything it imports from here must stay clear of
 * the SDK and of anything that reads the store.
 *
 * ---------------------------------------------------------------------------
 * THE SURFACE
 * ---------------------------------------------------------------------------
 * `/`, `/search`, `/collections/*` and `/products/*` have a Markdown twin, asked
 * for either by `Accept: text/markdown` or by appending `.md` to the page URL
 * (`/index.md` for the home page). The proxy REWRITES onto
 * {@link MARKDOWN_ROUTE_PREFIX}, so the visitor's URL never changes and no
 * redirect is spent.
 *
 * Nested `/shop/...` product URLs have NO twin. The flat `/products/{slug}`
 * mirror is the answer-engine path, and its `Link: rel="canonical"` names the
 * nested HTML URL. Serving `/shop/...` would need the proxy to know whether a
 * path is a product, a category or a colourway, which is a catalogue lookup
 * (`resolveShopPath`) the proxy has never made; the flat shape is resolvable by
 * the slug alone.
 *
 * ---------------------------------------------------------------------------
 * WHY THE HTML RESPONSES DO NOT CARRY `Vary: Accept`
 * ---------------------------------------------------------------------------
 * The same URL answers HTML or Markdown by `Accept`, so strictly a cache in
 * front of it should key on that header. The Markdown response says so. The
 * HTML response deliberately does not, because on this estate it changes
 * nothing and costs something: Vercel's CDN already includes `Accept` in its
 * cache key ("Vercel's CDN already includes the `Accept` and `Accept-Encoding`
 * headers as part of the cache key by default. You don't need to explicitly
 * include these headers in your `Vary` header" — vercel.com/docs/caching/cdn-cache),
 * the proxy rewrite changes the path before any cache is consulted, and the
 * twins live at different internal paths. A `Vary: Accept` stamped on every
 * mirrored HTML page would be one more header on the hottest routes for a cache
 * that already behaves that way. Revisit only if a CDN that does NOT key on
 * `Accept` is ever put in front of a storefront.
 *
 * ---------------------------------------------------------------------------
 * WHY THE REWRITE IS FOR `Accept` ONLY WHEN THE CLIENT NAMES `text/markdown`
 * ---------------------------------------------------------------------------
 * A browser, curl and most crawlers send a wildcard range and must keep
 * getting HTML. {@link prefersMarkdown} would give them HTML anyway (a wildcard
 * ties on quality and the HTML entry wins on order), but it is the pre-check
 * that matters for cost: a header with no `markdown` in it never reaches the
 * parser, so an ordinary page request pays one `includes` on a short string.
 * The one shape that decision gives up — `text/*;q=1, text/html;q=0.1`, a
 * client preferring Markdown only through a wildcard — is not a request any
 * agent makes.
 */

/** Internal route tree the proxy rewrites onto. Under `/api`, so `robots.txt` disallows it. */
export const MARKDOWN_ROUTE_PREFIX = "/api/markdown";

export type Representation = "text/html" | "text/markdown";

export type AcceptEntry = {
  position: number;
  quality: number;
  specificity: number;
  type: string;
};

const REPRESENTATIONS = ["text/html", "text/markdown"] as const;

function matches(entry: AcceptEntry, representation: Representation): boolean {
  if (entry.type === "*/*") return true;
  if (entry.type.endsWith("/*")) {
    return representation.startsWith(entry.type.slice(0, -1));
  }
  return entry.type === representation;
}

/** Parse an `Accept` header into entries, dropping anything that is not a media range. */
export function parseAccept(header: string): AcceptEntry[] {
  return header
    .split(",")
    .map((value, position) => {
      const [type = "", ...parameters] = value
        .trim()
        .split(";")
        .map((part) => part.trim());
      let quality = 1;

      for (const parameter of parameters) {
        const [name, rawValue] = parameter
          .split("=")
          .map((part) => part.trim());
        if (name?.toLowerCase() !== "q") continue;

        const parsed = Number(rawValue);
        quality = Number.isFinite(parsed)
          ? Math.min(1, Math.max(0, parsed))
          : 0;
      }

      const normalizedType = type.toLowerCase();
      const specificity =
        normalizedType === "*/*" ? 0 : normalizedType.endsWith("/*") ? 1 : 2;

      return { position, quality, specificity, type: normalizedType };
    })
    .filter(({ type }) => type.includes("/"));
}

/**
 * True when `Accept` ranks Markdown strictly above HTML, or ties it with
 * Markdown listed first. A tie between two wildcard matches goes to HTML.
 */
export function prefersMarkdown(accept: string | null): boolean {
  if (!accept) return false;
  // See the header: no `markdown` anywhere means no parse.
  if (!accept.toLowerCase().includes("markdown")) return false;

  const entries = parseAccept(accept);
  if (entries.length === 0) return false;

  let selection: {
    position: number;
    quality: number;
    representation: Representation;
  } | null = null;

  for (const representation of REPRESENTATIONS) {
    let match: AcceptEntry | null = null;

    for (const entry of entries) {
      if (!matches(entry, representation)) continue;
      if (
        !match ||
        entry.specificity > match.specificity ||
        (entry.specificity === match.specificity &&
          entry.position < match.position)
      ) {
        match = entry;
      }
    }

    if (!match || match.quality === 0) continue;
    if (
      !selection ||
      match.quality > selection.quality ||
      (match.quality === selection.quality &&
        match.position < selection.position)
    ) {
      selection = {
        position: match.position,
        quality: match.quality,
        representation,
      };
    }
  }

  return selection?.representation === "text/markdown";
}

/**
 * The internal Markdown route for a public HTML pathname, or null when the
 * pathname has no Markdown twin.
 */
export function getMarkdownPath(pathname: string): string | null {
  if (pathname === "/") return MARKDOWN_ROUTE_PREFIX;
  if (pathname === "/search") return `${MARKDOWN_ROUTE_PREFIX}/search`;
  if (pathname.startsWith("/collections/")) {
    return `${MARKDOWN_ROUTE_PREFIX}${pathname}`;
  }
  if (pathname.startsWith("/products/")) {
    return `${MARKDOWN_ROUTE_PREFIX}${pathname}`;
  }
  return null;
}

/** The internal route for a `.md` URL (`/products/bike.md`, `/index.md`), or null. */
export function getMarkdownMirrorPath(pathname: string): string | null {
  if (!pathname.endsWith(".md")) return null;
  const pagePath = pathname.slice(0, -".md".length);
  if (pagePath === "/") return null;
  return getMarkdownPath(pagePath === "/index" ? "/" : pagePath);
}

/**
 * The route `proxy.ts` rewrites this request onto, or null to leave it alone.
 *
 * Takes the three values it reads rather than a `Request`, so the proxy builds
 * no second `URL` on every request. GET and HEAD only: a Server Action POSTs to
 * the page's own URL and must never be answered with Markdown.
 */
export function markdownRewritePath(
  method: string,
  pathname: string,
  accept: string | null,
): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const mirror = getMarkdownMirrorPath(pathname);
  if (mirror) return mirror;
  const path = getMarkdownPath(pathname);
  return path && prefersMarkdown(accept) ? path : null;
}
