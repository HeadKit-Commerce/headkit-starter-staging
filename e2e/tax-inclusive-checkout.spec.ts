import { test, expect, request } from "@playwright/test";
import {
  BASE_URL,
  installCartCookie,
  money,
  seedTaxedCart,
  stackIsUp,
} from "./helpers";

/**
 * The tax-inclusive guard for the CHECKOUT SUMMARY.
 *
 * WHY THIS IS A SEPARATE FILE FROM `tax-inclusive-display.spec.ts`
 * ---------------------------------------------------------------
 * This test loads `/checkout`, and `app/checkout/page.tsx` mints a Stripe
 * Checkout Session for any non-zero, non-offline-only cart — redirecting to
 * `/checkout?error=session_creation_failed` when commerce has no Stripe key. The taxed fixture is A$110, so this test cannot run without
 * `STRIPE_TEST_SECRET_KEY`, and CI treats a missing secret as an EXPECTED
 * state, not an error.
 *
 * So this file is listed in `.github/workflows/ci.yml`'s conditional
 * Stripe-absent ignore list, alongside `checkout-purchase` / `checkout-auth` /
 * `coupon` and the rest. Its two siblings — the anti-vacuous fixture check and
 * the cart-drawer assertions — deliberately stayed in
 * `tax-inclusive-display.spec.ts` and run UNCONDITIONALLY: the drawer is the
 * highest-value assertion in the whole guard (no tax row to reconcile against)
 * and the fixture check is what stops everything else passing vacuously.
 * Folding the whole spec into the ignore list would have taken both with it.
 *
 * Gating lives in the workflow, NOT in a `test.skip()` here. A spec that skips
 * itself when its dependency is absent reports green, which is the exact false
 * pass this suite has removed elsewhere — see ci.yml's own comments.
 *
 * WHAT IS ASSERTED
 * ----------------
 *   1. the checkout summary line renders `line_subtotal + line_subtotal_tax`;
 *   2. its tax row is labelled informationally ("Includes tax"), not as an
 *      addend, because the Subtotal row above it is now inclusive too;
 *   3. the bare ex-tax figure appears nowhere on the page.
 *
 * Every expected number is computed from the Store API response captured in the
 * same run — never a hard-coded literal. The fixture and its money shape come
 * from `seedTaxedCart` in `./helpers`, shared with the sibling spec.
 *
 * PREREQUISITES (self-skips only when the whole stack is down):
 *   - local Docker stack (WP :8090, gateway :4000, starter E2E_BASE_URL)
 *   - the taxed fixture from docker/wordpress/seed-tax.php
 *   - a Stripe TEST key on commerce
 *
 * LOCAL-ONLY (HARD RULE): localhost Docker services only; Stripe TEST mode only.
 */

test.describe("Tax-inclusive display: the checkout summary", () => {
  test.beforeAll(async () => {
    test.skip(
      !(await stackIsUp()),
      "local stack is down (WP :8090 / gateway :4000 / starter) — bring it up with scripts/e2e-ci-stack.sh",
    );
  });

  test("the checkout summary line and its Subtotal row both include the tax", async ({
    page,
    context,
  }) => {
    const api = await request.newContext();
    const { cartToken, line } = await seedTaxedCart(api);
    await api.dispose();

    await installCartCookie(context, cartToken);
    await page.goto(`${BASE_URL}/checkout`);

    const summary = page.getByText("Taxed Test Product").first();
    await expect(
      summary,
      "the checkout summary never rendered the taxed fixture's line",
    ).toBeVisible({ timeout: 30_000 });

    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    expect(
      body,
      `checkout summary line must show the tax-INCLUSIVE ${money(line.incTax)}`,
    ).toContain(money(line.incTax));

    // The Subtotal row is quoted on the same inclusive basis as the line rows
    // above it, so the whole breakdown reconciles: inclusive Subtotal +
    // inclusive Shipping == the inclusive Total, with the tax row beneath
    // reading "Includes tax" rather than as another addend.
    expect(
      body,
      `checkout summary must label its tax row informationally, not as an addend`,
    ).toContain("Includes tax");

    // The negative half, and the reason this page needed changing: while the
    // Subtotal row was ex-tax the summary showed BOTH numbers and neither the
    // rows nor the Total added up. The bare ex-tax figure now has no legitimate
    // place on this surface at all.
    expect(
      body,
      `checkout summary must NOT render the bare ex-tax figure ${money(line.exTax)} anywhere`,
    ).not.toContain(money(line.exTax));
  });
});
