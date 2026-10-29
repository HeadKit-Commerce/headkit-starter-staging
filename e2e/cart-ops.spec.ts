import { test, expect, request } from "@playwright/test";
import type { Page } from "@playwright/test";
import { BASE_URL, STORE_API, stackIsUp } from "./helpers";

/**
 * Cart operations end-to-end (autonomous QA run — Gap 4, P0-15/16/17/19).
 *
 * UI-DRIVEN cart lifecycle — unlike the Store-API seeding used by the checkout
 * specs, these tests click the real PDP add-to-cart button and drive the cart
 * drawer, proving the client → server-action → WooCommerce Store API cart pipe:
 *
 *   1. P0-15 simple-product add: PDP "Add to cart" opens the drawer ("Your
 *      Bag"), the header badge increments, and the line renders the right
 *      name + price.
 *   2. P0-17 drawer ops: + increments the line (line subtotal recomputes),
 *      − decrements. Removing the LAST item is a KNOWN BUG on this stack —
 *      see the test.fixme at the bottom (phantom cart line on silent failure).
 *   3. P0-19 persistence: a reload keeps the cart (the `hk-cart-token` cookie
 *      survives) — badge count and drawer line intact.
 *   4. P0-16 variable product: color+size swatch selection adds the CORRECT
 *      variation — asserted at the Store API layer (cart line variation
 *      attributes) via the browser's own `hk-cart-token` cookie.
 *
 * NOT covered here: the qty cap at stockQuantity (P0-17's cap clause) — the
 * seeded catalog manages no stock (product 678 max=9999), and mutating stock
 * on the SHARED local WP to create a capped fixture is forbidden
 * (additive-only seeding). Cap logic remains unit-level.
 *
 * PREREQUISITES (self-skips when the stack is down):
 *   - local Docker stack (WP :8090, gateway :4000, starter E2E_BASE_URL)
 *   - simple product `test-product-12` (id 678, $22) — storefront-parity seed
 *   - variable product `mens-crew-tee` with pa_color (Black/Navy/White) +
 *     pa_size (S/M/L/XL) — storefront-parity seed; override with
 *     E2E_VARIABLE_PRODUCT_SLUG.
 *
 * LOCAL-ONLY (HARD RULE): localhost Docker services only.
 */

const SIMPLE_SLUG = process.env.E2E_SIMPLE_PRODUCT_SLUG ?? "test-product-12";
const SIMPLE_NAME = "Test Product 12";
const VARIABLE_SLUG = process.env.E2E_VARIABLE_PRODUCT_SLUG ?? "mens-crew-tee";

/** The cart drawer (Radix Sheet) — scope all drawer assertions inside it. */
function drawer(page: Page) {
  return page.getByRole("dialog").filter({ hasText: "Your Bag" });
}

/**
 * The header cart badge (count bubble on the Cart icon button). NOTE: while
 * the drawer (a Radix modal Sheet) is open the page background is aria-hidden,
 * so role-based lookups on the header fail — use a CSS path and assert the
 * badge only while the drawer is CLOSED.
 */
/**
 * The VISIBLE cart trigger. Two exist in the DOM at every breakpoint (see
 * cartBadge), so an unscoped locator fails Playwright strict mode.
 */
function openCartTrigger(page: Page) {
  return page.locator('button[aria-label="Cart"]:visible');
}

function cartBadge(page: Page) {
  // TWO cart triggers exist by design and both sit in the DOM at all times:
  // HeaderActions (desktop) and CartTriggerButton inside a `md:hidden`
  // NavigationMenuItem (the mobile sticky cart). CSS hides one per breakpoint,
  // so an unscoped locator matches both and fails Playwright strict mode even
  // though the badge is correct in each. Scope to the visible one.
  return page.locator('button[aria-label="Cart"]:visible span');
}

/** Close the drawer (Radix Sheet closes on Escape). */
async function closeDrawer(page: Page) {
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toHaveCount(0);
}

