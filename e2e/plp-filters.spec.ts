import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, allowGatewayCors, stackIsUp } from "./fixtures/helpers-2";

/**
 * A product's card heading in a grid.
 *
 * `.first()` is load-bearing. With branding `showVariants` on, the grid renders
 * ONE CARD PER COLOURWAY (lib/catalog-display.ts expandCatalogProducts), so a
 * product with three colours legitimately contributes three identical headings
 * and a bare getByRole fails Playwright strict mode with "resolved to 3
 * elements". Every assertion below is about whether a product is PRESENT or
 * ABSENT in the grid, never about how many colourways it has — the count-based
 * assertions that do care use getByRole directly.
 */
const productHeading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { name }).first();

/**
 * PLP filtering/sorting/pagination e2e (autonomous QA run — E2E-GAPS.md Gap 7).
 *
 * Closes the load-bearing subset of UAT rows P1-01..P1-13 (grouped, per the
 * work order — not 13 separate tests): /shop grid+count+pagination, category
 * scoping (flat + nested), facet-slug deep-link + toggle + clear, price
 * filter, sort, filter landings (/sale /new /featured /brand), empty state.
 *
 * ── REAL APP BUGS FOUND WHILE AUTHORING (fixme'd, not silently skipped) ──
 *
 * BUG 1 — PRICE sort is a no-op (P1-08):
 *   /shop?sort=PRICE returns id-ASC order and ?sort=PRICE_DESC returns the
 *   default id-DESC order (verified against the live stack: PRICE renders
 *   $22, $59, $64, $899, …, $649, $24 — not ascending). The starter maps
 *   PRICE → orderby=price (collection/utils.ts sortMap) and commerce
 *   forwards it (services/commerce/internal/provider/woocommerce/
 *   catalog_provider.go:47-52), but the WP endpoint passes it STRAIGHT into
 *   WP_Query (integrations/wordpress/theme/inc/rest-api/
 *   headkit-products.php:286-295) — WP_Query has no native 'price' orderby,
 *   so it silently falls back to date/id. The sibling block endpoint does
 *   this correctly via headkit_block_convert_orderby + meta_key=_price
 *   (headkit-block-products.php:160-163); headkit-products.php needs the
 *   same mapping. TITLE A-Z/Z-A works (valid WP orderby) and is asserted.
 *
 * BUG 2 (FIXED) — the "In Stock" toggle was a no-op (P1-07): nothing
 *   mapped `?instock=true` onto the backend filter. It now travels as
 *   ProductListFilter.inStock (collection/utils.ts) → commerce (WordPress
 *   `in_stock` / Mongo `stockStatus`) and keeps instock + onbackorder.
 *
 * Seed expectations (storefront-parity seeds, all present in the local WP):
 * apparel/bikes/road-bikes categories, pa_color attributes, Folding Bike
 * out-of-stock, sale products, brands (summit…). Counts are asserted
 * DYNAMICALLY (other workstreams seed additively into the shared WP).
 *
 * LOCAL-ONLY (HARD RULE): all endpoints are localhost Docker services.
 */

/**
 * Product-card titles inside the PLP grid (one h3 per card).
 *
 * Cards sit under the grid's section `h2` ("Products"), same depth as
 * carousel cards. This selector must track `titleAs`; if it is loosened to a
 * bare tag match the suite stops guarding the level.
 *
 * Still scoped to the card hook rather than matching a bare tag: filter
 * labels are also `h3`.
 */
const cards = (page: import("@playwright/test").Page) =>
  page.locator(".headkit-product-card h3");

