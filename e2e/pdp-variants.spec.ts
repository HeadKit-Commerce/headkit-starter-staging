import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  VARIABLE_PRODUCT_SLUG,
  allowGatewayCors,
  stackIsUp,
} from "./fixtures/helpers-2";

/**
 * PDP + path-based variant routing e2e (autonomous QA run — E2E-GAPS.md Gap 8).
 *
 * Closes UAT rows P1-14 (simple PDP), P1-15 (color swatch → colorway PATH
 * URL), P1-16 (colorway deep-link preselects), P1-17 (size persists to
 * localStorage `headkit:size:{slug}`, restores on revisit, never in URL),
 * P1-18 (out-of-stock: availability + add-to-cart blocked), P1-18b
 * (out-of-stock SIZE on an in-stock colourway: line + button agree), P1-19
 * (lightbox), P1-20 (related carousel navigates), P1-22 (legacy
 * /shop/{cat}/{slug} catch-all renders the same PDP), P1-25 (breadcrumbs +
 * JSON-LD).
 *
 * Fixture notes (storefront-parity seeds):
 *   - classic-tee: VARIABLE, pa_color black/navy/white + pa_size s/m/l/xl
 *     (colors seeded without swatch hex → render as text option buttons)
 *   - test-product-12: simple $22 product
 *   - folding-bike: simple product seeded OUT OF STOCK — used for P1-18 so
 *     the shared WP needs no stock mutation (additive-only rule)
 *   - stock-mix-tee: VARIABLE, pa_color black/navy + pa_size s/m/l, with black/L
 *     OUT OF STOCK and everything else in stock — the only fixture that can show
 *     an out-of-stock size on an in-stock colourway (P1-18b)
 *
 * ── REAL APP GAP (fixme'd): recently-viewed rail (P1-21) is DEAD CODE ──
 *   components/headkit-ui/recently-viewed.tsx exports RecentlyViewed +
 *   addToRecentlyViewed (localStorage `hk-recently-viewed`), but NOTHING
 *   imports either — the PDP never records a visit and no route mounts the
 *   rail, so the feature cannot appear. See the fixme test.
 *
 * LOCAL-ONLY (HARD RULE): all endpoints are localhost Docker services.
 */

const TEE = VARIABLE_PRODUCT_SLUG; // classic-tee

/**
 * The only fixture with an out-of-stock SIZE on an in-stock colourway — seeded
 * by `docker/wordpress/seed-variation-stock.php` (black/L out of stock). Not
 * env-overridable: the spec asserts the seeded stock layout, not just the slug.
 */
const STOCK_MIX = "stock-mix-tee";

/**
 * The trailing-slash-normalised pathname of a URL.
 *
 * Colourway assertions compare paths RELATIVE to whatever base the store's
 * WooCommerce permalinks produce, never against a hardcoded `/products/` or
 * `/shop/` prefix: `/products/{slug}` 308s onto `/shop/{cat…}/{slug}` on a
 * nested-permalink store, so a hardcoded prefix would go red on exactly the
 * stores the canonical routing targets.
 */
function pathOf(url: string): string {
  return new URL(url, BASE_URL).pathname.replace(/\/+$/, "");
}

