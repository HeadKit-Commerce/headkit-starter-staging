# Storefront overrides

Customer-owned customisation layer. **Prefer this directory for UI and styling edits.**

Platform template upgrades should leave `overrides/` alone. You still have the full storefront repo if you need deeper changes — use that as an escape hatch, not the default.

## What goes here

| Path                     | Purpose                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `styles.css`             | CSS beyond dashboard branding (layout, spacing, hide elements, tweaks) |
| `theme.json`             | Layout modes (nav, hero, homepage nav) — validated at build time       |
| `theme.schema.json`      | JSON Schema for `theme.json` (for editors and future tooling)          |
| `design-tokens.json`     | Design reference tokens (Figma-aligned; not loaded at runtime yet)     |
| `FIGMA.md`               | How Figma variables map to repo tokens and `theme.json`                |
| `GAPS.md`                | Known gaps, hard-coded areas, and follow-up work                       |
| `header-actions.tsx`     | Extra header icons (e.g. phone) between Account and Cart               |
| `home-slots.tsx`         | Extra homepage category tiles and a block after Featured               |
| `layout-slots.tsx`       | Pre-paint `<head>` script and a sibling after `<main>`                 |
| `pdp-beside-bundles.tsx` | Content beside the PDP bundles carousel                                |
| `pdp-buy-box-extras.tsx` | Block after the PDP buy box, before sticky add to cart                 |
| `page-columns.tsx`       | Two-column CMS pages (image or video beside the copy)                  |
| `page-form-layout.tsx`   | Shopify contact and partnerships form beside the page copy             |
| `post-video-dialog.tsx`  | Journal and post video modal (null keeps the starter dialog)           |
| `collection-slots.tsx`   | Whether collection pages render the breadcrumb trail                   |
| `maintenance.ts`         | Copy, colours and logo for the maintenance page (`../MAINTENANCE.md`)  |

## What stays elsewhere

| Concern                                   | Prefer                                                                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Brand colours, fonts, corner style, icons | Dashboard → Branding (runtime CSS vars)                                                                        |
| Copy / product data / checkout fields     | Store config & commerce APIs (coming later)                                                                    |
| One-off pages or unique React behaviour   | New routes under `app/` or local components — avoid editing `components/headkit-ui/` when a hook + CSS will do |

## Layout modes (`theme.json`)

Customer layout behaviour is configured in `overrides/theme.json` and loaded by `lib/store-theme.ts`. Invalid files fall back to starter defaults so a typo cannot break the shell.

| Field         | Values                                | Effect                                 |
| ------------- | ------------------------------------- | -------------------------------------- |
| `navLayout`   | `left-logo`, `centered-logo`, `split` | Logo placement in the nav bar          |
| `navStyle`    | `icons`, `text-labels`                | Desktop header actions (icons vs text) |
| `heroLayout`  | `inset`, `full-bleed`, `fixed-height` | Hero carousel shell (margins, height)  |
| `homepageNav` | `solid`, `overlay-hero`               | Transparent nav over homepage hero     |

SSR hooks: `getThemeHtmlAttributes()` sets `data-nav-layout`, `data-nav-style`, `data-hero-layout`, and `data-homepage-nav` on `<html>` so `styles.css` can target layout modes without per-route React changes.

Homepage-only rules use `html:has(.headkit-home)` because the nav renders outside `<main>`.

See `docs/customization-playbook.md` for the full agent workflow (Figma → tokens → CSS passes).

### Catalog presentation (`theme.json` → `catalog`)

