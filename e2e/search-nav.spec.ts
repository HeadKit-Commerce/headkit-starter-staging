import { test, expect, request } from "@playwright/test";
import { BASE_URL, stackIsUp } from "./fixtures/helpers-2";

/**
 * Search + navigation e2e (autonomous QA run — E2E-GAPS.md Gap 9).
 *
 * Closes UAT rows P1-26, P1-27 (search drawer + /search results/no-results),
 * P1-28 (desktop submenu + the Radix trigger+link parent-navigation fix —
 * project memory: radix-navmenu-trigger-link-nav), P1-29 (mobile hamburger),
 * P1-30 (footer), P1-36 (/posts → /news), P1-39 (unknown slug → 404 UI).
 *
 * The two SEO nits observed while authoring this spec are both CLOSED, and the
 * status codes they were about are asserted elsewhere — this spec still covers
 * only the user-facing behaviour:
 *   - /posts now 308s to /news from `next.config.ts` `redirects()`, before any
 *     rendering (the `app/posts/page.tsx` that redirected client-side is gone).
 *     `lib/posts-path.test.ts` holds the invariant that keeps that redirect from
 *     inverting a store's own blog base into a loop.
 *   - An unknown slug now answers a real HTTP 404: `app/[...slug]/page.tsx`
 *     resolves the existence check above every boundary, where the status line
 *     is still settable. `e2e/not-found-status.spec.ts` asserts it over HTTP.
 *
 * PREREQUISITES: local Docker stack up (WP :8090, gateway :4000, starter —
 * E2E_BASE_URL) with the standard storefront-parity seeds (Men/Women/Bikes
 * WP menu, Classic Tee product). Self-skips when the stack is down.
 *
 * LOCAL-ONLY (HARD RULE): all endpoints are localhost Docker services.
 */