test.describe("PDP: rendering, colorway paths, size persistence, stock, legacy URLs (P1-14..P1-25)", () => {
  test.beforeAll(async () => {
    test.skip(
      !(await stackIsUp()),
      "local stack down — bring up WP :8090 + gateway :4000 + starter",
    );
  });

  test.beforeEach(async ({ page }) => {
    await allowGatewayCors(page);
  });

  test("P1-14/25: simple PDP renders title, price, availability, description tab, and Product/Breadcrumb JSON-LD", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/products/test-product-12`);

    await expect(
      page.getByRole("heading", { level: 1, name: "Test Product 12" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("$22.00").first()).toBeVisible();
    // Dynamic (PPR-streamed) availability hydrates to In Stock.
    await expect(page.getByText(/^In Stock$/).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      page.getByRole("button", { name: /add to cart/i }),
    ).toBeEnabled();
    // Reviews accordion only renders when WooCommerce Enable reviews is on
    // for the store/product — do not require it here. Description is
    // asserted on classic-tee in the legacy-URL test.

    // Breadcrumbs are bot/JSON-LD only — not rendered in the storefront UI.
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toHaveCount(0);

    // Product + BreadcrumbList JSON-LD present for agents/bots.
    const jsonld = await page
      .locator('script[type="application/ld+json"]')
      .allTextContents();
    expect(
      jsonld.some((s) => s.includes('"Product"')),
      "no Product JSON-LD script on the PDP",
    ).toBe(true);
    expect(
      jsonld.some((s) => s.includes('"BreadcrumbList"')),
      "no BreadcrumbList JSON-LD script on the PDP",
    ).toBe(true);
  });

  test("P1-15: clicking a color option pushes the colorway PATH URL and updates the selection", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/products/${TEE}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Classic Tee" }),
    ).toBeVisible({ timeout: 30_000 });

    // The path the PDP actually settled on. `page.goto` follows the 308 the flat
    // shape now serves, so this is `/shop/{cat…}/{slug}` on a store with nested
    // WooCommerce permalinks and `/products/{slug}` on one using the default
    // `/product/` base. Asserting the flat prefix would pass here only because
    // the docker WordPress uses that default base, and go red on exactly the
    // nested-permalink stores the canonical routing exists for — so the
    // colourway segment is asserted RELATIVE to whatever base the store has.
    const basePath = pathOf(page.url());

    // Color options render as option buttons (no swatch hex in the seed).
    // .first(): related-products cards also render color option buttons
    // (e.g. #related-products-item-N > "Navy"), so an unscoped strict-mode
    // locator resolves to 3 elements once the rail hydrates. The main PDP
    // variant selector always precedes the rail in the DOM.
    await page
      .getByRole("button", { name: /^Navy$/ })
      .first()
      .click();
    await page.waitForURL(
      (url) => pathOf(url.toString()) === `${basePath}/navy`,
      { timeout: 30_000 },
    );

    // The new colorway page preselects Navy (label next to the Color name).
    await expect(
      page.getByText("Navy", { exact: true }).first(),
      "selected color label did not update after the colorway navigation",
    ).toBeVisible({ timeout: 30_000 });
  });

  test("P1-16/17: colorway deep-link preselects color; size choice persists to localStorage and restores on revisit (client-only, not in URL)", async ({
    page,
  }) => {
    // Deep-link straight into the navy colorway.
    await page.goto(`${BASE_URL}/products/${TEE}/navy`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Classic Tee" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("Navy", { exact: true }).first(),
      "colorway deep-link did not preselect the color",
    ).toBeVisible();

    // Pick size L → persisted under headkit:size:{slug}, URL unchanged.
    await page.getByRole("button", { name: /^L$/ }).click();
    await expect
      .poll(
        () =>
          page.evaluate(
            (slug) => localStorage.getItem(`headkit:size:${slug}`),
            TEE,
          ),
        { message: "size selection was not persisted to localStorage" },
      )
      .toBe("l");
    // Shape-agnostic: the colourway path is `/shop/{cat…}/{slug}/navy` on a
    // nested-permalink store and `/products/{slug}/navy` on the default
    // `/product/` base. What this pins is that SIZE never entered the URL and
    // the colourway segment is still the last one — not which base won.
    expect(new URL(page.url()).pathname, "size leaked into the URL").toMatch(
      new RegExp(`/${TEE}/navy$`),
    );

    // Fresh visit to the BASE product restores the saved size.
    await page.goto(`${BASE_URL}/products/${TEE}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Classic Tee" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText("L", { exact: true }).first(),
      "saved size was not restored on revisit",
    ).toBeVisible({ timeout: 30_000 });
  });

  test("P1-18: out-of-stock product shows Out of Stock and blocks add-to-cart", async ({
    page,
  }) => {
    // folding-bike is seeded outofstock — no stock mutation needed.
    await page.goto(`${BASE_URL}/products/folding-bike`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Folding Bike" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByText(/^Out of Stock$/).first(),
      "availability status did not show Out of Stock",
    ).toBeVisible({ timeout: 30_000 });
    const addButton = page.getByRole("button", { name: /out of stock/i });
    await expect(
      addButton,
      "add-to-cart button did not switch to its out-of-stock state",
    ).toBeVisible();
    await expect(addButton).toBeDisabled();
  });

  /**
   * The availability line and the Add to Bag button must agree about the size
   * the shopper actually selected.
   *
   * They used to resolve stock from two different variations: the line came from
   * a server slot keyed to the COLOURWAY IN THE URL (first variation in payload
   * order, of whatever size), the button from the full attribute match. Clicking
   * a size moved the button and left the line frozen, so an out-of-stock size on
   * an in-stock colourway rendered a green "In Stock" line above an
   * "Out of stock" button (`260925-bs-variable-stock-out-of-stock`). P1-18 above
   * cannot see it: folding-bike is a SIMPLE product, and a simple product reads
   * both answers off the same object.
   *
   * This is the only layer that observes the real static shell and the real
   * client hydration together. `stock-mix-tee` is seeded by
   * `docker/wordpress/seed-variation-stock.php` with black/L out of stock and
   * everything else in stock.
   */
  test("P1-18b: an out-of-stock SIZE on an in-stock colourway flips the availability line and the button together", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/products/${STOCK_MIX}/black`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Stock Mix Tee" }),
    ).toBeVisible({ timeout: 30_000 });

    const availability = page.locator(".headkit-availability-status").first();
    const atc = page
      .getByRole("button", { name: /add to cart|out of stock/i })
      .first();

    // Preselected size is the colourway's first variation (black/S, in stock).
    // Asserting the in-stock state FIRST is load-bearing: a regression that
    // pinned the line to "Out of Stock" would otherwise pass the flip below.
    await expect(availability).toHaveAttribute("data-status", "IN_STOCK", {
      timeout: 30_000,
    });
    await expect(atc).toHaveText(/add to cart/i);
    await expect(atc).toBeEnabled();

    // L is out of stock for this colourway.
    await page.getByRole("button", { name: "L", exact: true }).first().click();

    await expect(
      availability,
      "the availability line did not follow the selected size — it is resolving stock from a different variation than the button",
    ).toHaveAttribute("data-status", "OUT_OF_STOCK", { timeout: 15_000 });
    await expect(atc).toHaveText(/out of stock/i);
    await expect(atc).toBeDisabled();

    // …and back, so the line is tracking the selection rather than latching.
    await page.getByRole("button", { name: "S", exact: true }).first().click();
    await expect(availability).toHaveAttribute("data-status", "IN_STOCK", {
      timeout: 15_000,
    });
    await expect(atc).toHaveText(/add to cart/i);
  });

  test("P1-19: gallery image click opens the lightbox dialog", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/products/test-product-12`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Test Product 12" }),
    ).toBeVisible({ timeout: 30_000 });

    // Desktop gallery images are DialogTriggers wrapping the image. The
    // header's mobile "Open menu" button is ALSO a dialog trigger (Base UI,
    // #546) and comes first in the DOM, hidden at this viewport — so the
    // trigger must be one that wraps an image and is visible.
    await page
      .locator('button[aria-haspopup="dialog"]')
      .filter({ has: page.locator("img"), visible: true })
      .first()
      .click();
    await expect(
      page.getByRole("dialog"),
      "clicking a gallery image did not open the lightbox dialog",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("P1-20: related-products carousel renders and navigates to the related PDP", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/products/${TEE}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Classic Tee" }),
    ).toBeVisible({ timeout: 30_000 });

    const relatedSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Something similar" }),
    });
    await expect(
      relatedSection,
      "related-products section missing on the variable PDP",
    ).toBeVisible();
    // BOTH shapes `productPath` can return, and only those two: `/shop/…` on a
    // nested-permalink store, `/products/…` on the default `/product/` base.
    // Matching `/products/` alone would find nothing on the nested-permalink
    // stores this ticket targets; matching every site-relative `/` would stop
    // proving the related card links a PDP at all.
    const relatedLink = relatedSection
      .locator('a[href^="/shop/"]:visible, a[href^="/products/"]:visible')
      .first();
    await expect(relatedLink).toBeVisible();
    const href = await relatedLink.getAttribute("href");
    expect(href, "related card rendered no product link").toBeTruthy();
    const target = pathOf(href!);
    await relatedLink.click();
    // Land on exactly the href the card advertised — or one segment below it,
    // because a card defaulting to its first swatch links the colourway
    // (`{base}/{colour}`). Asserted against the card's OWN href, so the
    // assertion holds under either permalink base.
    await page.waitForURL(
      (url) => {
        const landed = pathOf(url.toString());
        return landed === target || landed.startsWith(`${target}/`);
      },
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
      "related PDP did not render after navigation",
    ).toBeVisible({ timeout: 30_000 });
  });

  test("P1-22: legacy /shop/{cat}/{slug} catch-all renders the same PDP", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/shop/apparel/${TEE}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Classic Tee" }),
      "legacy shop URL did not render the product PDP",
    ).toBeVisible({ timeout: 30_000 });
    // Same product surface: add-to-cart + the Description tab (classic-tee
    // has a seeded description).
    await expect(
      page.getByRole("button", { name: /add to cart|select options/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Description" }),
    ).toBeVisible();
  });

  test.fixme("P1-21 BLOCKED (app gap): recently-viewed rail appears after visiting 2 products", async ({
    page,
  }) => {
    // BLOCKER — dead code, see spec header: RecentlyViewed /
    // addToRecentlyViewed (recently-viewed.tsx) are exported but never
    // imported by any route or component, so no PDP visit ever writes
    // `hk-recently-viewed` and no page mounts the rail. Un-fixme once the
    // PDP records visits and renders <RecentlyViewed/>.
    await page.goto(`${BASE_URL}/products/test-product-12`);
    await page.goto(`${BASE_URL}/products/${TEE}`);
    await page.goto(`${BASE_URL}/products/test-product-11`);
    await expect(
      page.getByRole("heading", { name: "Recently Viewed" }),
    ).toBeVisible({ timeout: 20_000 });
  });
});
