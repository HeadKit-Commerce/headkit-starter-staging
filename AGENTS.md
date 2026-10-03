# Agent guide — HeadKit starter storefront

Instructions for AI agents customising a customer storefront derived from this template.

## Customisation priority (follow in order)

1. **Dashboard branding** — colours, fonts, corner radius, icons. No code changes.
2. **`overrides/styles.css`** — cosmetic UI (layout, spacing, visibility, typography tweaks).
3. **`overrides/header-actions.tsx`** — extra header icons (phone, etc.) that CSS cannot inject.
4. **New routes / local components** — one-off pages or behaviour that cannot be expressed in CSS.
5. **Edit core components** — last resort; creates merge pain on starter upgrades.

## Do not edit for cosmetic work

Avoid changing these files when the goal is visual styling only:

- `components/headkit-ui/*` (except when adding a missing platform hook — prefer a monorepo PR)
- `app/globals.css` (platform defaults)
- `app/layout.tsx` (unless wiring new override assets)

Use **CSS hook classes** documented in [`overrides/README.md`](./overrides/README.md) instead. All hooks use the `headkit-*` prefix — e.g. `.headkit-nav`, `.headkit-home`, `.headkit-callout`, `.headkit-brand-carousel`, `.headkit-footer-payment-methods`.

## Typical tasks

| Task                                          | Where                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Change nav link style                         | `overrides/styles.css` → `.headkit-nav`                                                         |
| Homepage section backgrounds                  | `overrides/styles.css` → `.headkit-home .headkit-*-carousel`                                    |
| Hide prices                                   | `overrides/styles.css` → `.price`, `[data-price]`                                               |
| Hide footer payment icons                     | `overrides/styles.css` → `.headkit-footer-payment-methods`                                      |
| Restyle callout / promo                       | `overrides/styles.css` → `.headkit-callout`                                                     |
| Add header phone / extra icon                 | `overrides/header-actions.tsx` → `HeaderActionExtras`                                           |
| Extra homepage tile or block                  | `overrides/home-slots.tsx`                                                                      |
| Script in `<head>` or block under main        | `overrides/layout-slots.tsx` (`BelowMain` stays a sibling of `{children}`)                      |
| PDP block beside bundles or under the buy box | `overrides/pdp-beside-bundles.tsx`, `overrides/pdp-buy-box-extras.tsx`                          |
| Two-column page or page video                 | `overrides/page-columns.tsx` (`renderPageMediaSegment`, `preparePageHtml`)                      |
| Shopify form beside page copy                 | `overrides/page-form-layout.tsx`                                                                |
| Journal or post video modal                   | `overrides/post-video-dialog.tsx`                                                               |
| Hide collection breadcrumbs                   | `overrides/collection-slots.tsx` (`showCollectionBreadcrumbs` returns false)                    |
| Homepage journal heading                      | `overrides/theme.json` `copy.homepageLatestNews`                                                |
| New landing page                              | `app/<route>/page.tsx` + declare the route in `sitemap.config.ts` (never edit `app/sitemap.ts`) |
| Change checkout logic                         | `lib/` + `app/checkout/` (behaviour, not cosmetics)                                             |

## Missing hook?

If you need a stable selector that does not exist, add a `headkit-*` class to the **platform starter** (`apps/starter` in the monorepo), not only the customer repo. Customer repos should consume hooks from upstream starter merges.

## Platform rules that survive a starter upgrade

### Canonical URL shape: NESTED wins, and one helper derives it

`/shop/<cat…>/<slug>` is the canonical product URL and `/collections/<parent>/<child>` the
canonical collection URL (captain's decision, 2026-08-22 — chosen to keep the V1 sites'
index equity, and deliberately NOT configurable). The flat `/products/<slug>` and
`/collections/<child>` shapes 308 onto them.

- **One derivation, never a second.** `lib/canonical-path.ts` (`productPath`,
  `productShopSegments`, `collectionPathFromSegments`) is the only place a product URL is
  built; a category's own path comes from `collectionPathFromCategory`
  (`components/headkit-ui/collection/utils.ts`), and the shared category-tree walk is
  `walkCategoryPaths` in `app/shop/shop-slug.ts`. The defect this closed was precisely a
  second copy: `app/sitemap.ts` advertised the nested shape while every link and the
  Product JSON-LD named the flat one, with both serving 200 and no redirect between them.
- **A product's canonical is its WooCommerce permalink** — not its first category, and not
  the page it was linked from. One value per product, so a product filed in several
  categories has the same canonical from every entry point.
- **Every signal must name the same string**: canonical / `og:url`, the 308 `Location`,
  every rendered link (nav, breadcrumbs, product cards, collection tiles, related
  products), Product + Breadcrumb JSON-LD, and the sitemap entry.
  `app/canonical-url-shape.test.tsx` asserts all of them together, in ONE test, for one
  fixture — keep it that way; five separate green tests are exactly the shape the bug
  already passed.
- **A route that redirects must sit above EVERY Suspense boundary — including the root
  layout's.** Under Cache Components a redirect thrown inside a boundary commits after the
  response, so the route answers 200 with a shell and redirects only on the client.
  `notFound()` fails the same way, so the sources that commit the response are enumerated
  once below, under "Setting a status code needs THREE conditions" — one of them was
  `app/layout.tsx` wrapping `{children}`, which is why nothing there may wrap `{children}`
  in one again. What decides is ANCESTRY, not presence: the narrow boundary `app/layout.tsx`
  still carries around the customer's `<BelowMain />` slot is a SIBLING of `{children}`, so
  it puts no page inside a boundary and no route's redirect below one. A boundary there is
  free; a REQUEST-TIME read inside one is not, and that is a separate rule — see "A
  request-time read in the ROOT layout costs every route its static shell". Measured on
  Next 16.3 with `cacheComponents: true`, one variable at a time: any of them present
  → 200; all absent → a real 308, prerendered and at runtime alike. `instant = true`
  makes no difference either way. Render the fallback from the page's own `<Suspense>`
  instead. The same trap is why the `/posts` → `/news` move lives in `next.config.ts`
  `redirects()`.
  A unit test cannot see any of this — calling the page function throws `NEXT_REDIRECT`
  under every arrangement — so `e2e/canonical-url-308.spec.ts` is what holds it, by asserting
  the status code over real HTTP against a built, running app. A root boundary also empties the
  prerendered shell: measured JS-off, the home page carried 0 visible characters with it and
  409 without. The same goes for a route-level boundary around a page's own cached content —
  see "Cached content renders OUTSIDE the boundary" below.

**One recorded exception to "every signal", and it is not small.** On a store using
WooCommerce's default `/product/` permalink base, `productCategorySegments` returns `[]` for
every product, so every PDP falls back to a crumb built from `product.categories` — and that
crumb names the FLAT `/collections/<slug>`, in the rendered link and in the Breadcrumb
JSON-LD alike. That is every PDP breadcrumb on that store class, not a rare degraded path.
It stays flat because the only way to nest it is a category-tree read
(`collectionPathResolver`), a `"use cache"` entry tagged `TAG.collections` — a tag WordPress
fires on every product-CATEGORY term edit — which would land on the PDP route entry and make
one category edit purge every PDP. The cost of the exception is one extra redirect hop; a
crawler following the crumb still reaches the canonical. Do not "fix" it back to the
resolver. Related and still open: the NESTED `/shop/[...slug]` route does still carry
`TAG.collections`, because its tree read is what decides category-vs-product — filed as
`260824-nested-pdp-catalogue-purge-tag` (P1), and it bites hardest on exactly the
nested-permalink stores this decision was made for.