test.describe("Search + navigation (P1-26..P1-30, P1-36, P1-39)", () => {
  test.beforeAll(async () => {
    test.skip(
      !(await stackIsUp()),
      "local stack down — bring up WP :8090 + gateway :4000 + starter",
    );
  });

  test("P1-26/27: header search drawer finds a seeded product and routes to /search?q=", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/`);

    // Open the drawer from the header icon row.
    await page.getByRole("button", { name: "Search" }).first().click();
    const input = page.getByPlaceholder("Search products…");
    await expect(input, "search drawer did not open").toBeVisible({
      timeout: 15_000,
    });

    // Type a seeded product name — the drawer debounces then shows cards.
    await input.fill("Classic Tee");
    await expect(
      page.getByRole("heading", { name: "Classic Tee" }).first(),
      "drawer quick-results did not include the seeded product",
    ).toBeVisible({ timeout: 20_000 });

    // Submit via "View more results" → the full /search PLP.
    await page.getByRole("button", { name: /view more results/i }).click();
    await page.waitForURL(/\/search\?q=/, { timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: "Classic Tee" }).first(),
      "/search results page did not list the seeded product",
    ).toBeVisible({ timeout: 20_000 });
    // The server does not read `?q=` (#671), so the static shell is the bare
    // "Search" page; the query reaches the grid on mount, and the title is
    // rendered inside the grid's provider so it names the query and carries the
    // grid's own count.
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: 'Search results for "Classic Tee"',
      }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByText(/\d+ products? found for "Classic Tee"/),
      "the results title's count line is missing",
    ).toBeVisible();
    await expect(
      page.getByText(/Viewing \d+ of \d+ products/).first(),
      "the filtered grid's count line is missing",
    ).toBeVisible();
  });

  test("P1-26b: a second drawer search FROM /search replaces the grid and the title", async ({
    page,
  }) => {
    // `/search?q=a` -> `/search?q=b` is a soft navigation onto the same static
    // page: nothing React renders changes, so the grid used to keep the first
    // query's products under the old URL. `SearchQueryRemount` is what notices.
    await page.goto(
      `${BASE_URL}/search?q=${encodeURIComponent("Classic Tee")}`,
    );
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: 'Search results for "Classic Tee"',
      }),
    ).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "Search" }).first().click();
    const input = page.getByPlaceholder("Search products…");
    await expect(input, "search drawer did not open").toBeVisible({
      timeout: 15_000,
    });
    await input.fill("Wool Beanie");
    await expect(
      page.getByRole("heading", { name: "Wool Beanie" }).first(),
      "drawer quick-results did not include the second seeded product",
    ).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /view more results/i }).click();
    await page.waitForURL(/\/search\?q=Wool/, { timeout: 20_000 });

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: 'Search results for "Wool Beanie"',
      }),
      "the title did not follow the soft navigation",
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: "Wool Beanie" }).first(),
      "the grid did not follow the soft navigation",
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: "Classic Tee" }),
      "the previous query's product is still in the grid",
    ).toHaveCount(0);
  });

  test("P1-27: junk query shows the no-results state (drawer AND /search page)", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/`);
    await page.getByRole("button", { name: "Search" }).first().click();
    const input = page.getByPlaceholder("Search products…");
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill("zzzqqq-no-such-product-xyz");
    await expect(
      page.getByText(/No products found for/i),
      "drawer did not show the no-results copy for a junk query",
    ).toBeVisible({ timeout: 20_000 });

    // Direct deep-link to the search PLP with the same junk query.
    await page.goto(`${BASE_URL}/search?q=zzzqqq-no-such-product-xyz`);
    await expect(
      page.getByText(/No products found/i).first(),
      "/search page did not render its empty state for a junk query",
    ).toBeVisible({ timeout: 20_000 });
  });

  test("P1-28: desktop nav — parent item WITH children opens the panel and does NOT navigate", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/`);

    // "Men" is a seeded WP menu item WITH children. A parent that has a panel
    // renders as Radix's own <button>, so a click only opens the panel — the
    // regression that guards: a WordPress mega-menu parent whose Custom Link
    // URI collapses to `/` used to throw the shopper to the home page on the
    // way to the menu. The parent's own destination lives inside the panel as
    // its first entry ("View all Men").
    const menTrigger = page
      .locator("nav button[aria-expanded]")
      .filter({ hasText: /^Men$/ })
      .first();
    await expect(
      menTrigger,
      "the seeded 'Men' parent menu item (with children) is not a nav dropdown button",
    ).toBeVisible({ timeout: 15_000 });
    expect(
      await menTrigger.getAttribute("href"),
      "a dropdown parent must carry no href for the browser to follow",
    ).toBeNull();

    const before = page.url();
    await menTrigger.click();
    await expect
      .poll(async () => menTrigger.getAttribute("aria-expanded"), {
        message: "clicking the Men trigger did not open its panel",
        timeout: 15_000,
      })
      .toBe("true");
    expect(page.url(), "clicking a dropdown parent navigated").toBe(before);

    const panelId = await menTrigger.getAttribute("aria-controls");
    expect(panelId, "trigger has no aria-controls panel id").toBeTruthy();
    const viewAll = page
      .locator(`#${panelId} a[href^="/collections/men"]`)
      .first();
    await expect(
      viewAll,
      "the parent's own destination is not reachable inside the panel",
    ).toBeVisible({ timeout: 10_000 });
    await viewAll.click();
    await page.waitForURL(/\/collections\/men/, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/collections\/men/);
  });

  test("P1-28: desktop submenu opens on hover and a child link navigates", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/`);

    const womenTrigger = page
      .locator("button[aria-expanded]")
      .filter({ hasText: /^Women$/ })
      .first();
    await expect(womenTrigger).toBeVisible({ timeout: 15_000 });
    await womenTrigger.hover();

    // The mega-menu content panel opens (trigger flips to expanded) and
    // carries at least one child link; clicking it navigates.
    await expect
      .poll(async () => womenTrigger.getAttribute("aria-expanded"), {
        message: "hovering the Women trigger did not open its submenu",
        timeout: 15_000,
      })
      .toBe("true");
    const panelId = await womenTrigger.getAttribute("aria-controls");
    expect(panelId, "trigger has no aria-controls panel id").toBeTruthy();
    const childLink = page.locator(`#${panelId} a[href^="/"]`).first();
    await expect(childLink, "open submenu contains no child links").toBeVisible(
      { timeout: 10_000 },
    );
    const childHref = await childLink.getAttribute("href");
    await childLink.click();
    await page.waitForURL((url) => url.pathname === childHref, {
      timeout: 20_000,
    });
  });

  test("P1-29: mobile hamburger menu opens and a link navigates", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/`);

    await page.getByRole("button", { name: "Open menu" }).click();
    // Childless top-level items ("Shop") render as plain links in the sheet.
    // `:visible` alone is NOT enough: the FOOTER also carries a visible /shop
    // anchor, and it is the one this used to match — the open sheet then
    // intercepts the click ("subtree intercepts pointer events"). Scope to the
    // dialog so only the sheet's own link can match.
    const shopLink = page
      .getByRole("dialog")
      .locator('a[href="/shop"]')
      .filter({ hasText: /^Shop$/i })
      .first();
    await expect(
      shopLink,
      "mobile menu sheet did not open / Shop link absent",
    ).toBeVisible({ timeout: 15_000 });
    await shopLink.click();
    await page.waitForURL(/\/shop/, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/shop/);
  });

  test("P1-30: footer renders with links", async ({ page }) => {
    await page.goto(`${BASE_URL}/`);
    const footer = page.locator("footer");
    await expect(footer, "no <footer> rendered").toBeVisible({
      timeout: 15_000,
    });
    // The local seed carries no WP footer menus, so the guaranteed content is
    // the social row; assert the footer is populated rather than an empty
    // shell.
    const linkCount = await footer.locator("a[href]").count();
    expect(linkCount, "footer rendered zero links").toBeGreaterThan(0);
    // The newsletter block is NOT guaranteed: layout.tsx gates it on
    // `emailMarketing.enabled` (showFooterSubscribe), which the local stack
    // does not turn on. Asserting it here made a config-dependent feature look
    // like a footer invariant. Covering it needs its own spec that enables the
    // config first — tracked rather than asserted conditionally, because an
    // if-present assertion passes silently when the feature disappears.
  });

  test("P1-36: /posts lands on /news (legacy blog URL kept working)", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/posts`);
    // Under Cache Components the redirect streams client-side (HTTP status
    // stays 200 — flagged as an SEO nit in the spec header); the user-facing
    // contract is that /posts always ends up on /news.
    await page.waitForURL(/\/news/, { timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: "News" }).first(),
      "/posts did not land on the /news list",
    ).toBeVisible({ timeout: 20_000 });
  });

  test("P1-39: unknown slug renders the 404 not-found page", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/definitely-not-a-page-e2e-xyz`);
    await expect(
      page.getByText("404").first(),
      "unknown slug did not render the 404 UI",
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: /page not found/i }),
    ).toBeVisible();
    // Recovery path back into the catalog.
    await expect(
      page.getByRole("link", { name: /back to home/i }),
    ).toBeVisible();

    // Record the raw HTTP status for the QA report. Still an observation here,
    // not an assertion: `e2e/not-found-status.spec.ts` is what fails on the
    // status, across every route family and in both directions.
    const api = await request.newContext();
    const res = await api.get(`${BASE_URL}/definitely-not-a-page-e2e-xyz`);
    test.info().annotations.push({
      type: "observation",
      description: `unknown-slug HTTP status = ${res.status()} (404 expected for crawlers; 200 = Cache Components streamed-shell soft-404)`,
    });
    await api.dispose();
  });
});
