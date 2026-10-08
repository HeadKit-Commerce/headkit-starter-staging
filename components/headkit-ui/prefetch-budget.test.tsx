import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_HEADKIT_PUBLIC_KEY: "pk_store",
    NEXT_PUBLIC_GRAPHQL_URL: "https://graph.example.test/graphql",
    HEADKIT_PRIVATE_KEY: "sk_store",
  },
}));
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from "@headkit/sdk";

// `product-carousel.tsx` imports `lib/branding`, which imports `lib/env`.
// Zod validation runs at module load and throws when these are unset.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_HEADKIT_PUBLIC_KEY ??= "pk_test";
  process.env.NEXT_PUBLIC_GRAPHQL_URL ??= "http://localhost:4000/graphql";
  process.env.HEADKIT_PRIVATE_KEY ??= "sk_test";
});

import {
  NavigationBar,
  type NavMenuItem,
} from "@/components/headkit-ui/navigation-bar";
import {
  CAROUSEL_FIRST_ROW,
  ProductCarousel,
} from "@/components/headkit-ui/product-carousel";

/**
 * The two surfaces that keep an explicit `prefetch={true}` when a store runs the
 * prefetch budget (`Partial Prefetching`). `InstantLink`'s own default
 * — `true` without the budget, unset with it — is `instant-link.test.tsx`'s.
 *
 * The point of this file is that the budget and its two exemptions are ONE
 * decision: a guard on `InstantLink` alone stays green while the nav prop or the
 * carousel's `prefetchCount` quietly stops being threaded, and a guard on either
 * call site alone stays green while the other regresses. So both are asserted here,
 * in both directions — the links that must stay explicitly warm under the budget,
 * including the home logo.
 *
 * Every test declares the budget variable explicitly. With the budget OFF an unset
 * `prefetch` still resolves to `true`, so a suite that inherited the process's value
 * would report "everything is warm" as a pass.
 *
 * WHAT THIS COVERS
 *   - `NavigationBar` → `DesktopMenuSection` → top-level `InstantLink`: the
 *     prefetch flag survives the prop thread, for the primary AND secondary lists.
 *   - `ProductCarousel` → `ProductCard` → both of the card's `InstantLink`s:
 *     every product card passes `prefetch={true}`, with the budget on or off.
 *     Next's scheduler orders those links; `prefetchCount` does not cap them.
 *
 * WHERE IT STOPS
 *   - It observes the prop handed to `next/link`, which is mocked here. What Next
 *     then puts on the wire for 'auto' versus 'full' is Next's own code and is only
 *     observable over HTTP.
 *   - It does NOT prove that the home page gives the warm row to the right
 *     carousel. That decision is `firstProductCarouselSegmentIndex` (covered in
 *     `lib/process-editor-blocks.test.ts`) plus the Featured / On Sale fallback in
 *     `app/page.tsx`, which no unit test covers.
 *   - It says nothing about the MOBILE sheet or the mega-menu child links. Those
 *     are deliberately NOT warmed — a WordPress menu can carry dozens of child
 *     links, which is the storm the budget exists to stop — and the mega-menu panel
 *     is unmounted in server markup anyway, so their absence here is not evidence
 *     either way.
 *   - It covers no other `InstantLink` call site. Mega-menu child links stay
 *     unset under the budget; this file does not render that panel.
 */

const { observedLinks } = vi.hoisted(() => ({
  observedLinks: vi.fn<(href: string, prefetch: boolean | undefined) => void>(),
}));

vi.mock("next/cache", () => ({
  cacheLife: (): void => {},
  cacheTag: (): void => {},
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
    prefetch?: boolean;
  }) => {
    observedLinks(href, prefetch);
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
  useLinkStatus: () => ({ pending: false }),
}));

vi.mock("@/components/headkit-ui/header-actions", () => ({
  HeaderActions: () => <div data-stub="header-actions" />,
  MobileHeaderActions: () => <div data-stub="mobile-header-actions" />,
}));

