import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guard for the soft-404 regression: a missing URL answered HTTP 200.
 *
 * The cause was never a missing `notFound()` — every route called one. It was
 * WHERE. `notFound()` signals by throwing, and a throw can only set the status
 * while the status line is unsent. Under Cache Components the response commits
 * as 200 the moment a `<Suspense>` fallback renders, so a `notFound()` raised
 * inside the boundary arrives too late: Next injects
 * `<meta name="robots" content="noindex">` into the already-streaming body
 * instead of sending a 404 header (which is why an affected page carried TWO
 * robots metas). "Setting a status code needs THREE conditions" in
 * `apps/starter/AGENTS.md` is the ONE owner of the rule; the measured tables
 * live there and in `app/products/[...slug]/page.tsx`.
 *
 * THREE conditions decide the status code, and only one of them has a runtime
 * form at module scope, so only that one is asserted by LOADING the route:
 *
 *   1. `generateStaticParams` exists and yields at least one param — without it
 *      the route is served from a fully postponed prerendered shell (see that
 *      test).
 *
 * The other two have NO runtime form at module scope, so they stay structural
 * and are deliberately kept that way:
 *
 *   2. the existence gate is awaited in the default export, above every
 *      `<Suspense>`, and
 *   3. no `loading.tsx` at the route segment or ANY ancestor segment, and no
 *      `<Suspense>` wrapping `{children}` in `app/layout.tsx`.
 *
 * `export const instant === false` is pinned per route as well, and it is NOT a
 * fourth condition: on a Next 16.3 production build, flipping one gated route to
 * `instant = true` and changing nothing else left the 404, its headers and its
 * single robots meta identical (measured; recorded in AGENTS.md). That
 * assertion enforces the DECLARATION these routes make — they block on one
 * cached read before responding — not the status code itself.
 *
 * EIGHT routes used to be gated. Card destinations are not: shop, products,
 * collections, brand, news and projects each have a `loading.tsx`, which is
 * what makes a click paint that page or its skeleton immediately. A missing
 * URL on those routes streams as 200 with `noindex`. CMS pages, client pages
 * and wholesale stay gated and keep a real 404. See "Card routes navigate
 * instantly" in `apps/starter/AGENTS.md`.
 *
 * The root-layout half of (3) is the reason this file exists rather than being
 * copied: a sibling storefront shipped that same route-wide hoist, correctly,
 * with tests — and its missing URLs still answer 200 today, because its root
 * layout carries that boundary and neither of its tests looked at the layout. Hoisting every route
 * and leaving one ancestor boundary in place is a complete, inert fix. Only a
 * comment protected that condition here before this test.
 *
 * Placement of the gate relative to the boundary is structural for the same
 * reason: calling a route's default export cannot observe it, because
 * `notFound()` throws `NEXT_HTTP_ERROR_FALLBACK` under every arrangement.
 *
 * A live status-code assertion over real HTTP lives in
 * `e2e/not-found-status.spec.ts`; it needs a running app, so this runs in the
 * unit gate and that one gates a deploy. Keep both.
 */

// The route modules pull in `lib/env`, whose Zod parse runs at module scope.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_HEADKIT_PUBLIC_KEY ??= "pk_test";
  process.env.NEXT_PUBLIC_GRAPHQL_URL ??= "http://localhost:4000/graphql";
  process.env.HEADKIT_PRIVATE_KEY ??= "sk_test";
});

vi.mock("server-only", () => ({}));

/**
 * Every route module is loaded here, so the reads their `generateStaticParams`
 * makes at build must not reach the network. Each of them already falls back to
 * the placeholder param when the catalogue is unreachable — which is exactly
 * the branch under test: a route with nothing to enumerate must STILL return a
 * param, or it is served from a postponed shell and its gate is inert.
 */
vi.mock("@/lib/sdk", () => {
  const offline = (): Promise<never> =>
    Promise.reject(new Error("catalogue unreachable"));
  return {
    headkit: new Proxy(
      {},
      { get: () => new Proxy({}, { get: () => offline }) },
    ),
  };
});

vi.mock("next/cache", () => ({
  cacheLife: (): void => {},
  cacheTag: (): void => {},
  revalidateTag: (): void => {},
  updateTag: (): void => {},
}));