test.describe("PLP: grid, pagination, category scoping, facets, sort (P1-01..P1-13)", () => {
  test.beforeAll(async () => {
    test.skip(
      !(await stackIsUp()),
      "local stack down — bring up WP :8090 + gateway :4000 + starter",
    );
  });

  // Client-side facet/sort/pagination fetches hit the gateway from the
  // browser — shim CORS for non-:3000 test ports (see helpers-2.ts).
  test.beforeEach(async ({ page }) => {
    await allowGatewayCors(page);
  });

  test("P1-01/09: /shop renders a full first page with product count; Load More appends; ?page=2 deep-link offers Load Previous", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/shop`);
    await expect(
      cards(page).first(),
      "/shop grid rendered no product cards",
    ).toBeVisible({ timeout: 30_000 });

    // First page renders a full-row quantum of cards (colourway expansion may
    // hold an incomplete trailing row until Load More / catalog end). Count
    // line always tracks parent Woo products (pagination unit), not cards.
    await expect
      .poll(() => cards(page).count(), { timeout: 15_000 })
      .toBeGreaterThan(0);
    const firstPageCards = await cards(page).count();
    expect(
      firstPageCards % 12 === 0 || firstPageCards < 12,
      `expected full-row quantum (12) or short catalog, got ${firstPageCards}`,
    ).toBe(true);
    // `.first()` — Instant Navigation / Cache Components can briefly leave a
    // second matching node in the tree (strict-mode flake on Blacksmith CI).
    await expect(
      page.getByText(/Viewing \d+ of \d+ products/).first(),
      "ProductCount line missing",
    ).toBeVisible();

    // Load More appends the next page. Scrolling the sentinel into view
    // triggers the IntersectionObserver-driven loadMore — do NOT click the
    // fallback button: the auto-load can consume the last page mid-click and
    // unmount it (flaky detach race).
    const before = await cards(page).count();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect
      .poll(() => cards(page).count(), {
        message: "Load More did not append the next page",
        timeout: 30_000,
      })
      .toBeGreaterThan(before);

    // Deep-linked ?page=2 is ONE continuous list: the static shell's page 1
    // plus page 2 appended in the browser (`hydrateThroughPage`, #667), so no
    // Load Previous is ever offered and the shareable `?page=2` stays in the
    // URL until the shopper loads more.
    await page.goto(`${BASE_URL}/shop?page=2`);
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(() => cards(page).count(), {
        message: "?page=2 deep-link did not hydrate page 2 below page 1",
        timeout: 30_000,
      })
      .toBeGreaterThan(firstPageCards);
    await expect(
      page.getByRole("button", { name: /load previous/i }),
      "a deep link renders pages 1…N, so there is nothing to load before it",
    ).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("page")).toBe("2");
  });

  test("P1-02: category scoping — flat /collections/apparel and nested /collections/bikes/road-bikes", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/collections/apparel`);
    await expect(
      productHeading(page, "Classic Tee"),
      "apparel PLP missing a seeded apparel product",
    ).toBeVisible({ timeout: 30_000 });
    // A drinkware product must NOT leak into the apparel collection.
    await expect(
      productHeading(page, "Ceramic Mug"),
      "category scoping leaked a non-apparel product into /collections/apparel",
    ).toHaveCount(0);

    // Nested path resolves the CHILD category.
    await page.goto(`${BASE_URL}/collections/bikes/road-bikes`);
    await expect(productHeading(page, /Road Racer Bike/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(productHeading(page, /Aero Road Bike/)).toBeVisible();
    await expect(
      productHeading(page, "Folding Bike"),
      "nested child category leaked a parent-category product",
    ).toHaveCount(0);
  });

  test("P1-03/04/10: facet-slug deep-link pre-applies color; toggling updates the /f/ path; Clear Filters resets", async ({
    page,
  }) => {
    // Shareable filter-in-path URL: direct load = pre-filtered grid.
    await page.goto(`${BASE_URL}/collections/apparel/f/color.black`);
    await expect(
      productHeading(page, "Classic Tee"),
      "facet deep-link did not render the filtered grid",
    ).toBeVisible({ timeout: 30_000 });
    // Summer Dress has no black option — must be filtered out.
    await expect(
      productHeading(page, /Summer Dress/),
      "facet deep-link did not actually filter (non-black product present)",
    ).toHaveCount(0);

    // The Color facet hydrates CHECKED from the path (06.1 hydration).
    await page.getByRole("button", { name: /^Color/ }).click();
    const blackBox = page
      .locator("label")
      .filter({ hasText: /^Black/ })
      .locator('input[type="checkbox"]')
      .first();
    await expect(blackBox, "Color facet options did not render").toBeAttached({
      timeout: 15_000,
    });
    expect(
      await blackBox.isChecked(),
      "deep-linked color facet did not hydrate as checked",
    ).toBe(true);

    // Toggle a second color — the path slug must gain the value (sorted).
    await page.locator("label").filter({ hasText: /^Navy/ }).first().click();
    await page.waitForURL(/\/collections\/apparel\/f\/color\.black\.navy/, {
      timeout: 30_000,
    });

    // Clear Filters returns to the base collection path.
    await page.getByRole("button", { name: /clear filters/i }).click();
    await expect
      .poll(async () => new URL(page.url()).pathname, {
        message: "Clear Filters did not reset the /f/ path",
        timeout: 30_000,
      })
      .toBe("/collections/apparel");
    await expect(
      productHeading(page, /Summer Dress/),
      "Clear Filters did not restore the unfiltered grid",
    ).toBeVisible({ timeout: 30_000 });
  });

  test("P1-06: price min filter narrows the grid (URL price_min, server + client agree)", async ({
    page,
  }) => {
    // Server-rendered deep-link.
    await page.goto(`${BASE_URL}/shop?price_min=100`);
    await expect(
      productHeading(page, "Trailblazer MTB"),
      "price_min deep-link lost an in-range product",
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      productHeading(page, "Classic Tee"),
      "price_min=100 still lists a $22 product",
    ).toHaveCount(0);

    // UI path: commit a min price from the Price facet (auto-applies on
    // Enter). Page 1 of the default /shop order contains Test Product 12
    // ($22) — it must drop out once min=$100 commits.
    await page.goto(`${BASE_URL}/shop`);
    await expect(productHeading(page, "Test Product 12")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /^Price/ }).click();
    const minInput = page.getByLabel("Minimum price");
    await expect(minInput).toBeVisible({ timeout: 15_000 });
    await minInput.fill("100");
    await minInput.press("Enter");
    await expect
      .poll(
        async () =>
          page.getByRole("heading", { name: "Test Product 12" }).count(),
        {
          message: "committing min price did not narrow the grid",
          timeout: 30_000,
        },
      )
      .toBe(0);
    await expect(
      productHeading(page, "Trailblazer MTB"),
      "an in-range product is missing after the min-price commit",
    ).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => page.url(), {
        message: "price_min did not sync into the URL",
        timeout: 15_000,
      })
      .toContain("price_min=100");
  });

  test("P1-08: TITLE sort reorders A-Z and Z-A (deep-link + UI)", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/shop?sort=TITLE`);
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(
      cards(page).first(),
      "sort=TITLE first card is not alphabetically first",
    ).toHaveText(/Aero Road Bike/);

    await page.goto(`${BASE_URL}/shop?sort=TITLE_DESC`);
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    await expect(
      cards(page).first(),
      "sort=TITLE_DESC first card is not alphabetically last",
    ).toHaveText(/Wool Beanie/);

    // UI path: pick A-Z from the Sort menu.
    await page.goto(`${BASE_URL}/shop`);
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /^Sort$/ }).click();
    await page.getByText("Alphabetically, A-Z", { exact: true }).click();
    await expect
      .poll(async () => cards(page).first().textContent(), {
        message: "Sort menu A-Z did not reorder the grid",
        timeout: 30_000,
      })
      .toMatch(/Aero Road Bike/);
  });

  test.fixme("P1-08 BLOCKED (app bug): PRICE asc/desc actually reorders by price", async ({
    page,
  }) => {
    // BLOCKER — real app bug, see spec header BUG 1:
    // headkit-products.php:286-295 forwards orderby=price into WP_Query
    // unmapped (needs meta_value_num + meta_key=_price, as
    // headkit-block-products.php does) → PRICE returns id-ASC and
    // PRICE_DESC returns id-DESC. Un-fixme once the theme endpoint maps it.
    await page.goto(`${BASE_URL}/shop?sort=PRICE`);
    const prices = page.locator(".headkit-product-card h3 ~ * >> text=/\\$/");
    await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
    const first = await page
      .locator("p", { hasText: /\$/ })
      .first()
      .textContent();
    const last = await page
      .locator("p", { hasText: /\$/ })
      .last()
      .textContent();
    const parse = (s: string | null) =>
      Number((s ?? "").replace(/[^0-9.]/g, ""));
    expect(parse(first)).toBeLessThanOrEqual(parse(last));
    void prices;
  });

  test("P1-07: In Stock toggle hides out-of-stock products", async ({
    page,
  }) => {
    // Folding Bike is seeded outofstock; ?instock=true must drop it while the
    // in-stock bikes stay.
    await page.goto(`${BASE_URL}/collections/bikes?instock=true`);
    await expect(productHeading(page, /Mountain Explorer/)).toBeVisible({
      timeout: 30_000,
    });
    await expect(productHeading(page, "Folding Bike")).toHaveCount(0);
  });

  test("P1-12/13: filter landings — /sale all-sale, /new and /featured and /brand/{slug} populated, /brand index lists brands", async ({
    page,
  }) => {
    // /sale: every card carries the Sale badge (dynamic count — the shared
    // WP may gain sale products from other workstreams).
    await page.goto(`${BASE_URL}/sale`);
    await expect(cards(page).first(), "/sale rendered no products").toBeVisible(
      { timeout: 30_000 },
    );
    const saleCards = await cards(page).count();
    const saleBadges = await page
      .locator("span", { hasText: /^Sale$/ })
      .count();
    expect(
      saleBadges,
      `/sale lists ${saleCards} cards but only ${saleBadges} Sale badges — a non-sale product leaked in`,
    ).toBeGreaterThanOrEqual(saleCards);

    await page.goto(`${BASE_URL}/new`);
    await expect(cards(page).first(), "/new rendered no products").toBeVisible({
      timeout: 30_000,
    });

    await page.goto(`${BASE_URL}/featured`);
    await expect(
      cards(page).first(),
      "/featured rendered no products",
    ).toBeVisible({ timeout: 30_000 });

    // Brand index lists the seeded brands; per-brand PLP scopes to it.
    await page.goto(`${BASE_URL}/brand`);
    const summitLink = page.locator('a[href="/brand/summit"]').first();
    await expect(
      summitLink,
      "/brand index does not list the seeded Summit brand",
    ).toBeVisible({ timeout: 30_000 });

    await page.goto(`${BASE_URL}/brand/summit`);
    await expect(
      productHeading(page, "Trailblazer MTB"),
      "/brand/summit missing a seeded Summit product",
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      productHeading(page, "Classic Tee"),
      "/brand/summit leaked a non-Summit product",
    ).toHaveCount(0);
  });

  test("P1-11: zero-result filter combo renders the empty state, no crash", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/shop?price_min=99999`);
    // `.first()` — same duplicate-node flake as ProductCount (see P1-01/09).
    await expect(
      page.getByText("No products found").first(),
      "zero-result PLP did not render its empty state",
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/try adjusting your filters/i).first(),
      "empty state recovery copy missing",
    ).toBeVisible();
  });
});