**The trigger in that paragraph was wrong until 2026-09-17, and the correction changes the
frequency but not the decision.** It read "a tag WordPress fires on any PRODUCT or category
change", which would have made every stock save a store-wide PDP purge. `HK_TAG_COLLECTIONS`
is reachable from `headkit_resolve_endpoint_tags` only, which only `created_term` /
`edited_term` / `delete_term` on `product_cat` call; the product builder sends the SINGULAR
`headkit:collection:{slug}`, and only on a listing event. So the purge is per category-admin
edit, not per order. Pinned by name in `lib/wp-revalidation-events.test.ts` ("the plural index
tags are fired by TAXONOMY hooks only") so it cannot drift back. Whoever owns
`260824-nested-pdp-catalogue-purge-tag` should re-rank it against the real trigger — the
welding is unchanged, the rate is not.

**Category ancestry from the tree is not trustworthy; a permalink is.** Commerce builds the
category forest from WooCommerce's un-paginated, `hide_empty=true` list, so a child whose
parent fell outside that page is promoted to a ROOT
(`260822-commerce-category-list-orphan-promotion`, P1). `resolveShopPath` therefore treats an
unvalidatable ancestry chain as containment rather than a 404: alongside the reading its
validated chain supports, it offers the CONTAINMENT readings of the tail — last segment as
the product, last two as product + colourway — marked `ancestryValidated: false`. Those are
guesses, and what makes serving one safe is the route's check, not their position: the
resolved product's OWN permalink must reproduce the requested path exactly, which is what
keeps `/shop/junk/junk/{real}` at not-found. The `categorySegments` it returns cover only the
chain the tree confirmed, deliberately. Derive ancestry from the product's own permalink
(`productCategorySegments`), never from the requested segments.

The cart drawer and quote cart (G23) resolve their canonical `/shop/{cat…}/{slug}` link
client-side: the cart fragment selects a slug and no permalink, so
`components/headkit-ui/cart-item.tsx` and `components/quote/quote-cart-items.tsx` call
`resolveCartItemPath` (`lib/cart-item-path.ts`), which looks the product up by slug through
the same `getCachedProduct` cache the PDP routes read and derives `productPath` from its
`uri` — no SDK/schema change needed, since `ProductFields` already selects `uri`. Until that
resolves (or on a miss), both fall back to the flat `/products/{slug}` guess, which still
reaches the product via the 308.

That fallback window is why robots.txt is NOT what keeps the flat guess out of the crawled
graph on its own — there is no `/cart` route and no `/cart` disallow rule (the cart is a
drawer in the layout), and `/quote` is a real, crawlable, non-disallowed route. The mechanism
is the EMPTY CART: an anonymous crawler carries no cart session, so the cart has zero items
and no product href is emitted at all. `app/quote/page.tsx` short-circuits to `<QuoteEmpty />`;
the drawer additionally never server-renders, because `lazy-cart-drawer.tsx` loads it via
`dynamic(..., { ssr: false })`. Note the asymmetry: the quote summary IS server-rendered for a
request that carries a cart cookie, so it relies solely on the empty-cart short-circuit —
anything that server-renders a POPULATED cart or quote summary still puts the flat guess into
crawlable HTML for the brief window before the client resolves the canonical.

**The 308 carries the incoming QUERY STRING, and it is `proxy.ts` that makes that possible.**
A redirect built from the path alone drops `gclid`, `utm_*` and Klaviyo's `_kx` before the
page can read them, and the visitor still lands on a 200 — so the attribution hole reports
nothing. (The two `redirects()` entries in `next.config.ts` never had it, because Next
preserves the query there by default.) Neither route can fix it in its own default export:
reading `searchParams` or `headers()` there is a dynamic read above every Suspense boundary,
and on a route that also exports `generateStaticParams` that is a BUILD ERROR under Cache
Components — the same two closed levers the Shopify preview paragraph below describes. So the
redirect is ISSUED one layer earlier, from `proxy.ts`, which sees the whole URL. Five things
about it, and each closes a way it could have gone wrong:

- **There is no second copy of the redirect rule.** `/api/canonical-redirect` calls the
  routes' own decision functions — `canonicalCollectionRedirect` (`lib/collection-canonical.ts`)
  and `canonicalProductRedirect` (`lib/product-canonical.ts`), both moved out of their page
  files for exactly this. A proxy-side reimplementation is the one arrangement that can LOOP:
  the proxy sends A → B while the route at B sends B → A. For the same reason the collection
  target comes from the category's OWN ancestry and never from `collectionPathIndex`, whose
  tree can promote an orphaned child to a root
  (`260822-commerce-category-list-orphan-promotion`).
- **It adds no origin read.** Both decision functions resolve through the SAME `"use cache"`
  entries the routes await (`getCachedProduct`, `getCategoryData`), so a warm catalogue
  answers from cache and a cold one pays the single read the route would have paid a moment
  later. That matters on a WordPress origin rate-limited at ~1.8 req/s, where a runaway read
  pattern has caused an outage.
- **The gate is narrow, and the narrowing is what keeps it free**
  (`lib/canonical-redirect-request.ts`): GET/HEAD only (a Server Action POSTs to the page's
  own URL, query and all), a query string must be present (with nothing to preserve the
  route's own 308 is already right), and for collections only a SINGLE category segment — the
  shape the theme actually emits, measured 127 of 127 on one store.
- **Every failure degrades to today's behaviour**, never to a wrong destination: a non-200
  from the endpoint, a malformed body, a network error, an unresolvable slug or a THROWN
  catalogue read all return null, and the route then 308s with the query dropped as before.
- **Two classes are still uncovered, deliberately.** The proxy's matcher excludes any path
  containing a dot, so an encoded facet URL (`/collections/locks/f/colour.black?gclid=…`)
  never reaches the proxy — measured: still a 308, still no query. Widening the matcher would
  newly subject those URLs to the maintenance gate and the `X-Robots-Tag` header, which is a
  bigger decision than this. And a nested collection URL whose parent is wrong keeps the old
  behaviour, because the gate skips it.

Guards: `lib/canonical-redirect.test.ts` composes the gate, the real decision functions and
the URL builder in ONE test (a gate test and a target test that each pass individually are
green while the query is dropped between them) and asserts at SOURCE level that `proxy.ts`
calls it before `readProxyConfig` and after the maintenance gate. It observes no status line
and no header — the two query-preservation cases in `e2e/canonical-url-308.spec.ts` are what
do, over real HTTP.

**Shopify Admin preview needs no exemption from the 308, and must not be given one.** A 308
issued from a ROUTE drops the query string, so `?preview_key=` could not survive one (the
proxy-side redirect above now carries it, but the argument below is what made the exemption
unnecessary in the first place, and it still stands) — yet the exemption that would
normally require is unavailable: reading `searchParams` in the default export is a dynamic
read above every Suspense boundary, which under Cache Components is a BUILD ERROR on a route
with `generateStaticParams`, and the boundary that would fix it is the one that turns the 308
back into a 200. Both levers are closed. Nothing is needed, because the redirect is gated on
`getCachedProduct` — the PUBLIC catalogue read — while preview exists precisely for products
that read cannot see. `GetProductBySlug`
(`services/commerce/internal/provider/shopify/catalog.go`) consults the Admin API only when
the Storefront query returned nothing, and the resolver maps that miss to a null product
rather than an error, so a draft never reaches the redirect at all and falls through to
`ProductPageContent`, which awaits `searchParams` INSIDE the boundary where it is legal. A
published product does still 308 with a key attached, and should: preview reveals nothing
extra about it. Do not add a `preview_key`-shaped exemption — a redirect anyone can opt out
of with a query parameter is not a redirect.

The corollary is the part that looks wrong and is not: `resolveShopifyPreviewProductPath`
(`lib/shopify-preview.ts`) returns the FLAT `/products/{handle}`, the losing shape, and must
keep doing so. The nested route verifies its candidate against `getCachedProduct` before
serving (`resolveShopProduct`), so a draft sent there answers notFound() — the flat route
is the only shape that can render one. Both entry points the HeadKit redirect theme rewrites
to (`integrations/shopify/theme/layout/theme.liquid`) land on it.

`app/products_preview` and `app/draft-product` are `export const instant = false`. They
render nothing and must read `searchParams` above every boundary, because the decision they
make IS the response; they previously borrowed the boundary `app/layout.tsx` wrapped
`{children}` in, and removing that (above) left them with none and failed the build outright.
Giving them a boundary instead would make them answer 200 + empty shell and redirect on the
client — the same defect the product and collection routes exist to close.

### A CMS menu href is NOT a permalink — the theme flattens every category link

The HeadKit WordPress theme's menus endpoint (`integrations/wordpress/theme/inc/rest-api/
headkit-menus.php`) OVERWRITES the stored URL of every `product_cat` menu item with the flat
`/collections/{leaf-slug}`, discarding the hierarchical term permalink WooCommerce built, and
stamps `hk-collection:{slug}` alongside it. Since the nested shape became canonical, every
such link naming a CHILD category costs a 308 hop; a ROOT category is self-canonical, so the
damage looks partial per store and the menu looks internally inconsistent when it is not.

`lib/menu-canonical-href.ts` re-derives those hrefs from the category tree, and every menu
read in `components/headkit-ui/navigation-wrapper.tsx` goes through it. Four things about it:

- **It triggers on the URI SHAPE, never on `hk-collection:{slug}`.** The theme stamps that
  class on taxonomy items, but a merchant can set it by hand on a Custom Link pointing at a
  curated landing page, and that link must keep its own href.
- **An unknown leaf is left EXACTLY as it arrived**, not passed through
  `collectionPathResolver`'s `/collections/{slug}` fallback — the fallback would FLATTEN a
  hand-authored nested href, a worse bug than the hop. That is why `collectionPathIndex` is
  exported from `lib/collection-path.ts`: this is the one caller that must tell "no such
  slug" from "the tree says flat".
- **Every menu read also carries `TAG.collections`**, because a category re-parent changes a
  menu entry's output with no menu edit. No new blast radius: `NavigationWrapper` and
  `getFooterMenus` already carried it, and `collectionPathIndex` is one cached catalogue read
  at `("days", "max")` against the chrome reads' `("hours", "max")` — longer on the
  conservative profile, equal on the aggressive one, so it narrows neither.
- **A tree-read failure PROPAGATES** rather than degrading to flat hrefs, matching the
  sibling category reads: a degraded render would be written into the enclosing cache entry
  and pinned until the next purge.

**Do not "fix" this in WordPress.** Nothing is wrong with the stored data — the theme
discards it on every read, so a corrected URL in Appearance → Menus never reaches the
storefront, and correcting the theme would still leave the storefront trusting a CMS string
for a URL shape the storefront owns.

Guards: `lib/menu-canonical-href.test.ts` (the pure rule) and the "category hrefs are
re-derived from the tree" block in `components/headkit-ui/navigation-wrapper.test.ts` (the
wiring, through the real `NavigationWrapper` / `getFooterMenus` / `fetchMenu`). Neither can
see the served HTML or a timing — those are HTTP reads against a running store. Note also
that a mega-menu's leaf links may not be crawlable anchors at all (the Radix panels and the
mobile sheet render client-side), so on such a store this buys a click, not an indexing fix.

### A `redirects()` source in `next.config.ts` is also a blog base path

`RESERVED_POSTS_BASE` (`lib/posts-path.ts`) exists so a storefront route can never become the
WordPress Posts-page base. `next.config.ts` 308s `/posts` → `/news` unconditionally, and
`proxy.ts` 308s `/news` out to the store's own Posts slug whenever it is not `news` — so on a
store whose Posts page is literally `posts` the two rules are exact inverses and the whole blog
namespace answers ERR_TOO_MANY_REDIRECTS. That happened on a live rehearsal storefront.
`lib/posts-path.test.ts` asserts the whole class against the LIVE config, so adding a redirect
without reserving its first segment fails CI rather than a store. The second generator was the
CMS catch-all's own hard-coded `/news` target; it now derives from
`postsIndexPath(await getPostsBasePath())` and no-ops when the target equals the request.

### Setting a status code needs THREE conditions, and `instant` is not one of them

THIS SECTION IS THE ONE OWNER of the rule. Every gated route's docblock points here rather
than restating it; do not re-explain it in a route file.

`notFound()` and `permanentRedirect()` signal by THROWING, and a throw can only set the
status while the status line is unsent. Under Cache Components the response commits as 200 the
moment anything above the throw can render a fallback, after which Next injects
`<meta name="robots" content="noindex">` into the already-streaming body instead of sending a
404 — which is why an affected page carries TWO robots metas. So a route that must answer 404
or 308 has to satisfy all three of these, and satisfying two still yields 200:

1. **The decision is awaited in the route's own default export**, above every in-page
   `<Suspense>`. Keep the inner component's checks too: the `"use cache"` reads dedupe and the
   component stays correct on its own terms.
2. **No `loading.tsx` at the route OR at any ANCESTOR segment.** A `loading.tsx` is an implicit
   boundary around its own segment and everything nested below it, so `app/shop/loading.tsx`
   gated `/shop/[...slug]`. Equally, **`app/layout.tsx` must never wrap `{children}` in a
   `<Suspense>`** — that one commits the 200 for every route at once and makes an otherwise
   perfect fix completely inert. That is not hypothetical: a sibling storefront shipped this
   same route-wide hoist with two tests and still soft-404s in production today, because its
   root layout carries that boundary and neither test looked at the layout.
3. **`export async function generateStaticParams`, even with nothing to enumerate.** MEASURED
   on a Next 16.3 production build: a dynamic segment WITHOUT one is served from a fully
   postponed prerendered shell (`x-nextjs-prerender: 1`, `x-nextjs-postponed: 1`), so the shell
   commits the 200 before the page component runs. `/news/{missing}` and `/projects/{missing}`
   satisfied 1–2 and still answered 200; adding a placeholder-only `generateStaticParams` was
   the single change that made both 404. `app/client/[...slug]/page.tsx` is the minimal shape.

**`export const instant = false` is NOT a fourth condition, and this file used to say it was.**
The claim — that an instant route may not read `params` outside `<Suspense>`, which condition 1
needs — is false, and the correction is a one-variable MEASUREMENT on a Next 16.3 production
build against the local Docker stack, not a re-reading: with `app/brand/[...slug]/page.tsx`
flipped to `instant = true` and nothing else touched, `/brand/{missing}` still answered **404**,
with `x-nextjs-postponed: 1`, no `x-nextjs-prerender` and exactly ONE robots meta — identical
to the `instant = false` build captured before it, which answered 404 with the same three
signals. `next build` succeeded both ways, and the control (`/brand/acme`) stayed 200 both
ways. `app/products/[...slug]` is a second, independent counter-example already in the tree:
`instant = true`, `params` awaited above the boundary, a real measured 308.

What the export actually controls is NAVIGATION VALIDATION (Next 16.3's own bundled reference,
`next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/instant.md`):
`true` opts the segment into
validation at the globally configured level — framework default `warning`, development only,
errors in the dev overlay, build unaffected — and `false` opts out, declaring the segment
"allowed to block when navigating to it" and exempting the route from the non-empty static
shell check at prerender time. **Keep `instant = false` on every gated route**: blocking on one
cached read before responding is exactly what these routes do, so the export is an accurate
declaration of their shape. Just never attribute a status code to it, and never reach for it as
the fix for a soft 404.

Two more rules follow from the gate rather than from the boundary, and both were shipped
soft-404s in their own right:

- **The gate's read must tell a MISS from a FAILURE.** `notFound()` is for a null the provider
  genuinely returned. A read that catches its own transport error into `null` — especially
  inside a `"use cache"` scope — hands the gate a miss it did not observe, and the gate then
  bakes a real 404 into the route cache for the whole `cacheLife`. `getPageData`
  (`app/[...slug]/page.tsx`, shared with `/wholesale`) did exactly that; it no longer catches,
  and `app/brand`, `app/collections` and `app/shop` state the same rule at their gates. The
  news/projects/client routes keep it with `unstable_rethrow` as the first statement of every
  recovering catch.
- **The build-time placeholder slug 404s AT the gate, not below it.** `generateStaticParams`
  needs ≥1 param (condition 3), so routes with nothing to enumerate return
  `__hk_static_placeholder`. It is never served from a prerender, so a runtime request for it
  is a junk URL: gating it with `if (slug[0] !== PLACEHOLDER) { …check… }` skips the gate and
  lets the inner component's `notFound()` fire below the boundary — the same soft 404, reachable
  by URL. Write `if (slug[0] === PLACEHOLDER) notFound();` above the boundary instead.

**Three route families stay gated:** `app/[...slug]`, `app/client/[...slug]` and the static
`app/wholesale/page.tsx`. `app/not-found-status.test.ts` holds that list in executable form.

### Card routes navigate instantly

`app/shop`, `app/products/[...slug]`, `app/collections/[...slug]`, `app/brand/[...slug]`,
`app/news/[...slug]` and `app/projects/[...slug]` are where cards go. Each has a `loading.tsx`.
That file is Next.js's navigation shell: a click updates the URL immediately. If the destination
was prerendered or already prefetched, that page's content is what renders. If it was not ready,
that route's skeleton renders until the content streams in. The clicked link does not paint a
skeleton of its own.

This is a Suspense boundary, and the costs are the ones this section already measured:

- A missing URL on these routes streams as **200** with `noindex`. It does not answer 404.
- `permanentRedirect` on these routes cannot set **308**. Flat product and flat collection URLs
  stream the redirect. Card clicks already use the canonical path, so a shopper does not hit it.
- A prerendered document puts completed content in a hidden segment and reveals it with the
  inline `$RC` script. With JavaScript off, the skeleton is what remains in the first paint.
  Googlebot runs that script.

Those costs are accepted. Deleting `loading.tsx` to restore a real 404 brings back the blocked
click these routes exist to avoid. CMS pages, client pages and wholesale stay gated.

**`app/products/[...slug]` was already un-gated** for the Shopify Admin draft-preview flow, which
another team owns: above a boundary a draft and a missing product are the SAME null
`getCachedProduct`, and the preview key that separates them lives in `searchParams`. Recorded in
`docs/tickets/products-flat-url-soft-404.md`. Its `loading.tsx` is the product skeleton; it does
not change that preview gap.

`app/not-found-status.test.ts` covers condition 3 by LOADING each route module and calling
`generateStaticParams` (with the SDK offline, which is the branch that matters), and conditions
1 and 2 structurally, because neither the gate's position relative to the boundary nor the
presence of a `loading.tsx`/root-layout boundary has any form observable at module scope. It
also pins `instant === false` per route — as the DECLARATION above, not as a status-code
condition. `e2e/not-found-status.spec.ts` asserts the actual status over HTTP, in BOTH
directions — a gate that 404s a route family's REAL pages is worse than the bug it replaced.
**No unit test that merely CALLS a page function can observe any of this**: it throws
`NEXT_HTTP_ERROR_FALLBACK` under every arrangement, so such a test is green under all of them.

**The cost is stated, not hidden.** Each gated route forfeits its static App Shell skeleton:
TTFB now waits on one `"use cache"` read (warm: memory) instead of painting a skeleton first.
Accepted — a 200 on every missing URL of every store is the larger cost. What the gate's read
resolves is then RENDERED, not re-read behind a boundary: the post and PDP routes hand it
straight to the page composition (next section), so the gate is also the page's data read.

### Cached content renders OUTSIDE the boundary, or it is hidden with JavaScript off

With JavaScript off a shopper (and any crawler that does not run scripts) sees only what
sits BEFORE the first `<div hidden id="S:…">` in the HTML. Under Cache Components TWO
things put content after it, and closing one without the other changes nothing:

- **A boundary whose subtree performs a request-time read** (`searchParams`, `cookies()`,
  `headers()`, `connection()`, an uncached read) is POSTPONED at prerender: the static file
  holds its fallback and not one byte of content. Without a boundary that read turns the
  whole route dynamic (`ƒ`, 0-byte shell) instead of failing the build — measured on a
  Next 16.3 production build, 2026-09-10, on `/shop/[...slug]`.
- **A COMPLETED boundary larger than React's `progressiveChunkSize` (12 800 bytes)** is
  outlined by Fizz (`flushSegment`, `isEligibleForOutlining` in
  `next/dist/compiled/react-dom`) into a hidden segment plus an inline `$RC` swap, even in a
  prerendered file where every read was cached. So a whole article or product inside ANY
  `<Suspense>` is invisible with JavaScript off. Measured the same day: the post route had
  no request-time read at all, yet 124 visible characters in the shell with its boundary
  and the entire article in `S:3`; 411 with the boundary removed and nothing hidden.

So a boundary belongs NEXT TO a request-time read and nowhere else; cached content renders
in the route itself. `app/news/[...slug]` has no boundary. `app/brand` (the index) had one
around a fully cached brand grid and nothing else: measured on the deployed rehearsal store,
2026-10-01, all of its cards sat after `<div hidden id="S:0">` at byte 49,458 of 183,930, and
a local production build of the same page reported 139 visible shell characters against 471
in the tail. With the boundary removed the same page reports no hidden segment at all. That
route is also the worked example of the second emitter rule above, so a change there is two
rules at once. Both PDP routes compose the
product the gate resolved through `ProductPageBody` outside any boundary; the flat
`/products/[...slug]` keeps ONE boundary, around `ProductPageContent`, and renders it only
when the public read returned null — the one branch that must await `searchParams` (the
Shopify preview key). `ProductStock` reads the same cached product entry (freshness is the
theme's `headkit:product:<slug>` purge), so it is inline too. The `/shop` category branch
keeps its boundary because `CollectionRoute` reads `searchParams` for its grid.

Measure, do not infer: `bun run scripts/static-shell-split.ts <.next/server/app/….html | url>`
prints the split, the visible characters on each side, and every hidden segment. The route
tests (`app/products/[...slug]/page.composition.test.tsx`, `app/shop/[...slug]/page.composition.test.tsx`,
`app/news/[...slug]/page.test.tsx`) pin the element tree that decides it. The same rule
reached one shared component: `ProductCarousel` used to wrap itself in an inert
`<Suspense fallback={null}>`, which put every related / upsell / editorial carousel's tiles
in the tail; it no longer does. React also outlines a boundary in the shell that contains
an eager `<img>` (`hasSuspenseyContent`), so a gallery or carousel that must be JS-off
visible gets no boundary of its own.

### A merchant CLAIM in JSON-LD is never defaulted, and the starter makes none

`OrganizationJsonLD` accepts `telephone`, `email`, `hasMerchantReturnPolicy` and
`hasShippingService`, and `app/layout.tsx` passes none of them. These are public promises to
a shopper and to Google, so a caller either has a real source — the merchant's own returns
and shipping pages — or omits the prop; the component emits no key at all rather than an
empty or invented one. A store that adds them should record, per property, where the value
came from AND which claims on its pages it deliberately did NOT mark up, because that second
list is what stops the next person inventing a property to fill a gap. Typical gaps: a
free-delivery threshold scoped to "capital cities and metro areas", which no `DefinedRegion`
can state; a dispatch cut-off time, whose `handlingTime.cutoffTime` takes a fixed UTC offset
and so is wrong for half the year anywhere that observes DST; and `returnFees:
ReturnShippingFees`, which obliges a non-zero `returnShippingFeesAmount`.

Two shape facts worth not re-deriving: organization-level shipping is `hasShippingService` /
`ShippingService` / `ShippingConditions` (`Offer.shippingDetails` on an `Organization` is an
unknown field at validator.schema.org), and `MerchantReturnPolicy` nests directly under
`Organization`.

`/shop` emits its `BreadcrumbList` from `SHOP_BREADCRUMBS`, the same array its visible
breadcrumb renders, outside the route's Suspense boundary so a crawler running no JavaScript
sees it — the rule `/collections/[...slug]` already follows. Neither guard
(`app/shop/page.breadcrumb.test.tsx`, `components/seo/organization-json-ld-claims.test.tsx`)
can see the served HTML; that is an HTTP read.

### The sitemap can stop advertising thin facet URLs, and by default does not

`lib/facet-sitemap-thresholds.ts` lets a store drop `/collections/<cat>/f/<facet>` URLs
whose product count is below a bar, PER FACET TYPE. Both bars default to `0` — advertise
everything — because the numbers that make a cut worthwhile belong to one catalogue, not to
the platform. A store opts in with `HEADKIT_SITEMAP_MIN_COLOUR_FACET_PRODUCTS` and
`HEADKIT_SITEMAP_MIN_BRAND_FACET_PRODUCTS` (`lib/env.ts`), and must set them separately: on
the store this was measured on, colour sat 80.2 % at exactly one product (the slugs are
per-model paint names) and took a bar of 3, while brand was only 28.1 % at one product
(`specialized helmets` is a real search intent) and took 2. Collapsing them to one number
either re-adds hundreds of dead colour URLs or deletes live brand ones.

Three properties are load-bearing whatever the bars are set to. `ProductFilterOption.count`
is already in the `getFilters` payload the emitter reads, so the cut adds **no origin read
and no cache tag**. An ABSENT count KEEPS the URL — "this facet holds one product" and "this
backend does not report counts" are opposite situations, and only an observed count may drop
anything. And the brand bar is applied to `brandSlugsPerCategory`'s RESULT, never its input,
or an all-singleton store would empty every category and flip the global-brand fallback back
on. This narrows ADVERTISING only: a dropped URL still routes and still answers 200. A change
to either value reaches production by REDEPLOY, not by a tag purge.

### A request-time read in the ROOT layout costs every route its static shell

`app/layout.tsx` performs NO request-time read. A `<Suspense>` there is fine on its own —
the one around the customer's `<BelowMain />` override slot costs nothing, because its child
is cached — but a request-time read INSIDE one postpones a dynamic hole in every route in
the application, so no response can be served as a finished file: each is produced by a
runtime React resume that re-emits flight rows and inflates the payload.

Measured on a deployed probe, three deployments differing only in the root layout, same
region and hour (Bike Society, report `260915-bs-click-latency-scout` §4.2): no boundary →
6 ms body on a 27 KB page and 70 ms on a 236 KB one; `<Suspense>` + a CACHED child →
6 ms / 79 ms; `<Suspense>` + `await connection()` → **1,419 ms / 2,378 ms and +44–68 %
bytes**. The middle row is what makes the attribution exact: the boundary is free, the read
inside it is not.

The read that used to be there was `DynamicMetadataMarker` (`await connection()`), and it
existed so `generateMetadata` could decide the `robots` meta from the request Host — under
Cache Components a `generateMetadata` that reads runtime data is a build error unless the
route has a dynamic hole, and that marker was the hole for every route at once. The signal
rides a response header instead:

- **`lib/host-robots.ts`** is the decision, called from `proxy.ts`, which already read the
  request host for the maintenance gate. A host that is not the store's declared production
  host gets `X-Robots-Tag: noindex, nofollow`; the store's own host gets no header. It uses
  the same `isIndexableHost` predicate the metadata gate used, so a rehearsal at
  `*.headkit.app` stays closed and the customer's live host stays open.
- **`resolveRobots` keeps the STORE switch only** (`allowIndexing`) and is now synchronous
  and origin-free. That arm is a cached per-store value, so it costs no hole. The two
  signals can never contradict — neither emits `index` as an override, and Google resolves
  conflicting robots rules by applying the more restrictive one.
- **The origin the header is judged against is the RUNTIME store domain first**, the baked
  env only as a fallback, resolved exactly as `app/robots.ts` resolves it. That order is the
  difference between a correct cutover and deindexing the customer: dashboard-api updates
  Mongo `Store.domain` when a custom domain is attached but has historically not redeployed,
  so a build-time-only read would judge the new live host against the OLD rehearsal origin.
  It reaches the proxy through `/api/posts-base-path`, which the proxy already fetched once
  per page request — that endpoint now carries `siteUrl` beside `base`, the fetch is hoisted
  into `proxy()`, and the blog rewrite takes the base as a parameter. A second endpoint
  would be a second subrequest on every page request for one short string.
- **`app/robots.ts` keeps its own in-process host read** (`lib/indexing-decision.ts`).

One class carries no header: `proxy.ts`'s matcher excludes any path containing a dot, so a
path-encoded facet URL (`/collections/locks/f/colour.black`) never reaches the proxy. It is
not an exposure the meta covered either — a non-indexable host answers `Disallow: /`, so a
compliant crawler fetches neither the page nor its head. Widening the matcher would newly
subject those URLs to the maintenance gate too, which is a separate decision.

`app/products/[...slug]` is the ONE route that still mounts the marker: its
`generateMetadata` awaits `searchParams` for the Shopify Admin preview key and it prerenders
real products with no boundary of its own. Mount it as a SIBLING of the content, never a
wrapper. Before adding a second caller, check whether the route already has a dynamic hole
inside a `<Suspense>` — one is enough for the whole route, which is why `/search` needs none.

Guards, and where each stops. `app/not-found-status.test.ts` now carries two assertions
about this file: no boundary left open across `{children}` (the redirect rule) and no
request-time read at all (this one) — a SOURCE scan of `app/layout.tsx` only, which does not
follow into the customer-owned `overrides/layout-slots.tsx` slots, where a store can add the
same cost invisibly. `app/generate-metadata-cached-reads.test.ts` fails in 200 ms on a direct
provider call inside any `generateMetadata` rather than after a 25-minute build; it is a
source scan with three blind spots stated in the file. `lib/host-robots.test.ts` covers the
host decision AND composes it with the store switch, because a test of either half alone
passes while the other is broken. No unit test can see a response header on a real request —
`e2e/store-parity.spec.ts` reads it over HTTP for both host classes.

Removing the marker exposed a pre-existing uncached read it had been masking:
`app/collections/[...slug]`'s brand-facet `generateMetadata` called `sdk.brands.list()`
directly, which on a real store was 189 failed prerenders, all `/collections/**/f/brand.*`.
It reads `getCachedProductBrand` now — the entry the PDP already uses, tagged per brand —
which also lifts the `perPage: 100` ceiling that used to render a brand past the 100th as
its slug.

### The footer ships NO social links, and that is the fix

`app/layout.tsx` is a template file: a literal here reaches every merchant's footer, and a
template sync replaces a store's copy wholesale. It used to hard-code the VENDOR's own
Instagram/Discord/GitHub/LinkedIn/YouTube, so every storefront advertised them — and when one
store forked those lines to its own accounts, with a warning comment saying the fork would be
lost, the next sync silently republished the vendor's five on a live customer storefront.
`Footer` gates the whole Connect block on `hasSocialLinks`, so passing no prop makes the block
ABSENT, not empty. `app/layout-social-links.test.tsx` guards it as a chain — it RENDERS
`Footer` with and without links to prove the block is absent rather than empty, and it invokes
`RootLayout` to read the props it actually passes, because either half alone passes the bug. A
store adds its own by forking this one line.

Making that per-store DATA rather than a fork is an OPEN DECISION with no ticket behind it —
`store-social-links-platform-field` is a name to hold the decision by, not an id. The scope it
would span, and why leaving it open is safe, are stated once where the prop is absent, in
`app/layout.tsx`.

### Form controls are ONE surface, and checkout is what "correct" means

`components/ui/form-control-surface.ts` is the only place a form control's
colour, radius or state lives; `Input`, `Textarea`, `SelectTrigger`, `Checkbox`
and `RadioGroupItem` compose it and add sizing only. The module header carries
the full reasoning and the measurements — read it before changing any of them.
Four things are worth knowing before you go looking:

- **The reference is CHECKOUT, and checkout is Stripe.** Checkout's fields are
  Stripe Elements styled by `lib/stripe-appearance.ts`, which reads
  `--color-primary` and `--radius` off `:root`. The shared surface is not a new
  palette — it is the same tokens expressed as Tailwind utilities, so the two
  agree by construction. Change one side's geometry or type ramp and you change
  the other (`SITE_TYPE.inputFontSize*` mirrors `text-base md:text-sm`).
- **No literal colour, ever, in this template.** `apps/starter` is the template
  every customer store is generated from, so a hex pins every store to one
  brand; the utilities name the tokens `app/layout.tsx` overrides per store from
  dashboard branding. `form-control-surface.test.tsx` refuses a hex in any of
  the five controls.
- **A hand-rolled `<input>` is the defect, not a shortcut.** Four
  implementations were live at once — these components, checkout's own steps, the
  account/auth pages, and Stripe — and only Stripe was branded. The same guard
  fails at SOURCE level if any of the eight former call sites re-inlines one.
- **`dark:` on a form control is not dead.** `apps/starter` declares no
  `@custom-variant dark` (the directive appears nowhere in the repo), so
  Tailwind v4 compiles those under `@media (prefers-color-scheme: dark)` — live
  for any visitor whose OS is dark, even though nothing puts a `dark` class on
  `<html>`. Four of the five properties the old overrides touched would have
  beaten the branded base on source order; only `border-primary` survives, and
  only because `app/globals.css` hand-writes a SECOND copy of it in
  `@layer utilities` after the dark block. Measured byte offsets are in the
  module header. The guard refuses any `dark:` on these five.

Known gap, deliberately not closed: the HTML controls' invalid edge is
`red-500`, matching the error TEXT `FormMessage` already renders, while Stripe's
is the `#E01577` `danger` literal in `stripe-appearance.ts`'s `FALLBACKS`. There
is no `--color-danger` token to unify them, and one was not invented here.
`form.tsx` also still carries `dark:text-red-900` on the error text, so under a
dark OS the sentence moves while the field edge does not — same missing token.

Out of scope on purpose, and still neutral: the quantity stepper
(`components/headkit-ui/quantity-stepper.tsx` and the copy inside
`product-detail.tsx`) is a composite segmented control whose grey frame is the
widget, not a field edge; the three facet checkboxes
(`collection/{attribute,brand,category}-filter.tsx`) are `sr-only` by design;
the carousel scrollbars are `type="range"`. `command.tsx`, `popover.tsx`,
`toast.tsx`, `scroll-area.tsx` and `form.tsx` still carry live `dark:`
variants — same mechanism, wider blast radius, not this surface.

### A guard must state the domain it actually exercises — and where it stops

A test name, an assertion message and a "this proves X" comment are documentation, and the
whole point of a guard is that people stop looking once they see it. So a guard that claims
more than it checks is worse than no guard: it converts an unexamined gap into a believed
guarantee. When you write or edit one, say in the same breath what it covers AND what it does
not — which surfaces, which files, which store class, which layer.

The evidence for the bar is local and repeated. On the canonical-URL work alone: an
`existsSync` check stood in for "no `loading.tsx` exists" while proving only that a path was
absent from one directory; a sweep asserting "no route family emits the flat shape" twice
shipped green without covering the e2e specs at all (and CI's own `E2E_TEST_IGNORE` list —
`gift-card`, `forms-gravity`, `product-addons`, `store-parity` — hides four of those from every
run, more when no Stripe test key is configured); a wiring proof drove a leaf component with
hand-passed props while the prop-threading it existed to cover had none; and a cache-tag
guard was named for "the PDP route" while exercising one of the two routes that serve a PDP.
Same failure each time, in five costumes.

### Maintenance mode is a request-time Edge Config read, keyed per host

The storefront can be put dark and lifted in one Edge Config write with no redeploy
(cutover gate G6). Mechanism, keys, exemptions and the exact lift command live in
`MAINTENANCE.md`; the gate itself is `lib/maintenance.ts`, called first in `proxy.ts`.
Three things about it are not derivable from the code and get people into trouble:

- **The connection-string variable is `GLOBAL_CONFIG`, not `EDGE_CONFIG`.** Vercel renamed the
  product, and reading the old name leaves the gate taking the unarmed branch on every request
  forever — silently, with the storefront serving normally and nothing reporting it. The gate
  accepts both and resolves them in one place. The wider lesson, which cost a defect here and a
  no-op `revalidateTag` the same day: treat "the code says it should work" as unproven until a
  deployment says otherwise, and check the variable NAMES a platform actually injects rather than
  the ones its SDK documents.
- **The Edge Config store is TEAM-level and connected to every storefront project**, so the
  flag can never be a root boolean — that would be a fleet-wide kill switch. The key is
  derived from the request host (`maintenance_www_dishee_com_au`). Same reason the fail
  path is not a flat fail-closed: read failures only darken hosts already known to be dark,
  or one Edge Config incident takes the whole fleet down.
- **`consistentRead: true` is load-bearing**, not a default worth tidying away. Without it
  the SDK prefers a deploy-embedded snapshot of the config, and a gate whose entire purpose
  is a sharp `T+0` cannot read a snapshot.
- **It is a sign, not a fence.** It cannot stop checkouts; the fence is the WooCommerce
  gateway option write. Do not extend this gate into claiming otherwise.

Prove changes to it with `bun run test:smoke:maintenance` — a production build plus a live
flip. A unit test cannot make the claim that matters ("no redeploy").

### A content body that hands `processHomepageContent` `[]` re-reads every carousel product per request

`editorBlocks[].products` in a `GetContent` / homepage payload IS the product carousel's
data (the theme hydrates posts exactly as pages). `BlockEditor` falls back to an HTML scan
plus one product read per product only when a block carries no products — so a body that
passes `[]` instead of the payload's blocks turns a cached read into N paced origin reads
on every request: a six-carousel post measured 14 s → 1.0 s once the blocks were threaded
(`data/260908-bs-posts-page-latency/report.md`). `PostBody`, `CmsPageBody` and
`app/page.tsx` all thread them; a new surface must too. The fallback itself reads through
`getCachedProduct` (the PDP entry) — never a bare `headkit.products.get` — and the
shared Posts-page read is `getPostsLanding` in `lib/posts-base-path.ts`, not an inline
`sdk.posts.getLanding()`. `components/headkit-ui/post/post-body.test.tsx` asserts the
zero-read path; extend it rather than adding a mock of the decision.

### Request-time metadata costs the function resume, not cache lookups

Written when every route's `generateMetadata` was request-time by design (the `robots` meta
read the request Host, and `components/seo/dynamic-metadata-marker.tsx` was the hole that
made that legal). The host arm has since moved to a response header and the marker is gone
from the root layout, so the tail described here is no longer paid site-wide — but the
measurements stand, and they are the reason NOT to spend a change moving `use cache` reads
out of a `generateMetadata` that still has a hole. It reads `getBranding()` /
`getBrandingAssets()` — two `"use cache: remote"` entries. It is tempting to read the per-request tail on a CDN HIT as "two Runtime Cache
round trips" and to try to move those reads out of metadata. MEASURED, it is not:

- The prerender's postponed state carries the **Resume Data Cache** — every `use cache`
  entry the prerender read, `remote` ones included (`next/dist/server/resume-data-cache/`
  serialises all kinds; only `revalidate: 0` / short-`expire` entries are dropped). On a
  resume the platform POSTs that state back to the function (`x-nextjs-resume`,
  `base-server.js`) and `use cache` reads it BEFORE any cache handler. A counting
  `cacheHandlers` wrapper on a Next 16.3 production build (2026-09-10, PR #470) saw **0
  handler `get`s per warm request** on `/`, a CMS page, a post, a collection, a nested
  PDP, `/brand` and `/brand/{slug}` — for these two keys and for every other layout
  read. Both keys were present in every route's postponed state (decode a
  `.next/server/app/<route>.meta` `postponed` string: `<len>:<state><base64 deflate>`).
- Within one request the layout body reads the same keys, and `use cache` de-duplicates
  identical in-flight invocations (`pendingCacheInvocations` in `use-cache-wrapper.js`),
  so metadata could never add a lookup the body did not already pay.
- What the tail IS: one function invocation per HIT that re-renders the RSC tree from the
  postponed state and streams the holes — metadata, the marker, and the route's other
  holes (locally 4 on home/CMS/post, 5 on a collection, 6 on a PDP: product grids and
  carousels, `ProductStock`, the `searchParams` grid — counted BEFORE the post and PDP
  routes moved their cached content out of the boundary; see "Cached content renders
  OUTSIDE the boundary"). The only per-request cache lookups measured were outside
  metadata: the `searchParams`-keyed catalogue page on collection and brand routes, and
  the Stripe config read on a PDP.

So do not spend a change on taking `use cache` reads out of `generateMetadata`; it makes the
code harder to read and the tail no shorter. A `generateMetadata` result is also
indivisible — wholly prerenderable or wholly deferred (Next 16.3 bundled docs,
`generate-metadata.md`, "With Cache Components") — so a host-dependent `robots` key keeps
`<title>`, canonical and OG out of the static shell as well. Two shapes that would change
that were evaluated for PR #470 and REJECTED, and lever 2 of the scout report was closed as a
false premise (captain, 2026-09-10). Neither is a refactor; both alter what a non-indexable
host emits:

- **A rendered `<meta name="robots">` from the marker's hole, with `generateMetadata`
  static.** Puts `<title>`, canonical and OG into the shell but shortens nothing — the
  function still runs for the hole — and a rehearsal host then carries TWO robots metas,
  `index, follow` from the shell beside `noindex, nofollow` from the hole. Google applies
  the more restrictive rule, but `e2e/port-verify` deliberately reports a duplicate robots
  meta as a finding and `e2e/not-found-status.spec.ts` asserts at most one on a 404.
  Dropping the explicit `index, follow` instead leaves the live host with no robots meta.
- **An `X-Robots-Tag` header from `proxy.ts`, marker removed.** This is the shape that was
  TAKEN, and the paragraph above is why it needed its own decision rather than being folded
  into a metadata change: the HTML robots tag stops being host-dependent, the header becomes
  the host signal, and the ENG-868 / ENG-876 agreement then has to be asserted across two
  signals instead of one. It is, in `app/seo-robots-sitemap.test.ts`. What tipped it was the
  root-layout measurement, which is a different and much larger number than the metadata
  tail this section is about — see "A request-time read in the ROOT layout costs every route
  its static shell" below. The route still needs a function for its other holes; what it no
  longer needs is one on EVERY route.

### A WordPress mega-menu column is a `hidden` Custom Link, not a link

Themes have no column primitive, so a merchant expresses one as a destination-less
Custom Link (URI collapses to `/`) carrying the CSS class `hidden`, with the real
links as its children. Its label ("Column 1"…) is scaffolding: `lib/menu-columns.ts`
turns each container into ONE mega-menu column, gives every non-container sibling a
column of its own, drops a column that would be empty, and splices containers away at
every depth for flat surfaces (the mobile sheet). Never key this on the label or on
"URI is `/`" — the class is the merchant's own convention, and both alternatives were
measured wrong in `data/260910-bikesociety-full-gap-scout/report.md` §3.3.

The same WordPress menu usually still feeds the store's LIVE v1 site, which depends on
those containers for its layout, so deleting them in WordPress is not a fix available
before cutover. `lib/hide-empty-collections.ts` drops a container left with no
surviving children; without that the container outlives its own links (a container's
URI yields no collection slug, so nothing else can drop it).

**The menu query carries FOUR levels** (`NavigationMenuFields` in
`packages/sdk/src/operations/navigation.graphql`), because a container spends one of
them on layout. Commerce builds the tree to arbitrary depth from `parentId`, so depth
is an SDK-query question only. Both renderers recurse (`MegaMenuChild`,
`MobileMenuBranch`), so a deeper menu needs one more `children` in that fragment and no
component change.

**A dropdown parent renders as a `<button>`, never a link.** Radix's own trigger, no
`asChild`: a parent whose URI is `/` used to send a shopper home on the way to the
panel. A real destination is not lost — `MegaMenu`'s `viewAll` renders it as the
panel's first entry.

### The `breadcrumbs` prop on PDP/brand/collection headers used to be dead — collection now renders it

`ProductDetail`, `brand-header.tsx` and `CollectionHeader` all accept a `breadcrumbItems`/
`breadcrumbs` prop of `{ name, uri, current }[]`, and every route already computes it correctly
(PDP: `productCategorySegments` + `collectionPathFromCategory`; collection:
`buildBreadcrumbFromCategory` in `components/headkit-ui/collection/utils.ts`) and feeds the
identical data to `BreadcrumbJsonLD`. Before 2026-09-11 none of the three actually rendered a
visual trail — the prop was accepted and the doc comment said so ("kept for callers / agent
reference — not rendered on the storefront"), so only the JSON-LD `<script>` existed and no
shopper ever saw a breadcrumb. `CollectionHeader` now renders it (`components/ui/breadcrumb.tsx`'s
`Breadcrumb` — the one styled `Home > Shop > …`) above the `<h1>`, gated on
`breadcrumbs?.length > 0` so an omitted prop renders exactly as before. PDP and brand headers were
left alone — the 2026-09-11 decision scoped this to collection pages only (`plp-breadcrumb-owner`);
if a future task extends it there, reuse the same `Breadcrumb` component and the same gate, not a
new implementation.

### A cache tag's purge SEMANTIC follows its carriers, not its name

`/api/revalidate` no longer purges every allowlisted tag the same way. `invalidatesManyPages`
(`lib/cache-tags.ts`) splits the contract vocabulary in two and the route sends each half to a
different call:

- **wide** — whole catalogue (`headkit:products`, `headkit:catalog*`), whole route family
  (`headkit:route:*`), the brand-TERM tag (`headkit:brands`) and the five layout-chrome tags →
  `invalidateByTag` from `@vercel/functions`. The CDN keeps serving the existing copy and
  refreshes behind the request.
- **narrow** — the singular entity tags and the small type indexes → `revalidateTag(t,
{ expire: 0 })`, unchanged. A deletion, which is what the editor reloading the one page they
  just saved wants.

Three things about it are load-bearing and easy to undo by accident:

- **A tag is wide because of what CARRIES it.** `headkit:branding` names one CMS setting and
  sounds editor-facing, but `app/layout.tsx` awaits `getBranding()`, and under Cache Components
  a tag declared in a nested cached read propagates outward onto the awaiting route's entry — so
  it sits on every CDN entry in the storefront, a larger reach than `headkit:products`.
  `ROOT_LAYOUT_CHROME_TAGS` names the five, and `lib/root-layout-chrome-tags.test.ts` derives
  the set from `app/layout.tsx` and its carrier modules rather than trusting the list, so a
  SIXTH root-layout read fails CI until it is classified.
- **`revalidatePath` is an unconditional DELETE and beats an invalidate regardless of
  ordering.** WordPress sends paths beside tags, so purging a wide tag and then deleting the
  same page by path one line later makes the change inert while the log still says the
  invalidate fired. `tagCoveringPath` skips a path a tag in the SAME payload already covers —
  against the FILTERED tag list, because a dropped tag purged nothing and so covers nothing —
  and an uncovered path is always still purged.
- **The failure mode is biased towards slow, never wrong.** `invalidateByTag` resolves silently
  when the runtime handed the invocation no purge API, so `lib/vercel-purge.ts` probes the
  request-context symbol itself; with no purge API, or on a rejected call, the wide class falls
  back to deletion. That probe is also what keeps the whole path inert off Vercel. `purgeApi`,
  `purgeFallback`, `outcomes` and `skippedPaths` are in the log line and `purgeApi` in
  `GET /api/revalidate`, because "the purge landed" must be readable rather than assumed.

`lib/product-brand.ts` is the one read whose tag moved with this: the PDP brand logo subscribes
to `headkit:brands` (the term tag, fired only by a brand term create/edit/delete) and not
`headkit:brand:{slug}` (the product-SET tag, fired by every stock movement in the brand). That
pairing is why `headkit:brands` must stay wide — see the note in that file.

### Stripe.js loads through the `/pure` entry, and only on demand

`@stripe/stripe-js`'s default entry injects the Stripe.js `<script>` as a side
effect of module import, so a single value-level import anywhere in the client
graph puts it on every route that reaches it — defeating the BNPL badge's own
`IntersectionObserver` gate and the store setting that hides the badge.
`lib/stripe-js-singleton.ts` imports `@stripe/stripe-js/pure` instead, which
does not, and `lib/stripe-js-singleton.test.ts` sweeps `app`, `components`,
`lib` and `hooks` to keep it that way. `import type` from the root entry is fine
and is used widely; that sweep is source text only, and says so.

Stripe's advanced fraud signals stay **on** — Stripe's own default, and what
every store gets today. A store opts out with
`NEXT_PUBLIC_STRIPE_ADVANCED_FRAUD_SIGNALS="false"`, applied once immediately
before the first `loadStripe`. The ordering is load-bearing (`setLoadParameters`
throws after `loadStripe` has run) and the setting is DOCUMENT-WIDE: both Stripe
entries share one DOM, so a client-side navigation from a product page carries
it into checkout. Stripe states the cost, which is why it is per-merchant and
never a platform default.

### Zod is imported as a NAMESPACE, and an error-level rule keeps it that way

`import { z } from "zod"` retains zod's entire `external.js` namespace object — every locale
and the JSON-Schema processors — in the client bundle, because a bundler cannot prove which
members of a namespace VALUE are read. `import * as z from "zod"` restores per-member
reachability, and the two are interchangeable at every call site. ONE named import anywhere in
the client graph pulls it all back, since every zod consumer lands in the same shared chunk.
`eslint.config.mjs` enforces it with `no-restricted-syntax` at `error` (a `warn` would not gate:
`lint` runs `--max-warnings 999`), and `lib/zod-import-shape.test.ts` asserts the same property
over `app`/`components`/`lib`/`hooks`. Neither covers a deep import (`zod/v4/...`) or `zod/mini`.

### `aria-hidden` on a container that holds links needs `inert` beside it

`aria-hidden` plus `pointer-events-none` stops the mouse and hides the subtree from assistive
tech, but leaves every link and button in it focusable — the contradiction Lighthouse reports as
`aria-hidden-focus`. Drive `inert` off the SAME expression `aria-hidden` uses so the two cannot
drift (`components/headkit-ui/carousel.tsx`'s fade slides are the worked example). `inert` over a
`tabIndex={-1}` sweep because it takes the whole subtree out of the focus order and the
accessibility tree at once. Browser floor is Next's own `MODERN_BROWSERSLIST_TARGET`
(chrome/edge/firefox 111, safari 16.4); `inert` landed in Firefox 112, one version above that
floor, where the attribute is ignored and the node behaves exactly as it does today.

### A tap target lives on the LINK, and `VariantSwatch` is not it on a card

A `<button>` inside an `<a>` is invalid HTML and axe scores the pair as TWO `target-size` failures
with "0 px of safe clickable space". On a product card the colourway link is the sole interactive
element and carries the 24x24 target; `components/headkit-ui/swatch-dot.tsx` draws the 16 px dot
inside it as a `<span>` with no handler and no hook. `VariantSwatch` stays the PDP's control,
where the button IS the target — the two files must keep the same LOOK at the small size, so a
change to one is a change to both. How many dots show before the "+N" chip is
`catalog.maxCardSwatches` in `overrides/theme.json` (default 10); the target size is not
configurable.

### Every fixed-bottom surface offsets by the consent banner's published height

Two `position: fixed` surfaces pinned to the bottom edge overlap, and raising one's `z-index`
alone just swaps which is hidden. The banner publishes its measured height as a `:root` custom
property and each consumer lifts itself with one `calc()` — `lib/consent-banner-offset.ts` owns
the property, the reasoning, and the two shapes that were rejected (a React store every consumer
would have to subscribe to; padding the document, which reintroduces the layout shift
`position: fixed` avoids). Consumers TRANSLATE rather than re-place themselves: a fixed element
that moves by its `bottom` is a layout-shift source like any other. The property is ABSENT, not
`0px`, when no banner is up, so every `var(…, 0px)` fallback makes the no-banner case byte-for-byte
what it was. Current consumers: the PDP sticky add-to-cart bar and the toast viewport.

### Empty WordPress placeholder pages are one list, read by two files

WooCommerce keeps real page nodes for `cart` and `my-account` even in a headless store, and
`app/[...slug]` rendered them as a 200 with an H1 and no body. `lib/cms-placeholder-pages.ts` is
the single list the catch-all gate and `app/sitemap.ts`'s page discovery both read, so a slug that
404s can never also be advertised. Slugs are BARE and matched EXACTLY, never as a prefix. The
platform default carries only what WooCommerce publishes empty on every store; a store's own empty
parent page (a `legal` or `policies` node whose children are real) goes in `overrides/theme.json`
under `cms.placeholderNotFound` / `cms.placeholderRedirects`, which ADD to the defaults.

### The PDP availability line resolves on the server

`components/headkit-ui/availability-status.tsx` derives its status synchronously from its props.
It used to seed `useState` with `IN_STOCK` and correct it in an effect, so the server render and
the first client paint said "In Stock" for every product, an out-of-stock one included. Both
predicates are pure functions of the props and need no browser; `resolveAvailability` is exported
so the rule is testable without a render.

**It resolves from the SELECTED variation, and the server slot is for SIMPLE products only.**
`components/headkit-ui/product-stock.tsx` is the prerendered slot, and it resolves stock from the
COLOURWAY IN THE URL alone — the first variation in payload order carrying that colour, of
whatever size. Payload order is not display order, so on a product with a size axis it named a
different variation than the Add to Bag button (`selectedVariation`, the full attribute match) and
the page rendered both answers ~40px apart: a green "In Stock" line above an "Out of stock"
button, on one size click. `useServerStock` (`product-detail.tsx`) therefore carries
`!isVariable`; a variable product renders `<AvailabilityStatus>` from the selected variation, the
same source as the button and every other stock-bearing element. Do not widen that condition to
"restore" the slot — add the size axis to the slot, or delete it.

Three things hold it up, and the last is the one a refactor loses:

- `product-detail.stock-agreement.test.tsx` (jsdom) pins the AGREEMENT across a size click, not
  the copy, and passes a recognisable `stockSlot` so a test that forgets one cannot be green
  under the bug.
- `e2e/pdp-variants.spec.ts` P1-18b is the only layer that sees the real shell and real
  hydration together. It needs `stock-mix-tee`
  (`docker/wordpress/seed-variation-stock.php`) — every other variable fixture is instock on
  every variation, and `folding-bike` is SIMPLE, so neither can reach the state.
- **The static shell is unchanged, and that is a property of the SEED, not luck**:
  `selectedAttributes` is seeded on the server from the first variation matching `initialColor`
  — the same variation the slot picks — so the prerendered line is byte-identical.
  `product-detail.stock-shell-parity.test.tsx` renders both and compares them, which is the only
  cheap signal if either resolver moves. Measured on a built page: same 247,788 bytes, 0
  boundaries, 0 hidden segments before and after.

### Three navigation-interaction switches, all OFF by default

`lib/nav-interaction-flags.ts` is the ONE place each variable is read and its value
interpreted, and it carries the value table (only an explicit `true`/`1`/`on`/`yes` turns a
switch on; unset, empty and any unrecognised value mean off, so a typo can never hand every
shopper new behaviour). Do not read `process.env.NEXT_PUBLIC_NAV_*` anywhere else — Next inlines
a public variable only where the name appears verbatim, which is why the reads live there and
the declarations live in `lib/env.ts`.

- **`NEXT_PUBLIC_NAV_PREFETCH_BUDGET`** — one switch, two spellings that must agree.
  `InstantLink`'s `resolvePrefetch` stops defaulting `prefetch` to `true`, and `next.config.ts`
  sets `partialPrefetching: true` from the same variable; partial prefetching is what makes an
  unset `prefetch` cheap, so a build with one half and not the other is a state nobody measured.
  With the budget on the head start is spent explicitly, on the top-level desktop nav
  (`DesktopMenuSection`'s `prefetch` prop) and the first visible row of the page's first product
  carousel (`ProductCarousel`'s `prefetchCount`, wired in `app/page.tsx` and `block-editor.tsx`
  via `firstProductCarouselSegmentIndex`). `prefetch={false}` is not the way to quieten a link —
  that is `'none'` and kills hover/touch prefetch too.
- **`NEXT_PUBLIC_NAV_MOUSEDOWN`** — an in-app link starts its navigation on `mousedown`.
  `mouseDownNavigationRefusal` is the guard, and the five gestures it must never hijack
  (middle-click, cmd/ctrl-click, shift-click, right-click, alt-click) are why it returns a reason
  rather than a boolean. The navigation is started by dispatching a click on the anchor, never by
  `useRouter().push()`, so `replace`/`scroll`/`onNavigate`/`useLinkStatus` and any injected
  `onClick` behave as they do on a real click, and the component stays renderable with no
  app-router context.
- **`NEXT_PUBLIC_NAVIGATION_SKELETON`** — the full-page skeleton for a pending navigation.

### A navigation skeleton is REQUESTED by a gesture and DRAWN by one host

Two raisers, one renderer. `InstantLink` requests from its own event handler, and
`CollectionProvider` requests from a transition that wraps ONLY the filter-path `router.push`.
Neither renders the skeleton and neither withdraws its request: `NavigationSkeletonHost` (mounted
once in `app/layout.tsx`, behind the switch, outside `{children}`) owns the whole lifetime and
ends a request when the route commits, or at a 15 s ceiling.

Three rules hold it together, each of which cost a measured failure on the fork this came from:

- **Request from a handler, never from a render or an effect.** A container that dismisses on
  click unmounts the link ~160 ms after the press, which is before the 400 ms threshold, and the
  superseded render means `useLinkStatus()` never reports `pending` there at all. A function call
  in a handler always runs.
- **Only something that OBSERVED the navigation end may end the request.** An effect cleanup
  cannot tell "the navigation finished" from "my container closed", so there is no release call
  anywhere — see `lib/navigation-skeleton-store.ts`.
- **The host reads `window.location.pathname` inside an effect, never `usePathname()`.** Next
  treats that hook as URL data during prerender and suspends on a route whose params are not
  enumerated; from the root layout there is no boundary to give it, because a boundary there
  re-opens the soft 404 (see "Setting a status code needs THREE conditions").
- **The overlay NEVER covers the header, and that is geometry rather than z-order.** The header
  is a layout element that survives every client navigation, so painting over it is what makes a
  shopper report the header "reloading" on every press — the complaint that produced this rule on
  2026-09-25. Its top is the header's LIVE bottom edge, published as a CSS custom property by
  `NavigationBar`'s existing scroll/resize measurement and read through `lib/header-bottom.ts`;
  never take a second measurement, and never freeze one at mount (that froze strip was the defect
  behind the earlier `top: 0`). The document-level press swallow exempts the marked header region
  for the same reason: a visible, dead header is worse than a hidden one. `z-50` is deliberate —
  dropping below the nav's `z-20` would also drop below the PDP sticky bar (`z-40`) and the
  consent banner (`z-[45]`), which are page content and would then float over the skeleton.

Which body a route gets is decided in ONE place, `lib/navigation-skeleton-target.ts`: a table of
predicates written against the app's own URL builders, plus an opt-out set. A kind a URL cannot
carry is THREADED instead — `"post"` comes from the post cards' `skeleton` prop, because the blog
base is per-store server data. None of this is server-rendered, so no route, `loading.tsx` or
`<Suspense>` is involved and the 404/308 gates are untouched.

### `images.minimumCacheTTL` is env-driven, and there is one escape from it

Unset by default, which means Next's 4 h. `NEXT_IMAGE_MINIMUM_CACHE_TTL` raises it per store.
The effective TTL is `max(minimumCacheTTL, upstream max-age)`, so WordPress-hosted media
(Pressable serves `max-age=31536000`) is unaffected either way; what the key governs is `/public`
assets and dashboard branding on `storage.googleapis.com`. A merchant who swaps a dashboard logo
has NO automatic purge path — the theme's hooks fire Next cache tags, which never reach the image
cache — so the only escape is `vercel cache invalidate --srcimg <path>` (or
`invalidateBySrcImage()` from `@vercel/functions`), and whatever is set here is the worst case
they must otherwise wait out. `next.config.ts` carries the measurements.

### Plain `"use cache"` does not survive a request, so an expensive read inside one re-runs per view

A plain `"use cache"` entry is a per-instance in-memory LRU: on serverless it typically does
not persist across requests. That is harmless for a cheap read and invisible in every cache
header — a route whose shell is prerendered answers `x-vercel-cache: HIT` with a fast TTFB
while the re-read burns in the **streamed tail**, which no header describes. Two rules follow:

- An expensive read reached from a dynamic hole belongs in `"use cache: remote"`. The
  measured case is the store-wide, un-scoped `sdk.collections.getFilters()` payload (~12 s of
  WordPress aggregation on a 2,678-product catalogue): under plain `"use cache"` it made a
  brand PLP click a 14–20 s dead click on every view, while the four sibling landing routes
  made the identical call under `"use cache: remote"` and paid it once per deploy
  (`data/260925-bs-brand-page-cold-latency/report.md` in the firstmate workspace).
- **A store-wide payload does not belong in a scope keyed on something narrower.** Keyed per
  brand it was one entry per brand for one identical payload; keyed on nothing, one entry
  serves every consumer. `getFilters()` in `app/brand/[...slug]/page.tsx`, `app/sale`,
  `app/new`, `app/featured` and `app/shop/page.tsx` are the same scope by construction —
  same directive, same `catalog:filters` tag, no key.

The cost of `cacheLife("max")` under `catalog:filters` is that `isKnownTag`
(`lib/cache-tags.ts`) rejects that tag, so nothing purges the facet options before a
redeploy. That is one staleness class shared by every consumer, not a per-route decision.

### Cache lifetimes and prerender shape are PER-STORE levers, not constants

Three settings decide how stale a storefront may serve and how much of it a build
produces. All three default to what every storefront does today, so a store that sets
nothing is unaffected; moving one is a measured, per-store decision.

- **`HEADKIT_CACHE_PROFILE`** (`lib/cache-profile.ts`). `conservative` (default) keeps each
  cached read's own finite lifetime as the missed-purge backstop. `aggressive` raises those
  same reads to `max`, where a tag purge is the ONLY thing that refreshes an entry — faster,
  and unforgiving of a store whose revalidation webhooks do not arrive
  (`docs/cache-revalidation-contract.md`). A raise-able call site names both lifetimes:
  `cacheLifeForProfile("hours", "max")` instead of `cacheLife("hours")`.
  **A read that decides a status code or an indexability signal must stay finite in both
  profiles** — a cached-empty category at `max` pins a 404, and a cached null in
  `generateMetadata` pins a NOINDEX, either of them until the next deploy.
  `lib/cache-profile-call-sites.test.ts` holds that list and fails if one is raised;
  `getCachedProduct` is the one deliberate exception, and says why at the call site.
- **Collection facet HTML** (`lib/collection-facet-plan.ts`) follows catalogue size, the same way product HTML follows the HeadKit API plan. The build emits the whole indexable facet set or none of it. It does not read `HEADKIT_PRERENDER_COLLECTION_FACETS`, and it does not keep a walk-order prefix. A set that does not fit is served on demand: the collection route's `loading.tsx` paints first, then the page is cached. There is no `HEADKIT_PRERENDER_PRODUCT_LIMIT` and no `HEADKIT_PRERENDER_PRODUCT_COLOURWAYS`.
  An unbuilt URL still routes and still answers 200. The sitemap still advertises the
  catalogue. Colourway URLs share `productColourSlugs` with the sitemap, guarded by
  `app/product-url-emitter-parity.test.ts`.
- **`HEADKIT_STATIC_PAGE_GENERATION_TIMEOUT`** (`lib/prerender-timeout.ts`). Unset by
  default, and then neither key is written. Raise it only for the specific failure it
  addresses — `Filling a cache during prerender timed out` on a route that wraps a wide
  fan-out in one cached entry. The module carries why `experimental.useCacheTimeout` alone
  is inert, how to size the number, and what a larger value costs a genuine hang.

`/sitemap.xml` also carries `s-maxage=3600` from `next.config.ts` `headers()`. That one IS a
platform default, and it is a deliberate hour of blindness: a tag purge drops the cached
entry behind the route, never the CDN copy. `app/sitemap-cache-control.test.ts` pins it.

### One `CollectionProvider` per product set, and the key is what guarantees it

`CollectionProvider` seeds `products` / `totalProducts` / `currentPage` with
`useState(initial…)`, so a re-render with new props does NOT resync them — correct while a
shopper stays on one listing (Load More has appended pages no re-render may wipe) and wrong
the instant the route underneath changes. `collection-page.tsx` settles it:
`collectionInstanceKey` derives a React `key` from the identity-bearing props only
(`categoryBasePath`, `categorySlug`, `brandSlug`, `search`, `onSale`, `isNew`, `initialPage`,
`initialBrands`, `initialFilterValues`) and deliberately EXCLUDES `initialProducts`,
`initialTotal`, `itemsPerPage` and `productFilter` — keying on the content would make a
revalidation of the same URL discard the loaded pages.

The trap is that most listing routes hide the defect. Next keys each dynamic-segment VALUE as
its own subtree, so `/collections/a` → `/collections/b`, `/shop/*` and `/brand/*` remount the
provider unaided. `/search` has no dynamic segment, so `?q=a` → `?q=b` re-rendered the SAME
instance and the grid served the first query's products under the second query's heading and
pagination cursor. Any future listing route that varies by query rather than by segment
inherits exactly that, so do not read the category→category case as evidence the provider is
safe, and do not "simplify" this to a per-route `key` at the mount sites.

`components/headkit-ui/collection/collection-page.route-change.test.tsx` holds it by rendering
the real `CollectionPage` → `CollectionProvider` → `ProductGrid` chain into a DOM and
re-rendering at the same tree position. It covers the same-route re-render ONLY: no router
runs in it, so it cannot see Next's segment keying, the live navigation, or the server read
behind `initialProducts`. It is also this app's only `jsdom` test — the vitest environment
stays `node` and that file opts in with a `@vitest-environment jsdom` docblock. Reach for
jsdom only when the claim is literally about state surviving (or not surviving) a re-render.

One measurement worth not re-deriving: after a client navigation the PREVIOUS listing's DOM
is retained beside the new one, `display:none` on its own `.headkit-collection`, so a naive
`document.querySelectorAll` count doubles with nothing wrong on screen. Scope any DOM
measurement to the VISIBLE grid.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this app.
Do not repeat what the codebase already shows; point to the authoritative file or command
instead. Prefer rewriting or pruning existing entries over appending new ones. When
updating this file, preserve this bar for all agents and keep entries concise.

## Monorepo context

This app lives at `apps/starter/` in the HeadKit platform monorepo. Customer repos are typically a flattened copy of this tree (no `apps/starter/` prefix).