test.describe("Cart ops: UI add-to-cart, drawer ops, persistence (Gap 4)", () => {
  test.beforeAll(async () => {
    test.skip(
      !(await stackIsUp()),
      "local stack down — bring up WP :8090 + gateway :4000 + starter (E2E_BASE_URL)",
    );
  });

  test("P0-15/P0-17/P0-19: PDP add opens the drawer; +/− recompute; reload persists", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE_URL}/products/${SIMPLE_SLUG}`);
    await expect(
      page.getByRole("button", { name: /^add to cart$/i }),
      `PDP for ${SIMPLE_SLUG} did not render an Add to cart button`,
    ).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: /^add to cart$/i }).click();

    // P0-15: drawer opens with the right line.
    await expect(
      drawer(page),
      "cart drawer did not open after add-to-cart",
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      drawer(page).getByText(SIMPLE_NAME).first(),
      "added product name missing from the drawer",
    ).toBeVisible();
    await expect(
      drawer(page).getByText("$22.00").first(),
      "line price missing/wrong in the drawer",
    ).toBeVisible();

    // P0-17: + increments — line subtotal doubles.
    await drawer(page)
      .getByRole("button", { name: "Increase quantity" })
      .click();
    await expect(
      drawer(page).getByText("$44.00").first(),
      "line subtotal did not recompute after increment",
    ).toBeVisible({ timeout: 15_000 });

    // − decrements back to 1.
    await drawer(page)
      .getByRole("button", { name: "Decrease quantity" })
      .click();
    await expect(
      drawer(page).getByText("$22.00").first(),
      "line subtotal did not recompute after decrement",
    ).toBeVisible({ timeout: 15_000 });

    // Badge asserts happen with the drawer CLOSED (modal aria-hides the bg).
    await closeDrawer(page);
    await expect(cartBadge(page), "header badge did not show 1").toHaveText(
      "1",
      { timeout: 15_000 },
    );

    // P0-19: reload — the hk-cart-token cookie survives; badge + line intact.
    await page.reload();
    await expect(
      cartBadge(page),
      "cart badge lost after reload — cart persistence (hk-cart-token) broken",
    ).toHaveText("1", { timeout: 20_000 });
    await openCartTrigger(page).click();
    await expect(
      drawer(page).getByText(SIMPLE_NAME).first(),
      "cart line lost after reload",
    ).toBeVisible({ timeout: 20_000 });
  });

  /**
   * KNOWN BUG (found by this suite, autonomous QA run 2026-07-18): removing
   * the LAST cart item frequently leaves the drawer showing a PHANTOM item.
   *
   * Evidence gathered while stabilising this spec:
   *   - Clicking the drawer's "Remove item": the WooCommerce cart empties
   *     (Store API `items_count: 0` within ~1s, verified via the browser's own
   *     hk-cart-token) but the drawer keeps rendering the removed line — no
   *     empty state, badge stays — until a full reload.
   *   - The `removeFromCart` gateway mutation intermittently errors with
   *     CART_SESSION_EXPIRED on a token that JUST added an item (transient
   *     Store API cart-session race on this shared local WP; the identical
   *     mutation succeeds on retry).
   *   - components/headkit-ui/cart-item.tsx handleRemove (~line 45-52) ignores
   *     a failed `removeCartItemAction` SILENTLY — no toast, no retry — so any
   *     transient failure strands the shopper with a stale cart UI even though
   *     the backend state may have changed.
   *
   * Fix direction: surface/retry the failure in CartItemRow (and re-fetch the
   * cart on failure), then flip this to a real test: remove last item →
   * "No products in your cart!" in the drawer + badge cleared.
   */
  test.fixme("KNOWN BUG: removing the last item can leave a phantom cart line (silent failure in CartItemRow.handleRemove)", async () => {
    // Blocked on the silent-failure fix described above.
  });

  test("P0-16: variable product — selected color+size lands the CORRECT variation in the WC cart", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    await page.goto(`${BASE_URL}/products/${VARIABLE_SLUG}`);
    await expect(
      page.getByRole("button", { name: /^add to cart$/i }),
      `PDP for ${VARIABLE_SLUG} did not render`,
    ).toBeVisible({ timeout: 30_000 });

    // Color click uses PATH-based routing: one extra `{color}` segment on the
    // product's own path. That base is whatever the store's WooCommerce
    // permalink produces — `/shop/{cat…}/{slug}` on a nested-permalink store,
    // `/products/{slug}` on the default `/product/` base, which `page.goto`
    // above has already 308'd onto — so the segment is asserted RELATIVE to it.
    // Hardcoding `/products/` passes only on the docker seed's default base and
    // goes red on exactly the stores the canonical routing targets.
    const basePath = new URL(page.url()).pathname.replace(/\/+$/, "");

    // .first(): related-product cards render their own swatch buttons with
    // the same accessible names — the PDP's own swatch group comes first.
    await page
      .getByRole("button", { name: "Navy", exact: true })
      .first()
      .click();
    await page.waitForURL(
      (url) => url.pathname.replace(/\/+$/, "") === `${basePath}/navy`,
      { timeout: 20_000 },
    );

    // Size is client-only state (persisted to localStorage, not the URL).
    await page.getByRole("button", { name: "M", exact: true }).first().click();

    await page.getByRole("button", { name: /^add to cart$/i }).click();
    await expect(
      drawer(page),
      "cart drawer did not open after variable add-to-cart",
    ).toBeVisible({ timeout: 20_000 });

    // Assert the actual WC cart line via the browser's own cart token.
    const cartToken =
      (await context.cookies()).find((c) => c.name === "hk-cart-token")
        ?.value ?? "";
    expect(cartToken, "no hk-cart-token cookie after add").not.toBe("");
    const api = await request.newContext();
    const cart = await (
      await api.get(`${STORE_API}/cart`, {
        headers: { "Cart-Token": cartToken },
      })
    ).json();
    await api.dispose();

    const items = (cart.items ?? []) as Array<{
      name?: string;
      variation?: Array<{ attribute?: string; value?: string }>;
    }>;
    expect(items.length, "WC cart is empty after variable add").toBeGreaterThan(
      0,
    );
    const line = items[0]!;
    const variation = (line.variation ?? [])
      .map((v) => `${v.attribute}:${v.value}`)
      .join(",")
      .toLowerCase();
    expect(
      variation,
      `cart line variation does not carry the selected color (got: ${variation})`,
    ).toContain("navy");
    expect(
      variation,
      `cart line variation does not carry the selected size (got: ${variation})`,
    ).toMatch(/size:m\b|:m$|,m,|\bm\b/);

    // The drawer shows the variation values too.
    await expect(
      drawer(page).getByText(/navy/i).first(),
      "drawer line does not display the selected color",
    ).toBeVisible();
  });
});