// Module-scope Zod env parse; throws under Vitest without a full store env.
vi.mock("@/lib/stripe-config", () => ({
  getStripeConfig: (): Promise<unknown> =>
    Promise.resolve({
      publishableKey: "",
      accountId: "",
      bnplMessagingEnabled: false,
    }),
}));

vi.mock("@/lib/product-cache", () => ({
  getCachedProduct: (): Promise<null> => Promise.resolve(null),
  getProductForPage: (): Promise<null> => Promise.resolve(null),
}));

interface RouteModule {
  instant?: unknown;
  generateStaticParams?: () => Promise<unknown[]>;
}

/**
 * Routes whose 404 must be decided before the response commits, each paired
 * with a STATIC import of the real module — a static specifier so the loader
 * resolves it the same way Next does, and so a renamed route fails here rather
 * than silently dropping out of the list.
 */
const GATED_ROUTES: readonly [string, () => Promise<RouteModule>][] = [
  ["app/[...slug]/page.tsx", () => import("./[...slug]/page")],
  ["app/client/[...slug]/page.tsx", () => import("./client/[...slug]/page")],
  // Static route, no params — but it resolves a WordPress page that may be
  // absent, and it answered 200 for a store that has none.
  ["app/wholesale/page.tsx", () => import("./wholesale/page")],
];

/**
 * Card destinations. `loading.tsx` is the shell, so these are instant and
 * do not promise a real 404. The flat PDP stays in this list: it was already
 * un-gated for Shopify draft preview, and its skeleton is the same file.
 */
const CARD_ROUTES: readonly [string, () => Promise<RouteModule>][] = [
  [
    "app/collections/[...slug]/page.tsx",
    () => import("./collections/[...slug]/page"),
  ],
  ["app/news/[...slug]/page.tsx", () => import("./news/[...slug]/page")],
  ["app/shop/[...slug]/page.tsx", () => import("./shop/[...slug]/page")],
  ["app/brand/[...slug]/page.tsx", () => import("./brand/[...slug]/page")],
  [
    "app/projects/[...slug]/page.tsx",
    () => import("./projects/[...slug]/page"),
  ],
  [
    "app/products/[...slug]/page.tsx",
    () => import("./products/[...slug]/page"),
  ],
];

/**
 * Routes that recover from a thrown read. A bare `catch` swallows the
 * NEXT_HTTP_ERROR_FALLBACK / NEXT_REDIRECT that `notFound()` and `redirect()`
 * throw, so each must rethrow Next's control flow before treating the failure
 * as a miss — otherwise the gate re-derives its 404 by luck and converts a
 * genuine transport failure into one.
 */
const ROUTES_WITH_RECOVERING_CATCH = [
  "app/news/[...slug]/page.tsx",
  "app/projects/[...slug]/page.tsx",
  "app/client/[...slug]/page.tsx",
] as const;

const read = (rel: string): string =>
  readFileSync(resolve(__dirname, "..", rel), "utf8");

