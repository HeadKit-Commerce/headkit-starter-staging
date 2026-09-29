<p align="center">
  <a href="https://headkit.io">
    <img src="https://storage.googleapis.com/headkit-storage/HeadKit.png" height="96">
  </a>
</p>

<p align="center">
  Build complex headless commerce stores...fast
</p>

# HeadKit Starter

**Reference storefront template** for the HeadKit commerce platform — a production-ready Next.js 16 storefront powered by WooCommerce.

## Prerequisites

- Node.js >= 24
- Bun >= 1.3
- A WooCommerce site with the HeadKit theme installed

The starter runs within the monorepo and requires the GraphQL gateway and commerce services for full functionality. Use `bun run dev` from the monorepo root to start all services together.

## Features

- **Home Page** — Hero carousel, featured products, new arrivals, categories, brands, blog, newsletter
- **Collections** — Infinite scroll, filters (category, brand, attributes, price, stock), sort, breadcrumbs
- **Product Detail** — Variable products with swatch selectors, URL-synced variant params, quantity selector, image gallery with lightbox, tabs (description, additional info, reviews)
- **Cart** — Slide-out drawer, optimistic updates, stock validation, coupon support
- **Checkout** — Multi-step flow (contact, delivery, shipping, payment) with Stripe Checkout Session + Stripe Elements
- **Account** — Login, register, password reset, profile, order history, wishlist
- **Search** — Full-text product search with debounced input
- **Blog / News** — Posts with categories, featured images, block editor content
- **Brands** — Brand listing and detail pages
- **SEO** — JSON-LD (product, breadcrumb, article, FAQ, website, searchbox), sitemap, robots.txt, OpenGraph, Twitter cards
- **CMS** — WordPress block editor integration for custom page content
- **Performance** — Next.js 16.3 Cache Components, `"use cache"` directives, route-level Suspense boundaries, loading skeletons, error boundaries. Instant Navigations (`partialPrefetching` + the prefetch budget), navigation on `mousedown` and the full-page navigation skeleton are per-store opt-ins — see `lib/nav-interaction-flags.ts`

```shellscript
HEADKIT_PRIVATE_KEY
```

## Quick Start

```bash
# From the monorepo root
bun install
cp apps/starter/.env.example apps/starter/.env.local

# Edit .env.local with your HeadKit API keys
bun run dev --filter=starter
```