| Field             | Default | Effect                                                                                                                                                                                                                 |
| ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxCardSwatches` | `10`    | Colour dots a product card shows before the rest collapse into a "+N" chip. N dots PLUS the chip, so a card with `N + 1` colourways still shows N. Does not affect the dot's 24 px tap target, which is unconditional. |

### Empty WordPress pages (`theme.json` → `cms`)

WooCommerce keeps real page nodes for its `cart` and `my-account` screens even in a headless
store, so the storefront 404s the first and permanently redirects the second, and keeps both out
of the sitemap. Those two are platform defaults. A store with its own empty parent page — a
`legal` or `policies` node whose children are the real pages — names it here. Slugs are bare and
top-level, and are matched EXACTLY: excluding `legal` leaves `legal/privacy-policy` rendering.

| Field                  | Effect                                                    |
| ---------------------- | --------------------------------------------------------- |
| `placeholderNotFound`  | Extra bare slugs to 404 and keep out of the sitemap       |
| `placeholderRedirects` | Extra bare slug → root-relative permanent redirect target |

```json
{
  "cms": {
    "placeholderNotFound": ["legal"],
    "placeholderRedirects": { "my-account": "/account/orders" }
  }
}
```

## Styling

Edit `styles.css`. It is imported from the root layout after `app/globals.css`.

Dashboard branding still sets primary colour, fonts, and radii at runtime. Use overrides for everything those tokens do not cover (and for intentional CSS visibility rules such as hiding prices).

```css
/* Example: hide prices site-wide */
.price,
[data-price] {
  display: none;
}
```

## Header action extras

`header-actions.tsx` is mounted by the core header between Account and Cart (desktop) and after Account (mobile sheet). Put store-specific actions here (phone, etc.) so template upgrades do not overwrite them.

Return `null` from `HeaderActionExtras` / `MobileHeaderActionExtras` to hide them (default in the starter template).

## CSS hook classes (stable selectors)

The starter ships **hook classes** on key layout regions so you can target them from `overrides/styles.css` without editing React components. All hooks use the `headkit-*` prefix and match WordPress block pattern names where applicable.

### Shell & chrome

| Hook class                       | Where                         | Use for                                      |
| -------------------------------- | ----------------------------- | -------------------------------------------- |
| `headkit-main`                   | `<main>` in root layout       | Site-wide content padding / footer gap       |
| `headkit-preheader`              | Promo / announcement bar      | Background, text, link colour                |
| `headkit-nav`                    | Main navigation bar           | Nav link typography, uppercase, hover states |
| `headkit-nav-secondary`          | Right-side nav list (actions) | Icon row spacing, secondary link styles      |
| `headkit-footer`                 | Site footer                   | Footer background, borders, typography       |
| `headkit-footer-connect`         | Footer social / Connect block | Hide socials or restyle icons                |
| `headkit-footer-subscribe`       | Footer mailing-list form      | Subscribe label / input / button             |
| `headkit-footer-payment-methods` | Footer payment icon row       | Hide or resize payment badges                |
| `headkit-cart-drawer`            | Cart / quote drawer sheet     | Drawer background, item list, CTA            |
| `headkit-search-drawer`          | Search overlay sheet          | Search input / result grid                   |

### Homepage & CMS sections

| Hook class                    | Where                                  | Use for                                            |
| ----------------------------- | -------------------------------------- | -------------------------------------------------- |
| `headkit-home`                | Homepage root wrapper                  | Homepage-only rules (section backgrounds, spacing) |
| `headkit-cms-page`            | CMS page content padding wrappers      | Inner-page typography / max-width                  |
| `headkit-cms-html`            | Homepage leftover WP HTML segments     | Editorial copy between HeadKit sections            |
| `headkit-hero-carousel`       | Hero / main carousel                   | Slide overlay, CTA, pagination dots                |
| `headkit-callout`             | Callout / promo box                    | Background, text colour, button row                |
| `headkit-callout-section`     | Outer padding around a callout         | Section vertical rhythm                            |
| `headkit-brand-carousel`      | Brand carousel sections                | Logo sizing, section padding, dots                 |
| `headkit-client-carousel`     | Client carousel sections               | Same for client logo rails                         |
| `headkit-category-carousel`   | Category carousel sections             | Category rail styling                              |
| `headkit-product-carousel`    | Product carousel sections (CMS + home) | Product rail styling                               |
| `headkit-post-carousel`       | News / blog carousel sections          | Post card styling                                  |
| `headkit-project-carousel`    | Projects carousel sections             | Project card styling                               |
| `headkit-section-header`      | Section title + description + View all | Heading colour, CTA underline                      |
| `headkit-collection-card-cta` | Homepage collection-card link text     | “Discover Collection” under the tile title         |
| `headkit-gallery`             | WP gallery media blocks                | Gallery layout / gaps                              |
| `headkit-embed`               | WP embed / iframe blocks               | Embed sizing                                       |
| `headkit-video-feature-wrap`  | Video feature sections                 | Two-column video + copy layout                     |
| `headkit-media`               | Other sanitized media HTML blocks      | Generic media section styling                      |

### Catalog & commerce

| Hook class                    | Where                                            | Use for                            |
| ----------------------------- | ------------------------------------------------ | ---------------------------------- |
| `headkit-collection`          | PLP / collection grid shell                      | Filters, grid, load-more           |
| `headkit-product-card`        | Individual product card                          | Card image, title, price, swatches |
| `headkit-product-detail`      | PDP (product detail)                             | Gallery + buy box layout           |
| `headkit-pdp-gallery`         | PDP image gallery (`data-pdp-gallery`, `[data-gallery-tile]`, `[data-gallery-lead]`) | Tile aspect and lead image fit. Arrangement comes from dashboard branding. |
| `headkit-badge-new`           | “New” product badge                              | Colour, hide, typography           |
| `headkit-badge-sale`          | “Sale” product badge                             | Colour, hide, typography           |
| `headkit-badge-cart`          | Cart quantity badge on icon                      | Badge colour / size                |
| `headkit-recently-viewed`     | Recently viewed products strip                   | Section spacing / heading          |
| `headkit-product-sticky-bar`  | PDP sticky add-to-cart bar                       | Bar background, height, hide it    |
| `headkit-availability-status` | PDP stock line (`data-status` carries the state) | Copy colour, hide the pulsing dot  |

### Key routes

| Hook class              | Where                | Use for                      |
| ----------------------- | -------------------- | ---------------------------- |
| `headkit-contact`       | `/contact` page root | Contact layout / form column |
| `headkit-checkout`      | Checkout page root   | Checkout form / summary      |
| `headkit-quote`         | Quote checkout root  | Quote form styling           |
| `headkit-news-page`     | `/news` listing      | Category chips, post grid    |
| `headkit-projects-page` | `/projects` listing  | Category chips, project grid |

WordPress also emits related markers in content HTML (not React wrappers):

| Marker / class              | Where                          | Notes                                    |
| --------------------------- | ------------------------------ | ---------------------------------------- |
| `headkit-gravity-form`      | GF placeholder in CMS HTML     | Replaced by React Gravity Form           |
| `headkit-product-lists`     | WP product grid in CMS HTML    | Hydrated into `headkit-product-carousel` |
| `headkit-block-section`     | WP HeadKit section groups      | Parsed into BlockEditor sections         |
| `headkit-block-title`       | Section title in WP HTML       | Extracted for SectionHeader              |
| `headkit-block-description` | Section description in WP HTML | Extracted for SectionHeader              |
| `headkit-hilight`           | Legacy callout alias           | Treated like `headkit-callout`           |

### Examples

```css
/*
 * Radix NavigationMenuList wraps each <ul> in a relative <div>, so the
 * structure is nav.headkit-nav > div > ul > li > a|button — not nav > ul.
 */