describe("missing pages answer a real 404, not a 200 shell", () => {
  it.each(GATED_ROUTES)("%s is a blocking route", async (rel, load) => {
    const route = await load();

    expect(
      route.instant,
      `${rel} must export \`instant = false\`. That is the DECLARATION that ` +
        `this route blocks on a cached read before it responds, which is what ` +
        `its hoisted gate does. It is not what makes the 404 status possible — ` +
        `flipping a gated route to \`true\` changed nothing measurable — so do ` +
        `not add it to a route as the fix for a soft 404.`,
    ).toBe(false);
  });

  it.each(GATED_ROUTES)(
    "%s enumerates at least one static param",
    async (rel, load) => {
      // The condition no prior version of this guard knew about. MEASURED on a Next 16.3 production build with
      // `cacheComponents: true`: a dynamic segment with NO
      // `generateStaticParams` is served from a fully POSTPONED prerendered
      // shell (`x-nextjs-prerender: 1`, `x-nextjs-postponed: 1`), so the 200 is
      // committed by that shell before the page component runs and the hoisted
      // `notFound()` can only add a `noindex` meta. `/news/{missing}` and
      // `/projects/{missing}` still answered 200 with both other conditions
      // satisfied — hoisted gate, no loading.tsx (and `instant = false`, which
      // turns out not to matter either way) — and
      // declaring a placeholder-only `generateStaticParams` was the single
      // change that made both 404.
      //
      // The SDK is offline in this suite, which is the branch that matters:
      // returning [] when the catalogue cannot be reached is the same failure
      // as not declaring the function at all.
      //
      // A static route (wholesale) has no params to enumerate and is exempt.
      const route = await load();
      if (!rel.includes("[")) {
        expect(route.generateStaticParams).toBeUndefined();
        return;
      }

      expect(
        typeof route.generateStaticParams,
        `${rel} must export generateStaticParams. Without it the route is ` +
          `served from a fully postponed prerendered shell, which commits 200 ` +
          `before the gate runs — the gate is then inert however correctly it ` +
          `is written.`,
      ).toBe("function");

      const params = await route.generateStaticParams?.();
      expect(
        params?.length ?? 0,
        `${rel}'s generateStaticParams returned nothing. Cache Components ` +
          `treats an empty param set as no param set, so the route falls back ` +
          `to the postponed shell and the gate goes inert. A route with ` +
          `nothing to enumerate still returns the placeholder param (see ` +
          `app/client/[...slug]/page.tsx).`,
      ).toBeGreaterThan(0);
    },
  );

  it.each(GATED_ROUTES)("%s decides 404 before any Suspense", (rel) => {
    // No runtime form: calling the default export cannot observe WHERE the
    // throw came from — `notFound()` raises the same NEXT_HTTP_ERROR_FALLBACK
    // above the boundary and below it. Only the order in the source says which.
    const src = read(rel);

    const defaultExport = src.indexOf("export default async function");
    expect(
      defaultExport,
      `${rel} must have an \`async\` default export: the existence check has ` +
        `to be awaited in the route segment itself, above the boundary.`,
    ).toBeGreaterThan(-1);

    const body = src.slice(defaultExport);
    const gate = body.indexOf("notFound()");
    const boundary = body.indexOf("<Suspense");

    expect(
      gate,
      `${rel}'s default export must call notFound() itself, not delegate the ` +
        `decision to a component inside <Suspense>.`,
    ).toBeGreaterThan(-1);

    // A route with no boundary at all (wholesale) is fine — nothing can commit
    // the response early. When there IS one, the gate must come first.
    if (boundary > -1) {
      expect(
        gate,
        `${rel} calls notFound() only after rendering <Suspense>. Once that ` +
          `fallback renders the status line is already sent as 200.`,
      ).toBeLessThan(boundary);
    }
  });

  it.each(GATED_ROUTES)("%s has no loading.tsx above it", (rel) => {
    // Boundary source #2. A `loading.tsx` is an IMPLICIT Suspense boundary that
    // wraps its own segment AND every segment nested below it, so a file in an
    // ANCESTOR folder gates this route just as surely as one beside it — which
    // is how `/shop/[...slug]` stayed a soft 404 through `app/shop/loading.tsx`
    // and why this walks the whole chain up to `app/` rather than checking one
    // directory.
    //
    // This is a filesystem CONVENTION, not source text: Next resolves the
    // boundary from the presence of the file, so presence is the property.
    const segments = rel.split("/").slice(0, -1); // drop "page.tsx"
    const offenders = segments
      .map((_, i) => [...segments.slice(0, i + 1), "loading.tsx"].join("/"))
      .filter((candidate) => existsSync(resolve(__dirname, "..", candidate)));

    expect(
      offenders,
      `${rel} is wrapped by an implicit Suspense boundary from ` +
        `${offenders.join(", ")}. A loading.tsx commits the 200 before the ` +
        `gate can throw, for this route and every route nested under it.`,
    ).toEqual([]);
  });

  it.each(CARD_ROUTES)(
    "%s navigates instantly via its own loading.tsx",
    async (rel, load) => {
      const route = await load();
      expect(
        route.instant,
        `${rel} is a card destination. instant = true declares that a click ` +
          `paints this page or its loading.tsx immediately.`,
      ).toBe(true);

      const segments = rel.split("/").slice(0, -1);
      const shells = segments
        .map((_, i) => [...segments.slice(0, i + 1), "loading.tsx"].join("/"))
        .filter((candidate) => existsSync(resolve(__dirname, "..", candidate)));
      expect(
        shells.length,
        `${rel} needs a loading.tsx on its segment so a click can show that ` +
          `page's skeleton when the content is not ready.`,
      ).toBeGreaterThan(0);
    },
  );

  it.each(ROUTES_WITH_RECOVERING_CATCH)(
    "%s rethrows Next control flow out of its catch",
    (rel) => {
      const src = read(rel);
      expect(
        src,
        `${rel} recovers from a thrown read. notFound() and redirect() signal ` +
          `by throwing, so the catch must call unstable_rethrow(err) before ` +
          `deciding the failure was a miss — otherwise it swallows them.`,
      ).toMatch(/unstable_rethrow\(/);

      expect(
        src,
        `${rel} still has a bare \`catch {\`. Every recovering catch on this ` +
          `route must bind the error and rethrow Next's control flow first.`,
      ).not.toMatch(/\}\s*catch\s*\{/);
    },
  );

  it("the root layout does not wrap {children} in a Suspense boundary", () => {
    // Boundary source #3, and the one that makes an otherwise-correct hoist
    // INERT — measured on a sibling storefront that shipped this same fix and
    // still answers 200 for every missing URL. Its tests were written against
    // the routes only, so nothing observed the layout. Here, until this
    // assertion, only a comment did.
    //
    // No runtime form either: rendering the layout would need every provider,
    // and a <Suspense> that never suspends is invisible in the output — the
    // boundary's effect is on the STREAM, which only a real request shows.
    // Comments are stripped first: the warning comment in the layout names
    // both `<Suspense>` and `{children}`, so a raw scan finds the comment's
    // mention rather than the real render site.
    const src = read("app/layout.tsx")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    const children = src.indexOf("{children}");
    expect(children, "app/layout.tsx must render {children}").toBeGreaterThan(
      -1,
    );

    // Every boundary that OPENS before {children} must also CLOSE before it.
    // Counting nesting rather than matching text means a boundary that closes
    // immediately (a SIBLING of {children}) stays legal, while any boundary
    // left open across {children} fails.
    const before = src.slice(0, children);
    const opened = (before.match(/<Suspense[\s>]/g) ?? []).length;
    const closed = (before.match(/<\/Suspense>/g) ?? []).length;

    expect(
      opened - closed,
      `app/layout.tsx leaves a <Suspense> open around {children}. That is an ` +
        `ANCESTOR boundary: it commits the 200 for EVERY route, so each ` +
        `route's own hoisted notFound()/permanentRedirect() lands after the ` +
        `status line is already sent and the whole gate above is inert. Keep ` +
        `boundaries below {children}, inside the routes.`,
    ).toBe(0);
  });

  it("the root layout makes no request-time read", () => {
    // The SECOND rule this layout has to keep, and the one the boundary check
    // above cannot see. A boundary in the root layout is FREE — the one around
    // the customer's <BelowMain /> slot costs nothing, because its child is
    // cached. A request-time read INSIDE one is not: it postpones a dynamic
    // hole in EVERY route in the application, so no response can be served as
    // a finished file and each is produced by a runtime React resume.
    // Measured on a deployed probe, one variable at a time: +1.4 s on a 27 KB
    // page, +2.4 s on a 236 KB page, +44-68% bytes, on every page and every
    // RSC payload (lib/host-robots.ts carries the full table).
    //
    // This layout used to render <DynamicMetadataMarker /> — a SIBLING of
    // {children}, so the nesting check above was green for it — purely so the
    // `robots` meta could be decided from the request Host. That signal is an
    // X-Robots-Tag response header now, and nothing request-time may come back.
    //
    // SCOPE: a SOURCE scan of this one file. It catches the four request-time
    // APIs and the marker by name, in the layout itself. It does NOT follow
    // into a component the layout renders — including the customer-owned
    // `overrides/layout-slots.tsx` slots, whose whole point is that a store
    // writes them; a request-time read added THERE costs the same thing and
    // nothing here will say so. The build is still the only place the real
    // rule is enforced.
    const src = read("app/layout.tsx")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    const reads = [
      ...src.matchAll(
        /\b(connection|headers|cookies|draftMode)\s*\(\s*\)|<DynamicMetadataMarker\b/g,
      ),
    ].map((match) => match[0]);

    expect(
      reads,
      `app/layout.tsx performs a request-time read (${reads.join(", ")}). ` +
        `In the ROOT layout that postpones a dynamic hole in EVERY route, so ` +
        `no page in the app can be served as a finished file — measured at ` +
        `+1.4 s / +2.4 s and +44-68% bytes. Put the read in the one route ` +
        `that needs it, or move the signal off the render path entirely (see ` +
        `lib/host-robots.ts).`,
    ).toEqual([]);
  });
});