Open [http://localhost:3000](http://localhost:3000).

## Project Structure

| Directory                | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `app/`                   | Next.js App Router pages and layouts                     |
| `overrides/`             | Customer-owned UI/styling (preferred customisation path) |
| `components/ui/`         | Low-level primitives (shadcn-like)                       |
| `components/headkit-ui/` | Commerce-specific components                             |
| `components/seo/`        | JSON-LD, sitemap utilities                               |
| `lib/`                   | SDK, env, cart, checkout helpers                         |

### Customising the storefront

1. **Dashboard branding** — colours, fonts, corners, icons (no code).
2. **`overrides/`** — preferred place for CSS and future UI overrides; safe across template upgrades.
3. **Full repo** — escape hatch for deep changes; expect manual merges when upgrading the starter.

The footer's left-column paragraph comes from the HeadKit **dashboard SEO description** — not the WordPress `blogdescription` tagline — and renders nothing at all when that field is unset.

See [`overrides/README.md`](./overrides/README.md) for CSS hook classes. Agents should read [`AGENTS.md`](./AGENTS.md).

## SEO Features

- **Dynamic sitemap** — Products, collections, brands, posts, projects, and WordPress
  content pages in `app/sitemap.ts` (pages are discovered from the navigation menus, so a
  published page linked from no menu is not listed — see the `makePageSitemap` docblock)
- **Store-owned sitemap routes** — a landing page you add under `app/` is a storefront
  route, not CMS content, so no section discovers it. Declare it in `sitemap.config.ts`
  (shipped empty, so a store that adds nothing needs no edit) instead of editing the
  shared `app/sitemap.ts`; that file documents the entry shape, what is rejected, and why
  these routes are the one section never existence-probed
- **robots.txt** — `app/robots.ts` with allow/disallow rules for account, checkout, API, search
- **Indexing switch** — `app/robots.ts` and the `robots` meta tag are decided by the same
  two inputs, so they cannot disagree: the request host (`lib/indexing-decision.ts` — a
  host that is not the store's declared domain, such as a temporary migration or rehearsal
  host, is always `noindex`) and the dashboard “show on search engines” setting. Either
  one alone turns indexing off; only both together turn it on. The root layout owns the
  meta tag and routes inherit it (see `MakeSeoMetadataFallback.allowIndexing` in
  `lib/make-metadata.ts`)
- **JSON-LD** — Product, breadcrumb, article, FAQ, website, searchbox (see `components/seo/`)
- **Metadata** — OpenGraph, Twitter cards, canonical URLs. Most indexable routes emit a
  self-referencing canonical (the robots-disallowed ones — account, checkout, search — do
  not; the duplicate product/collection shapes below name their canonical instead); the
  rules for reconciling it with a Yoast canonical live in `resolveCanonical`
  (`lib/make-metadata.ts`)
- **One canonical URL shape** — a product is canonical at `/shop/<category…>/<slug>` and a
  collection at `/collections/<parent>/<child>`; the flat `/products/<slug>` and
  `/collections/<child>` shapes 308 onto them. The product half follows the store's
  WooCommerce permalink base: on a store still on the default `/product/` base a product has
  no nested path, so `/products/<slug>` stays its canonical and issues no redirect. Every
  signal (canonical, `og:url`, internal links, JSON-LD, sitemap) is built from the one
  derivation in `lib/canonical-path.ts` — see [`AGENTS.md`](./AGENTS.md) for the rule and the
  constraints that keep the 308 real

## Standalone vs Monorepo

The starter depends on `@headkit/sdk` (workspace) and backend services (gateway, commerce). For local development, run from the monorepo root:

```bash
# From headkit-platform root — starts gateway, commerce, and starter
bun run dev
```

To run only the starter (requires gateway/commerce already running):

```bash
bun run dev --filter=starter
```

## Environment Variables

| Variable                         | Required | Description                                                   |
| -------------------------------- | -------- | ------------------------------------------------------------- |
| `NEXT_PUBLIC_HEADKIT_PUBLIC_KEY` | Yes      | Public API key (safe for browser)                             |
| `HEADKIT_PRIVATE_KEY`            | Yes      | Secret key (server-side only)                                 |
| `NEXT_PUBLIC_GRAPHQL_URL`        | No       | Gateway URL (default: `http://localhost:4000/graphql`)        |
| `NEXT_PUBLIC_FRONTEND_URL`       | No       | Fallback public frontend origin for SEO                       |
| `NEXT_PUBLIC_GTM_ID`             | No       | Google Tag Manager container ID                               |
| `IMAGE_DOMAIN`                   | No       | Domain for Next.js remote images (e.g. WooCommerce media URL) |

`NEXT_PUBLIC_FRONTEND_URL` is inlined at build time and is only the **fallback** origin
for canonicals, `metadataBase`, the sitemap, robots.txt and the RSS feed — the dashboard
store domain wins at runtime. `lib/site-url.ts` owns that precedence and why.

This holds for every SEO surface, including the shared JSON-LD components in
`components/seo/` — they resolve the runtime origin themselves rather than taking it as a
prop, so no route can emit a second host inside a page. A route whose canonical needs the
runtime domain must use `generateMetadata`; a static `export const metadata` object cannot
read it.

## Routes

| Route                        | Description                                        |
| ---------------------------- | -------------------------------------------------- |
| `/`                          | Home page                                          |
| `/shop`                      | All products                                       |
| `/shop/[...slug]`            | Canonical product detail; also category archives   |
| `/products/[...slug]`        | Flat product URL — 308s to the `/shop/…` canonical |
| `/collections/[...slug]`     | Collection / category (nested shape is canonical)  |
| `/brand`, `/brand/[...slug]` | Brand listing and detail                           |
| `/news`, `/news/[...slug]`   | Blog listing and post detail                       |
| `/search`                    | Search results                                     |
| `/sale`, `/new`, `/featured` | Filtered product listings                          |
| `/checkout`                  | Multi-step checkout                                |
| `/checkout/success`          | Order confirmation                                 |
| `/account`                   | Login / Register                                   |
| `/account/profile`           | Profile management                                 |
| `/account/orders`            | Order history                                      |
| `/account/wishlist`          | Saved products                                     |
| `/contact`, `/faq`           | Static pages                                       |

While the store is in maintenance mode every route above answers `503` with a
branded page, except a short exemption list. One Edge Config write puts it up
and one takes it down, with no redeploy — see [MAINTENANCE.md](./MAINTENANCE.md).

## Customization

### Theme

Edit `app/globals.css` to change the color palette. Brand tokens live in
plain `@theme` (so runtime branding can override them); `purple-500` tracks
`--color-primary` for hovers and accents:

```css
@theme {
  --color-primary: #7f54b3;
  --color-secondary: #000000;
  --color-primary-text: #ffffff;
  --color-purple-500: var(--color-primary);
}
```

### Components

This starter uses the `@headkit/ui` component system. Components live in two layers:

- `components/ui/` — Low-level primitives (button, input, dialog, etc.)
- `components/headkit-ui/` — Commerce components (product-card, cart-drawer, etc.)

Add or update components:

```bash
npx @headkit/ui add product-card cart-drawer
npx @headkit/ui list --installed
```

Component config lives in `headkit-ui.config.json`. The CSS path is `app/globals.css` (no `src/` prefix).

### SDK

The SDK is available as a singleton in `lib/sdk.ts` (public) and `lib/sdk.server.ts` (server-side). All environment variables are validated via Zod in `lib/env.ts`.

```typescript
import { headkit } from "@/lib/sdk";
const product = await headkit.products.get("product-slug");
```

## Testing

```bash
bun run test         # Run Vitest once
bun run test:watch   # Watch mode for development
```

See `lib/checkout-success-utils.test.ts` for an example of unit tests.

## Deployment

Deploy to Vercel (HeadKit-controlled). Set all required environment variables in production. See the [root README](../../README.md) for full platform deployment.

## Tech Stack

- Next.js 16 with App Router
- React 19 (Server Components, `useOptimistic`, `useTransition`)
- TypeScript 5.9 (strict mode)
- Tailwind CSS v4
- Stripe (`@stripe/react-stripe-js` — Checkout Sessions + Elements)
- `@headkit/sdk` — Typed GraphQL client
- Zod — Runtime validation
- Radix UI — Accessible primitives

## The `@headkit/sdk` pin, and how it silently breaks every new store

This app is mirrored to `HeadKit-Commerce/headkit-starter` by `subtree-mirror.yml`, and that template
is what `CreateFromTemplate` clones for every customer store. **The mirror rewrites the `@headkit/sdk`
dependency to an EXACT published version read from `packages/sdk/package.json`.**

That creates a trap which cost the template two months of broken builds:

- in this monorepo, `apps/starter` resolves `@headkit/sdk` through the **bun workspace link**, so it
  compiles against `packages/sdk` **source**;
- in the template, it resolves the **published** package from Artifact Registry.

If you add something to `packages/sdk` and use it here **without bumping
`packages/sdk/package.json`**, this repo type-checks and CI goes green — while the template installs
a published version that does not contain it. Every store created from the template then fails its
first build, and nothing in this repo reports it.

It is worse than a stale pin, because `changeset publish` **refuses to republish an existing
version**. The release run then reports:

```
warn @headkit/sdk is not being published because version X is already published on npm
warn No unpublished projects to publish
```

and exits **green**, which reads as "nothing to do" rather than "you are shipping stale code under a
version number that already means something else".

**So: any change to `packages/sdk` that this app consumes MUST come with a version bump** (a
changeset, or a direct bump to `packages/sdk/package.json`). Merging to `main` publishes it.

Two ordering notes:

1. `Version and Publish` and `Mirror Starter` used to race on the same push, and the mirror lost:
   its registry gate fails closed on the production estate, so on a bump merge it refused with
   `does not resolve in <registry>` and nothing retried. The mirror's **production leg now runs on
   `workflow_run` of `Version and Publish`** instead of on push, so the publish is finished before
   the gate reads the version. The gate itself is unchanged and must stay unchanged — mirroring a
   version the registry cannot resolve ships a template that cannot `bun install` at all.
   Two consequences worth knowing: a FAILED publish means the production mirror never runs (that
   hole is alarmed by `.github/workflows/starter-template-freshness.yml`, which opens an issue when
   `headkit-starter@main` drifts from `main`), and `workflow_dispatch` with estate `production`
   remains the manual recovery path.
2. A red `Version and Publish` does not mean nothing published. The GitHub Release step runs after the
   npm publish and fails independently. Check Artifact Registry before concluding anything.