.headkit-nav > div > ul > li > a,
.headkit-nav > div > ul > li > button {
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* Homepage: alternate section backgrounds */
.headkit-home .headkit-client-carousel {
  background-color: var(--brand-bg, #e5e5e0);
}

.headkit-home .headkit-project-carousel {
  background-color: #2d4236;
  color: #f2f2ef;
}

/* Callout: brand-coloured promo band */
.headkit-callout {
  background-color: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

/* Hide New badge; recolour cart count */
.headkit-badge-new {
  display: none;
}
.headkit-badge-cart {
  background-color: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
}

/* Footer */
.headkit-footer {
  background-color: var(--brand-bg, #fff);
}
.headkit-footer-payment-methods,
.headkit-footer-connect {
  display: none;
}

/* PDP / PLP tweaks */
.headkit-product-detail .headkit-badge-sale {
  background-color: #c41e3a;
}
.headkit-collection .headkit-product-card {
  /* card-level overrides */
}
```

### CMS blocks vs hardcoded sections

WordPress editor blocks and hardcoded starter fallbacks (when WP does not provide a pattern) both expose the same hook classes — e.g. `headkit-brand-carousel` and `headkit-product-carousel` work whether the section comes from a WP pattern or the starter fallback on `app/page.tsx`. Hero slides use `headkit-hero-carousel` in both paths.

## Full-repo escape hatch

Store owners and agents can still change any file in this repo. That works, but merges against future HeadKit starter updates become manual. Prefer `overrides/` (and dashboard branding) so core storefront code stays upgradeable.

**Do not edit `components/headkit-ui/` for cosmetic CSS** when a hook class above covers the target. If a region lacks a hook, open a platform PR to add one rather than patching the component in a customer repo.

## Future

Named React slots, copy overrides, and feature flags may land here later.