vi.mock("@/components/headkit-ui/cart-trigger-button", () => ({
  CartTriggerButton: () => <button type="button" data-stub="cart" />,
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

const leaf = (id: string, label: string, uri: string): NavMenuItem => ({
  id,
  label,
  uri,
  description: null,
  cssClasses: [],
  children: [],
});

/** Dropdown parents plus childless leaves, the shape a real WP menu has. */
const PRIMARY: NavMenuItem[] = [
  {
    ...leaf("1", "Clothing", "/collections/clothing/"),
    children: [leaf("2", "Jackets", "/collections/clothing/jackets/")],
  },
  leaf("3", "Sale", "/sale/"),
];

const SECONDARY: NavMenuItem[] = [
  leaf("9003", "FAQ", "/faq/"),
  leaf("9004", "Wholesale", "/wholesale/"),
];

function prefetchFor(href: string): Array<boolean | undefined> {
  return observedLinks.mock.calls
    .filter(([linkHref]) => linkHref === href)
    .map(([, prefetch]) => prefetch);
}

function renderNav(): void {
  renderToStaticMarkup(
    <NavigationBar
      primaryMenuItems={PRIMARY}
      secondaryMenuItems={SECONDARY}
      logo={<span>Store</span>}
      navLayout="centered-logo"
    />,
  );
}

describe("the top-level desktop nav keeps its head start under the budget", () => {
  it("passes prefetch={true} to the childless top-level links of BOTH menus", () => {
    observedLinks.mockClear();

    renderNav();

    // Primary list.
    expect(
      prefetchFor("/sale"),
      "a top-level primary nav link must keep prefetch={true}; dropping the DesktopMenuSection prop thread is invisible to instant-link.test.tsx",
    ).toContain(true);
    // Secondary list — threaded through a separate call site, so it regresses
    // independently of the primary one.
    expect(prefetchFor("/faq")).toContain(true);
    expect(prefetchFor("/wholesale")).toContain(true);
  });

  it("warms the home logo explicitly under the budget", () => {
    observedLinks.mockClear();

    renderNav();

    // The centered-logo home link passes prefetch={true} itself. Under the
    // budget an unset InstantLink is cold, so dropping that prop fails here.
    expect(prefetchFor("/"), "the logo link did not render").not.toHaveLength(
      0,
    );
    expect(prefetchFor("/")).toContain(true);
  });

});

function product(slug: string): Product {
  return {
    __typename: "Product",
    id: slug,
    slug,
    name: slug,
    type: "SIMPLE",
    onSale: false,
    isNew: false,
    price: "100",
    regularPrice: "100",
    permalink: `https://example.test/product/${slug}/`,
    image: { src: `/${slug}.jpg` },
    attributes: [],
    variations: [],
  } as unknown as Product;
}

const PRODUCTS = Array.from({ length: 8 }, (_, i) => product(`p${i}`));

describe("ProductCarousel puts every product in Next's prefetch queue", () => {
  it("passes prefetch={true} for every card with the budget on", async () => {
    observedLinks.mockClear();

    renderToStaticMarkup(
      await ProductCarousel({
        products: PRODUCTS,
        prefetchCount: CAROUSEL_FIRST_ROW,
      }),
    );

    const warmed = new Set(
      observedLinks.mock.calls
        .filter(([, prefetch]) => prefetch === true)
        .map(([href]) => href),
    );

    expect(warmed.size).toBe(PRODUCTS.length);
    expect(
      observedLinks.mock.calls.every(([, prefetch]) => prefetch === true),
    ).toBe(true);
  });

  it("passes prefetch={true} when prefetchCount is omitted", async () => {
    observedLinks.mockClear();

    renderToStaticMarkup(await ProductCarousel({ products: PRODUCTS }));

    expect(observedLinks.mock.calls.length).toBeGreaterThan(0);
    expect(
      observedLinks.mock.calls.every(([, prefetch]) => prefetch === true),
    ).toBe(true);
  });

});
