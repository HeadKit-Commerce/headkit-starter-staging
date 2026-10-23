import {
  test,
  expect,
  request,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  BASE_URL,
  WP_BASE_URL,
  GATEWAY_URL,
  STORE_KEY,
  STORE_API,
  stackIsUp,
} from "./helpers";

/**
 * WooCommerce Product Add-Ons end-to-end — the plugin-ABSENT half (phase 14.1,
 * plan 14.1-09). This file is the PAO-04 gate.
 *
 * PAO-04 is the one requirement in this phase that no amount of careful
 * implementation can satisfy. Every layer claims to degrade cleanly — the theme
 * omits a key behind a `class_exists`, the mapper turns a missing key into an
 * empty list, the schema types the field `[ProductAddon!]!` with an empty
 * default, `ProductAddons` returns `null` for an empty list and its call site
 * guards on length so not even a margin enters the DOM. Each claim is tested at
 * the layer that made it. None of that is evidence that the COMPOSITION
 * degrades cleanly. Only a completed run with the plugin deactivated is.
 *
 * ---------------------------------------------------------------------------
 * THE FALSE-PASS GUARD — read this before changing a fixture
 * ---------------------------------------------------------------------------
 *
 * This gate is unusually easy to fake, and this phase has already been bitten by
 * both mechanisms:
 *
 * 1. A SELF-SKIPPING SUITE. `gift-card.spec.ts`'s health-probe convention skips
 *    when its prerequisite is missing. That is right for a paid gift-card code
 *    CI cannot provision and WRONG here: a spec whose fixture is reachable only
 *    BECAUSE the plugin is active will skip every assertion on exactly the run
 *    that was meant to falsify it, and report green. So:
 *
 *      - The ONLY skip in this file gates on the stack being reachable at all
 *        (`stackIsUp()`), exactly as `product-addons.spec.ts` does. There is no
 *        skip in any add-on assertion path. An unmet precondition FAILS.
 *      - The seeded fixtures are ORDINARY PURCHASABLE PRODUCTS. They resolve,
 *        render and add to cart for reasons that have nothing to do with their
 *        add-ons, so every assertion below runs in BOTH plugin states. Do not
 *        later turn a fixture into an add-on-only product: that silently
 *        disarms this gate.
 *      - The harness compares this run's total case count against the
 *        plugin-active run's. A silent skip shows up as a smaller number.
 *
 * 2. A RANDOM DISCRIMINATOR. `scripts/verify-pao-plugin-absence.sh` exists
 *    because the original payload diff failed on `.related`, which
 *    `wc_get_related_products()` orders by `RAND()` — it passed or failed at
 *    random (14.1-01). Nothing here diffs a whole payload; every assertion below
 *    names the property it measures.
 *
 * And element absence alone cannot see a ZERO-HEIGHT WRAPPER: a container with
 * no children satisfies every `not.toBeVisible()` check while still occupying
 * the DOM and the layout. Assertion 3 is therefore a measured number
 * (UI-SPEC Checker Sign-Off recommendation 2), not a presence check.
 *
 * ---------------------------------------------------------------------------
 * WHICH CASES DISCRIMINATE, AND WHICH ARE INVARIANTS
 * ---------------------------------------------------------------------------
 *
 * Stated plainly so nobody reads a green run as more than it is. Run this file
 * with the plugin ACTIVE and these FAIL — they are the gate:
 *
 *   - `the product endpoint omits the addons key`      (key is present)
 *   - `the gateway returns an empty list`              (5 groups come back)
 *   - `no add-on element renders on any PDP`           (groups render)
 *   - `no heading divider`                             (the divider renders)
 *   - `the variation block is adjacent to availability`(the form sits between)
 *   - `an add-on fixture is an ordinary product`       (bare add-item 400s on a
 *                                                       required group)
 *   - `an order from an unconfigured fixture`          (same 400)
 *   - `an add-on fixture's cart line matches a plain line` (same 400 — the cart
 *                                                       cannot even be seeded)
 *   - `both order surfaces match`                      (same 400, via the
 *                                                       in-run order)
 *   - `the console is clean` (same 400, via the in-run order)
 *
 * ---------------------------------------------------------------------------
 * NO RECORDED CONSTANT IS AN ASSERTION HERE
 * ---------------------------------------------------------------------------
 *
 * Three cases used to compare against values measured on one machine — a
 * `sha256(outerHTML)` prefix, two pixel heights, an order id and key, and two
 * verbatim console strings. All five described the authoring stack rather than
 * the property under test, and all five failed on CI while passing locally
 * (run 31788350275). They now derive their baseline IN THE SAME RUN as the
 * assertion:
 *
 *   - the cart and order line shapes are compared against a PLAIN product's
 *     line rendered beside them on the same surface;
 *   - the order is PLACED by the run and carries both products;
 *   - console messages are tolerated by CLASS, never by recorded text.
 *
 * None of them is gated on an "only run locally" flag: that would be the
 * self-skipping hole above wearing a different hat, and CI would go green
 * measuring nothing.
 *
 * ---------------------------------------------------------------------------
 * THE ACCOUNT SURFACE IS BEHIND A COOKIE THE APP ITSELF DELETES
 * ---------------------------------------------------------------------------
 *
 * Two order surfaces are asserted, and one of them is route-guarded. The guard
 * checks only that `hk-auth-token` is PRESENT on the request, while the root
 * layout's `AuthProvider` deletes that same cookie on every page load because
 * the value this spec uses is not a real JWT. Any app page loaded first
 * therefore disarms the guard for the next one, on a timer nothing here
 * controls — the cause of PAO-04 (8/10) failing CI on PRs that changed nothing.
 * Reach an `/account/...` URL through `gotoAccountSurface` and nowhere else;
 * its docblock carries the mechanism and the measurement.
 *
 * ---------------------------------------------------------------------------
 * UI-SPEC "Absent-Plugin Contract (PAO-04)" — the five assertions, mapped
 * ---------------------------------------------------------------------------
 *
 *   1. No group name, `*` marker, "Your selection" panel, "Options" panel
 *      anywhere → `endpoint and gateway` case 3; `cart, order and account` all.
 *   2. No `<hr>`/divider only a `type: heading` entry produces → case 4.
 *   3. The PDP rhythm between the variation block and the availability row is
 *      unchanged, asserted as computed spacing → case 5.
 *   4. Zero console warnings or errors → case 10.
 *   5. `AddonDetails` renders nothing on every cart, checkout and confirmation
 *      line → cases 6, 7, 8, 9; plus the wire contract in cases 1 and 2.
 *
 * THE ONE UNREACHABLE SURFACE. The checkout summary is not observable on this
 * stack and was not for 14.1-06 or 14.1-07 either: `/checkout` mints a Stripe
 * Checkout Session during SSR and commerce holds `sk_test_…placeholder`, so it
 * 307s to `/checkout?error=session_creation_failed`; the documented free-cart branch returns BEFORE the
 * `{checkoutSession ? …}` block that holds `<Cart>`. Rather than a `test.fixme`
 * — a skip by another name in a file whose central prohibition is that nothing
 * self-skips — it is stated here as a recorded environment gap. The summary line
 * IS `LineItemDisplay`, whose no-add-on shape is asserted below on two other
 * surfaces and whose call site `line-item-display.test.tsx` pins. A real
 * `sk_test_` key on commerce is the prerequisite (14.1-06 deferred item 5).
 *
 * LOCAL-ONLY (HARD RULE): every endpoint is a localhost Docker service. This
 * spec places real orders on the LOCAL store, which is what an order-surface
 * assertion is: one shared two-line order for the order surfaces (cases 8 and
 * 10) and one single-line order for case 9's wire read.
 *
 * THIS SPEC MUTATES NO PLUGIN STATE. It never activates, deactivates or
 * configures a WordPress plugin and contains no shell escape. Taking the plugin
 * offline is `e2e/run-plugin-absent-suite.sh`'s job, because that action needs a
 * restore trap registered before it and this file must stay runnable in both
 * states.
 *
 * PREREQUISITES: the stack up, `docker/wordpress/seed-product-addons.php`
 * applied, and — for the gate run only — Product Add-Ons DEACTIVATED by the
 * harness.
 */

// ---------------------------------------------------------------------------
// Fixtures, baselines and recorded constants
// ---------------------------------------------------------------------------

/** The five seeded add-on fixtures (14.1-01 task 2, extended by 14.1-07). */
const PACKAGE_SLUG = process.env.HK_ADDONS_PACKAGE_SLUG ?? "glam-booth-package";
const ALL_TYPES_SLUG =
  process.env.HK_ADDONS_ALL_TYPES_SLUG ?? "glam-booth-all-types";
const FILE_UPLOAD_SLUG =
  process.env.HK_ADDONS_FILE_UPLOAD_SLUG ?? "glam-booth-file-upload";
const VARIABLE_SLUG =
  process.env.HK_ADDONS_VARIABLE_SLUG ?? "glam-booth-variable";
const HIDDEN_FIRST_SLUG =
  process.env.HK_ADDONS_HIDDEN_FIRST_SLUG ?? "glam-booth-hidden-first";

/**
 * Every seeded fixture, with one group NAME each that the PDP would render if
 * the plugin were present. The name is asserted ABSENT — UI-SPEC assertion 1's
 * "no add-on group name" — and a name is used rather than an id because a name
 * is what a shopper would see.
 */
const FIXTURES: ReadonlyArray<{ slug: string; groupName: string }> = [
  { slug: PACKAGE_SLUG, groupName: "Backdrop Design" },
  { slug: ALL_TYPES_SLUG, groupName: "Choose Your Session" },
  { slug: FILE_UPLOAD_SLUG, groupName: "Upload Your Artwork" },
  { slug: VARIABLE_SLUG, groupName: "Booth Extras" },
  { slug: HIDDEN_FIRST_SLUG, groupName: "Print Add-Ons" },
];

/**
 * The plain, add-on-incapable product every line-shape comparison is made
 * against. Its slug is env-driven because `scripts/e2e-ci-stack.sh seed-env`
 * publishes it (`E2E_SIMPLE_PRODUCT_SLUG`), and its id is READ BACK from the
 * slug rather than configured separately — an id and a slug supplied by two
 * different sources can disagree, and on a stack where they do the comparison
 * would silently be against the wrong product.
 */
const PLAIN_PRODUCT_SLUG =
  process.env.E2E_SIMPLE_PRODUCT_SLUG ?? "test-product-12";

/**
 * THE LINE ROOT, AND WHY ITS SHAPE IS THE WHOLE CLAIM.
 *
 * The line root is `div[class="space-y-1.5"]` — an EXACT class match, because
 * `quote-cart-items.tsx` also uses `space-y-1.5` inside a longer string. Both
 * `line-item-display.tsx` and `cart-item.tsx` render `<AddonDetails>` as a
 * DIRECT CHILD of that root, guarded on `addons.length > 0`. So with the plugin
 * absent the root has exactly one child — the content row — and its height is
 * exactly that row's height.
 *
 * `space-y-1.5` applies a 6px `margin-top` from the SECOND child onward, so an
 * empty wrapper raises the root's height by 6px and its child count by one
 * while remaining invisible to any `not.toBeVisible()` check. The child count
 * and the root-vs-first-child height comparison are what see it.
 *
 * WHY NOT A RECORDED CONSTANT. Plans 14.1-06 and 14.1-09 pinned these to
 * numbers and a `sha256(outerHTML)` prefix measured on one machine. A markup
 * hash is a property of the build, the image URLs and the price formatting, not
 * of add-on absence: CI renders the same product at the same price and produces
 * a different hash, so the assertion could only ever pass where it was
 * recorded. Every baseline below is therefore derived IN THE SAME RUN as the
 * assertion — an add-on fixture's line is compared against a plain product's
 * line rendered beside it. "These two are identical" is the real claim and it
 * travels; "this equals a number I wrote down" is not and does not.
 */

/**
 * The PDP variation block's bottom margin: `mb-5` = 20px. UI-SPEC's Dimension-5
 * flag names this value explicitly as an off-scale exception that exists
 * BECAUSE it byte-matches the existing variation/gift-card block margin — which
 * is exactly what PAO-04 requires. Measured live at 20px on
 * `glam-booth-variable` with the plugin active (the block itself is unchanged
 * by the plugin; what changes is what sits after it).
 */
const VARIATION_BLOCK_MARGIN_PX = 20;
const VARIATION_BLOCK_CLASS = "mb-5 flex flex-col gap-4";

/**
 * The gateway the one order this spec places goes through. `headkit-quote` is
 * what plan 14.1-07 measured as available on this store; `cod` is NOT enabled
 * here and returns `woocommerce_rest_checkout_payment_method_disabled` — which
 * this spec was written with and caught on its own first deactivated run.
 */
const PAY_METHOD = process.env.PAO_WEDGE_PAYMENT_METHOD ?? "headkit-quote";

/** The billing/shipping address used for the one order this spec places. */
const AU_ADDRESS = {
  first_name: "Absent",
  last_name: "Gate",
  address_1: "1 Test Parade",
  city: "Sydney",
  state: "NSW",
  postcode: "2000",
  country: "AU",
  email: "absent-gate@example.com",
  phone: "0400000000",
} as const;

/**
 * Console messages tolerated BY CLASS — each one a property of the environment
 * (the Next build shape, the browser's own resource heuristics, a placeholder
 * key on commerce) rather than of the storefront's add-on behaviour.
 *
 * WHY A CLASS AND NOT A RECORDED STRING. This list previously held the two
 * exact messages plan 14.1-06 observed on one machine, which made the case a
 * measurement of that machine: CI emits a THIRD message — Chromium's
 * "…was preloaded using link preload but not used…" warning naming a
 * content-hashed chunk (`_next/static/chunks/34hz8f-pmjcmi.css`) — whose text
 * changes with every build. Tolerating that message by name would be
 * unmaintainable; tolerating its class is honest, because the class cannot
 * express anything about add-ons.
 *
 * WHAT IS DELIBERATELY NOT HERE, so this stays a gate rather than a rubber
 * stamp: React/hydration errors, uncaught page errors (`pageerror:` is never
 * matched by any entry below — see `unexplainedConsole`), failed requests, and
 * ANY message mentioning add-ons, which case 10 fails on separately and
 * unconditionally.
 *
 * Never add an entry to make a run green. Add one only when the message is
 * provably environmental — name what emits it and why it cannot carry add-on
 * information.
 */
const ENVIRONMENT_CONSOLE: ReadonlyArray<{ pattern: RegExp; why: string }> = [
  {
    pattern: /uncached data during prerendering/i,
    why: 'Next 16 Cache Components warning on Route "/account/orders/[orderId]" — present at the pre-phase baseline commit (14.1-06 § Console cleanliness)',
  },
  {
    pattern: /\[HeadKit\] GraphQL error/i,
    why: "logged when /checkout fails to mint a Stripe session — commerce holds a placeholder key (14.1-06 deferred item 5)",
  },
  {
    pattern:
      /was preloaded using link preload but not used within a few seconds/i,
    why: "Chromium's own preload heuristic firing on a content-hashed Next chunk. The chunk name differs per build, so this is a property of the bundle split, not of the page's behaviour (observed on CI run 31788350275, absent locally)",
  },
];

// ---------------------------------------------------------------------------
// Helpers — every one of them THROWS rather than skipping
// ---------------------------------------------------------------------------

/**
 * Read a seeded fixture's raw `headkit/v2` payload.
 *
 * A 404 is a SEED REGRESSION and fails, naming the seed file. Unlike
 * `product-addons.spec.ts`'s `readFixture`, this one does NOT require an
 * `addons` key — its absence is the thing under test. It DOES require the
 * product to resolve, which is the false-pass guard: the fixture is reachable
 * for reasons unrelated to its add-ons.
 */
async function readProduct(
  api: APIRequestContext,
  slug: string,
): Promise<Record<string, unknown>> {
  const url = `${WP_BASE_URL}/wp-json/headkit/v2/products/slug/${slug}`;
  const res = await api.get(url);
  if (!res.ok()) {
    throw new Error(
      `add-on fixture "${slug}" is not in the local catalogue (HTTP ${res.status()} from ${url}). ` +
        `This is a SEED REGRESSION, not a reason to skip: re-run ` +
        `docker/wordpress/seed-product-addons.php (see its header for the two documented invocations).`,
    );
  }
  const body = (await res.json()) as Record<string, unknown>;
  if (!body.id || !body.name) {
    throw new Error(
      `fixture "${slug}" resolved but carries no id/name — the payload is not a product. ` +
        `Assertions here would be vacuous, so this fails.`,
    );
  }
  return body;
}

/** POST a query to the Hive gateway with the local store key. Throws on a transport failure. */
async function gateway(
  api: APIRequestContext,
  query: string,
): Promise<{ raw: string; json: Record<string, unknown> }> {
  const res = await api.post(GATEWAY_URL, {
    headers: { "content-type": "application/json", "x-headkit-key": STORE_KEY },
    data: { query },
  });
  const raw = await res.text();
  if (!res.ok()) {
    throw new Error(
      `gateway ${GATEWAY_URL} returned HTTP ${res.status()} — is the local Hive gateway up? Body: ${raw.slice(0, 300)}`,
    );
  }
  return { raw, json: JSON.parse(raw) as Record<string, unknown> };
}

/** Mint a fresh Store API cart session and return its Cart-Token. */
async function mintCartToken(api: APIRequestContext): Promise<string> {
  const boot = await api.get(`${STORE_API}/cart`);
  expect(
    boot.status(),
    `WooCommerce Store API unreachable at ${WP_BASE_URL} — is the local WP stack up?`,
  ).toBe(200);
  const token = boot.headers()["cart-token"] ?? "";
  expect(token, "Store API did not return a Cart-Token header").not.toBe("");
  return token;
}

/**
 * Add a product with NO `addons_configuration` at all — the request a shopper's
 * browser makes on a store that has never heard of add-ons.
 *
 * Returns the store's own status and body rather than asserting, so the caller
 * can state what a rejection MEANS. With the plugin active this returns 400
 * `woocommerce_rest_cart_invalid_product_addons` for any fixture carrying a
 * required group, which is precisely why the cases that use it discriminate.
 */
async function bareAddItem(
  api: APIRequestContext,
  token: string,
  productId: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await api.post(`${STORE_API}/cart/add-item`, {
    headers: { "Content-Type": "application/json", "Cart-Token": token },
    data: { id: productId, quantity: 1 },
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status(), body };
}

/** The cart drawer (Radix Sheet) — scope every drawer assertion inside it. */
function drawer(page: Page) {
  return page.getByRole("dialog").filter({ hasText: "Your Bag" });
}

/**
 * The add-on selection panel `addon-details.tsx` renders. Its class string is
 * byte-identical to `gift-card-details.tsx`'s, so the `Options` heading is what
 * distinguishes the two — a gift-card line must keep rendering its own panel.
 */
function addonPanel(scope: Page | ReturnType<typeof drawer>) {
  return scope
    .locator("div.rounded-\\[3px\\].bg-primary\\/5")
    .filter({ hasText: "Options" });
}

interface LineRootMeasurement {
  height: string;
  firstChildHeight: string;
  children: number;
  childClasses: string[];
  text: string;
}

/**
 * Measure every line root on the page. Nothing here is compared to a stored
 * number: the measurements are compared to EACH OTHER, so every quantity is one
 * this run produced.
 *
 * `childClasses` is the direct-child class list, which is exactly where
 * `<AddonDetails>` (and `<GiftCardDetails>`) mount. `firstChildHeight` is the
 * content row's own height, so `height === firstChildHeight` states "the root
 * adds no vertical space beyond its one row" without naming a pixel count.
 *
 * IT WAITS FOR THE DOM TO SETTLE FIRST, AND THAT IS NOT A GRACE PERIOD. Under
 * Cache Components the order surfaces stream: React delivers the dynamic hole
 * inside a `<div hidden>` and then MOVES it into place. Sampled at frame rate on
 * the account order detail, the sequence is
 *
 *     0-185ms   0 roots
 *     196-212ms 2 roots, both inside `[hidden]`  (delivered, not yet placed)
 *     244-362ms 4 roots, 2 inside `[hidden]`     (placed, copy not yet dropped)
 *     372ms+    2 roots, none hidden             (settled)
 *
 * Measuring inside that ~120ms window reads the transport rather than the page:
 * `roots.length` doubles, and a hidden root measures 0px tall, which is also the
 * signature `expectNoExtraLineContent` looks for. The visibility assertion ahead
 * of the call does not exclude it — one placed copy being visible is exactly
 * what the middle row above describes. So `measureLineRoots` waits on the
 * CONDITION that ends the window (every root placed) rather than on a duration,
 * and on the cart drawer — which never streams — the condition already holds and
 * nothing waits.
 *
 * The 15s bound below is NOT what removes the race — the condition is. It exists
 * only because `page.waitForFunction` has no default timeout (and this config
 * sets no `actionTimeout` and calls no `setDefaultTimeout`), so without it the
 * `.catch` fall-through is unreachable and a page that never satisfies the
 * condition — zero roots, or one permanently under `[hidden]` — hangs to the
 * case's own `test.setTimeout` and reports a bare Playwright timeout instead of
 * the caller's assertion. 15s is an order of magnitude past the 372ms settle
 * point above, so it cannot function as a grace period that masks the streaming
 * window, and far below every case ceiling here (120s/180s/240s), so an expiry
 * still leaves the caller room to measure and fail with what it found.
 */
async function measureLineRoots(page: Page): Promise<LineRootMeasurement[]> {
  await page
    .waitForFunction(
      () => {
        const roots = document.querySelectorAll('div[class="space-y-1.5"]');
        return (
          roots.length > 0 && ![...roots].some((el) => el.closest("[hidden]"))
        );
      },
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => undefined);

  return page.evaluate(() =>
    [...document.querySelectorAll('div[class="space-y-1.5"]')].map((el) => {
      const first = el.firstElementChild;
      return {
        height: (el as HTMLElement).getBoundingClientRect().height.toFixed(2),
        firstChildHeight: first
          ? (first as HTMLElement).getBoundingClientRect().height.toFixed(2)
          : "no first child",
        children: el.children.length,
        childClasses: [...el.children].map(
          (c) => c.getAttribute("class") ?? "",
        ),
        text: (el.textContent ?? "").trim().slice(0, 60),
      };
    }),
  );
}

/**
 * Pick the measured line root belonging to a named product.
 *
 * THROWS rather than returning undefined: a line that cannot be found is an
 * unrendered line, which is a failure, not a reason to assert less.
 */
function lineFor(
  roots: readonly LineRootMeasurement[],
  productName: string,
  where: string,
): LineRootMeasurement {
  const wanted = foldLabel(productName);
  const hit = roots.find((r) => foldLabel(r.text).includes(wanted));
  if (!hit) {
    throw new Error(
      `${where}: no line root rendered for "${productName}". Measured ${roots.length} root(s): ` +
        roots.map((r) => `"${r.text}"`).join(", "),
    );
  }
  return hit;
}

/**
 * A line root carries its one content row and NOTHING else, and occupies no
 * more height than that row does. This is the zero-height-wrapper check, and it
 * is self-referential — the row it compares against is the row it contains.
 */
function expectNoExtraLineContent(
  actual: LineRootMeasurement,
  where: string,
): void {
  expect(
    actual.children,
    `${where}: the line root has ${actual.children} children (expected 1: the content row). ` +
      `<AddonDetails> mounts as a DIRECT CHILD of this root, and a wrapper with no content ` +
      `passes every presence check while adding a 6px space-y margin — this count is what ` +
      `sees it. Child classes: ${JSON.stringify(actual.childClasses)}. Line text: ${actual.text}`,
  ).toBe(1);
  expect(
    actual.height,
    `${where}: the line root is ${actual.height}px tall but its content row is only ` +
      `${actual.firstChildHeight}px — something is taking vertical space inside the line ` +
      `without being visible content. Line text: ${actual.text}`,
  ).toBe(actual.firstChildHeight);
}

/**
 * THE PORTABLE FORM OF PAO-04's "unchanged rhythm" CLAIM. An add-on fixture's
 * line and a plain product's line, rendered side by side in the SAME run on the
 * SAME surface, are indistinguishable in shape: same direct children, same
 * classes on them, same height.
 *
 * Both baselines come out of this run, so the assertion means the same thing on
 * every machine — which a recorded pixel count and a markup hash did not.
 */
function expectSameLineShape(
  addonLine: LineRootMeasurement,
  plainLine: LineRootMeasurement,
  where: string,
): void {
  expect(
    addonLine.childClasses,
    `${where}: the add-on fixture's line is built differently from the plain product's line ` +
      `rendered beside it. With the plugin absent the two must be indistinguishable. ` +
      `Add-on line: "${addonLine.text}"; plain line: "${plainLine.text}"`,
  ).toEqual(plainLine.childClasses);
  expect(
    addonLine.height,
    `${where}: the add-on fixture's line is ${addonLine.height}px tall while the plain ` +
      `product's line beside it is ${plainLine.height}px. With the plugin absent nothing ` +
      `distinguishes the two products, so nothing may distinguish their lines`,
  ).toBe(plainLine.height);
}

/** Attach console + pageerror collection to a page. Returns the live list. */
function collectConsole(page: Page): string[] {
  const noise: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      noise.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => noise.push(`pageerror: ${err.message}`));
  return noise;
}

/**
 * Drop everything the environment-noise classes explain; whatever is left is a
 * failure.
 *
 * An uncaught page error is NEVER explained away, whatever its text happens to
 * match — a thrown exception is a defect by construction, and letting a
 * tolerated substring inside one silence it is exactly how an allowlist rots
 * into a rubber stamp.
 */
function unexplainedConsole(noise: readonly string[]): string[] {
  return noise.filter(
    (line) =>
      line.startsWith("pageerror:") ||
      !ENVIRONMENT_CONSOLE.some((e) => e.pattern.test(line)),
  );
}

/**
 * Fold an attribute label to a comparable token.
 *
 * The `headkit/v2` payload publishes the variation attribute as its slug
 * (`booth-size`) while the PDP renders the humanised label (`Booth Size`), so a
 * raw `toContain` between the two is always false. Measured, not assumed — the
 * two forms were read off the live endpoint and the live DOM.
 */
function foldLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** A browser context carrying a cart token, and optionally the account cookie. */
async function contextWith(
  context: BrowserContext,
  cookies: ReadonlyArray<{ name: string; value: string }>,
): Promise<void> {
  await context.addCookies(
    cookies.map((c) => ({ name: c.name, value: c.value, url: BASE_URL })),
  );
}

/**
 * The value the account cookie carries here. Deliberately not a JWT: the route
 * guard this spec relies on tests for PRESENCE only, and minting a real session
 * would make an order-surface assertion depend on seeded credentials.
 */
const PRESENCE_ONLY_AUTH_TOKEN = "pao-04-presence-only";

/** Where `proxy.ts` sends a request for a private account path with no cookie. */
const ACCOUNT_LOGIN_PATH = "/account";

/**
 * Navigate to an `/account/...` surface, re-establishing the presence-only
 * cookie in the same step, and prove the request LANDED there.
 *
 * WHY THIS IS NOT A BARE `page.goto`. Two components read the same cookie and
 * disagree about what an unverifiable value means:
 *
 *   - `proxy.ts` (`isPrivateAccountPath` → `!token` → 307 to `/account`) gates
 *     `/account/orders/*` on the cookie being PRESENT ON THE REQUEST. It never
 *     verifies it, which is what lets this spec read an order surface without a
 *     real sign-in — 14.1-06 established that and the page resolves the order
 *     from (orderId, orderKey) regardless.
 *   - `AuthProvider` (`components/headkit-ui/auth-context.tsx`) rehydrates from
 *     that cookie on EVERY page, because it sits in the ROOT layout. It calls
 *     `getCustomer(token)`, which for a non-JWT resolves `{ success: false }`
 *     rather than throwing, and the effect then DELETES the cookie:
 *     `document.cookie = "hk-auth-token=; Max-Age=0; path=/"`.
 *
 * So every app page this spec loads disarms the guard for the next one, on a
 * timer nobody controls: measured on the local stack, the cookie is gone ~250ms
 * after the first page settles. Whether the next `/account/orders/...` request
 * still carries it is a race between that one background call and the next
 * navigation — which is why this passed here and failed on CI (run 32872345552),
 * reddening PRs that had changed nothing. When it lost, the guard 307'd to
 * `/account`, and the case reported "did not render" against the login page.
 *
 * This waits on the CONDITION, not on time. `about:blank` discards the live
 * document first, so no `AuthProvider` is alive to delete the cookie between
 * re-adding it and the navigation that has to carry it; there is no window left
 * for the race to occur in. The landing check that follows is what stops a
 * future regression from being reported as a missing product name again — a
 * silent 307 makes every later assertion in the case measure `/account`.
 */
async function gotoAccountSurface(
  page: Page,
  context: BrowserContext,
  url: string,
): Promise<void> {
  await page.goto("about:blank");
  await contextWith(context, [
    { name: "hk-auth-token", value: PRESENCE_ONLY_AUTH_TOKEN },
  ]);
  await page.goto(url);

  const wanted = new URL(url).pathname;
  expect(
    new URL(page.url()).pathname,
    `${url} did not land on the account surface — it settled at ${page.url()}. ` +
      `A 307 to ${ACCOUNT_LOGIN_PATH} means the hk-auth-token cookie was absent at ` +
      `REQUEST time (proxy.ts route guard), so nothing below measured the order detail.`,
  ).toBe(wanted);
}

/**
 * A real order on THIS stack, carrying one plain product and one add-on
 * fixture, placed by this run.
 *
 * WHY THIS EXISTS. The order-surface cases previously named order 222 and its
 * key, both of which exist only on the machine that recorded them; CI reported
 * "order 222 did not render" and could not have reported anything else. An
 * order the run places itself is available wherever the stack is.
 *
 * WHY TWO LINE ITEMS. One of them IS the baseline for the other. The claim
 * PAO-04 makes about an order surface is that an add-on product's line is
 * indistinguishable from an ordinary product's line, and with both on the same
 * order both lines render on the same page in the same run — so the comparison
 * is between two live measurements rather than against a recorded number.
 *
 * NO SKIP PATH. Every failure below throws with the reason. A skip here would
 * report green while measuring nothing, which is the precise false pass this
 * file exists to prevent.
 */
interface GateOrder {
  id: string;
  key: string;
  plainName: string;
  addonName: string;
}

let gateOrderPromise: Promise<GateOrder> | null = null;

/** Place (once per run) and return the two-line gate order. */
function gateOrder(): Promise<GateOrder> {
  gateOrderPromise ??= placeGateOrder();
  return gateOrderPromise;
}

async function placeGateOrder(): Promise<GateOrder> {
  const api = await request.newContext();
  try {
    const plain = await readProduct(api, PLAIN_PRODUCT_SLUG);
    const addon = await readProduct(api, PACKAGE_SLUG);
    const token = await mintCartToken(api);

    for (const product of [plain, addon]) {
      const { status, body } = await bareAddItem(
        api,
        token,
        Number(product.id),
      );
      if (status !== 201) {
        throw new Error(
          `could not seed the in-run baseline order: adding "${String(product.name)}" ` +
            `unconfigured returned HTTP ${status} ` +
            `(${String(body.code ?? "no code")} — ${String(body.message ?? "")}). ` +
            `With the plugin ABSENT the store has no add-on requirement to enforce, so this ` +
            `must be a 201. With the plugin ACTIVE this is the rejection ` +
            `"${PACKAGE_SLUG}"'s required group produces — which is this gate failing as it should.`,
        );
      }
    }

    const res = await api.post(`${STORE_API}/checkout`, {
      headers: { "Content-Type": "application/json", "Cart-Token": token },
      data: {
        billing_address: AU_ADDRESS,
        shipping_address: AU_ADDRESS,
        payment_method: PAY_METHOD,
        customer_note: "14.1-09 PAO-04 order-surface baseline (placed in-run)",
      },
    });
    const body = (await res.json()) as Record<string, unknown>;
    const id = String(body.order_id ?? "");
    const key = String(body.order_key ?? "");
    if (!(Number(id) > 0) || key === "") {
      throw new Error(
        `could not place the in-run baseline order: POST ${STORE_API}/checkout returned ` +
          `HTTP ${res.status()} (${String(body.code ?? "no code")} — ${String(body.message ?? "")}). ` +
          `PAO_WEDGE_PAYMENT_METHOD is "${PAY_METHOD}"; it must name a gateway enabled on this store.`,
      );
    }
    return {
      id,
      key,
      plainName: String(plain.name),
      addonName: String(addon.name),
    };
  } finally {
    await api.dispose();
  }
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test.describe("PAO-04 — the plugin-ABSENT gate", () => {
  test.beforeAll(async () => {
    // The ONLY sanctioned skip in this file: a cold machine. Everything else
    // fails, because everything else is either a regression or the very defect
    // this gate exists to catch.
    test.skip(
      !(await stackIsUp()),
      "local stack down — bring up WP :8090 + gateway + starter before running the add-on absence gate",
    );
  });

  // -------------------------------------------------------------------------
  // UI-SPEC assertion 5 — the wire contract, both halves
  // -------------------------------------------------------------------------

  test("PAO-04 (1/10): the product endpoint OMITS the addons key entirely — not null, not an empty array", async () => {
    const api = await request.newContext();
    try {
      for (const { slug } of FIXTURES) {
        const body = await readProduct(api, slug);

        // ABSENT is the contract (D-14.1-04), and the three states are
        // genuinely different: an absent key means the theme's `class_exists`
        // gate held; `null` would mean it emitted the key and the helper
        // returned nothing; `[]` would mean the theme decided on the shopper's
        // behalf. Only the first is right, and only `hasOwnProperty` can tell
        // absent from `null` — `body.addons === undefined` cannot.
        expect(
          Object.prototype.hasOwnProperty.call(body, "addons"),
          `"${slug}": the headkit/v2 payload still carries an "addons" key with the plugin absent. ` +
            `D-14.1-04 requires the key be ABSENT, not null and not []: every other key in that ` +
            `formatter is unconditional and this is the one place the idiom must not carry`,
        ).toBe(false);

        // The false-pass guard, asserted rather than assumed: the fixture is a
        // reachable, ordinary product. If it were reachable only because of its
        // add-ons, this whole file would be vacuous on the run that matters.
        expect(
          Number(body.id),
          `"${slug}" did not resolve to a real product without the plugin — the fixture must be ` +
            `an ORDINARY product, or this gate measures nothing`,
        ).toBeGreaterThan(0);
        expect(String(body.name ?? ""), `"${slug}" has no name`).not.toBe("");
      }
    } finally {
      await api.dispose();
    }
  });

  test("PAO-04 (2/10): the gateway still returns addons as an EMPTY LIST — the schema types it non-null, so no client can receive null", async () => {
    const api = await request.newContext();
    try {
      for (const { slug } of FIXTURES) {
        const { raw, json } = await gateway(
          api,
          `query{commerce{product(slug:"${slug}"){id name addons{id name options{label}}}}}`,
        );
        expect(
          json.errors,
          `"${slug}": the gateway errored with the plugin absent — ${JSON.stringify(json.errors)}`,
        ).toBeUndefined();

        const product = (
          json.data as { commerce?: { product?: Record<string, unknown> } }
        )?.commerce?.product;
        expect(
          product,
          `"${slug}": the gateway resolved no product with the plugin absent`,
        ).toBeTruthy();

        const addons = product!.addons;
        // The two halves both matter. `Array.isArray` alone would pass for a
        // list the mapper defaulted; the raw-text assertion is what proves the
        // wire literally carries `[]` rather than `null`, which is the shape a
        // `[ProductAddon!]!` field must always take (14.1-03 / D-14.1-04).
        expect(
          Array.isArray(addons),
          `"${slug}": addons is ${JSON.stringify(addons)} — a non-null list field must never be null. ` +
            `The mapper maps a MISSING theme key to [], never to null`,
        ).toBe(true);
        expect(
          (addons as unknown[]).length,
          `"${slug}": the gateway returned add-on groups with the plugin deactivated`,
        ).toBe(0);
        expect(
          raw.includes('"addons":[]'),
          `"${slug}": the raw gateway response does not literally carry \`"addons":[]\`. ` +
            `Body was: ${raw.slice(0, 400)}`,
        ).toBe(true);
      }
    } finally {
      await api.dispose();
    }
  });

  // -------------------------------------------------------------------------
  // UI-SPEC assertions 1 and 2 — the product detail page
  // -------------------------------------------------------------------------

  test("PAO-04 (3/10): no add-on group, control, name, description, error, wrapper or selection panel renders on any seeded fixture's PDP", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const api = await request.newContext();
    try {
      for (const { slug, groupName } of FIXTURES) {
        const product = await readProduct(api, slug);
        await page.goto(`${BASE_URL}/products/${slug}`);

        // The page renders as an ordinary product — again the false-pass guard,
        // and it also proves the assertions below ran against a real page
        // rather than a 404 shell.
        await expect(
          page.getByRole("heading", { level: 1, name: String(product.name) }),
          `"${slug}" did not render its PDP without the plugin — the fixture must stay an ordinary product`,
        ).toBeVisible({ timeout: 30_000 });

        // Every id `product-addons.tsx` can emit. Counting them all rather than
        // only the group container matters: a partial render would leave a
        // control or an error node behind with no group wrapper.
        for (const prefix of [
          "addon-group-",
          "addon-control-",
          "addon-name-",
          "addon-desc-",
          "addon-help-",
          "addon-error-",
        ]) {
          await expect(
            page.locator(`[id^="${prefix}"]`),
            `"${slug}": an element with id ^= "${prefix}" is in the DOM with the plugin absent`,
          ).toHaveCount(0);
        }

        // The component's own root wrapper. `ProductAddons` returns null for an
        // empty list AND the call site guards on length, so this element must
        // not exist at all — it carries `mb-5`, so an empty one would still
        // push 20px into the layout while being invisible to a text check.
        await expect(
          page.locator("div.mb-5.flex.flex-col.gap-6"),
          `"${slug}": the ProductAddons root wrapper is in the DOM with no groups in it — ` +
            `that is a zero-height wrapper carrying a 20px margin, which is exactly what ` +
            `PAO-04's "no element and no margin" forbids`,
        ).toHaveCount(0);

        // A group NAME is what a shopper would see (UI-SPEC assertion 1).
        await expect(
          page.getByText(groupName, { exact: false }),
          `"${slug}": the add-on group name "${groupName}" is on the page with the plugin absent`,
        ).toHaveCount(0);

        // The "Your selection" preview panel and its estimate, and the
        // file-upload notice — three pieces of add-on chrome that live OUTSIDE
        // the group loop and so survive a naive "hide the groups" fix.
        for (const copy of [
          "Your selection",
          "Estimated total",
          "Final price is confirmed in your cart.",
          "This product needs a file upload",
        ]) {
          await expect(
            page.getByText(copy, { exact: false }),
            `"${slug}": add-on chrome "${copy}" rendered with the plugin absent`,
          ).toHaveCount(0);
        }

        // No add-on EMPTY STATE and no add-on ERROR either — PAO-04 forbids
        // those as loudly as it forbids the UI itself.
        await expect(
          page.locator('[role="alert"]').filter({ hasText: /add-?on/i }),
          `"${slug}": an add-on error/empty state is on the page with the plugin absent`,
        ).toHaveCount(0);
      }
    } finally {
      await api.dispose();
    }
  });

  test("PAO-04 (4/10): no heading divider — the element only a `type: heading` entry produces is absent", async ({
    page,
  }) => {
    // `glam-booth-all-types` group 1900000101 is the phase's only `heading`
    // entry. It renders as a bordered section divider with no control, so it is
    // the one add-on element that would survive a fix which only suppressed
    // form controls.
    const api = await request.newContext();
    try {
      const product = await readProduct(api, ALL_TYPES_SLUG);
      await page.goto(`${BASE_URL}/products/${ALL_TYPES_SLUG}`);
      await expect(
        page.getByRole("heading", { level: 1, name: String(product.name) }),
      ).toBeVisible({ timeout: 30_000 });

      await expect(
        page.locator("div.mt-2.border-t.border-gray-200.pt-4"),
        "the heading-entry divider is in the DOM with the plugin absent",
      ).toHaveCount(0);
      await expect(
        page.getByText("Choose Your Session", { exact: false }),
        "the heading entry's own text rendered with the plugin absent",
      ).toHaveCount(0);
    } finally {
      await api.dispose();
    }
  });

  // -------------------------------------------------------------------------
  // UI-SPEC assertion 3 — the measured one
  // -------------------------------------------------------------------------

  test("PAO-04 (5/10): the variation block is the availability row's IMMEDIATE previous sibling and keeps its 20px bottom margin", async ({
    page,
  }) => {
    // This is the only assertion in the set that can catch a zero-height
    // wrapper (UI-SPEC Checker Sign-Off recommendation 2). It needs a VARIABLE
    // product with add-ons, because only there do the variation block and the
    // availability row sit on either side of the add-on form: with the plugin
    // active `glam-booth-variable` renders
    //   [variation block mb-5 gap-4] [ProductAddons mb-5 gap-6] [availability mb-4]
    // and with it absent the first and third must become neighbours.
    //
    // Three measurements, because each catches something the others cannot:
    //   - sibling identity  → catches a real element between them
    //   - computed margin   → catches the block's own spacing being restyled
    //   - geometric gap     → catches a `display: contents` wrapper, which is a
    //                         sibling to nobody yet still contributes height
    const api = await request.newContext();
    let variationAttrName = "";
    try {
      const product = await readProduct(api, VARIABLE_SLUG);
      const attrs = (product.attributes ?? []) as Array<{
        name?: string;
        variation?: boolean;
      }>;
      const varying = attrs.find((a) => a.variation);
      if (!varying?.name) {
        throw new Error(
          `fixture "${VARIABLE_SLUG}" publishes no variation attribute — without one there is no ` +
            `variation block and this assertion cannot discriminate. Re-run ` +
            `docker/wordpress/seed-product-addons.php`,
        );
      }
      variationAttrName = varying.name;
      await page.goto(`${BASE_URL}/products/${VARIABLE_SLUG}`);
      await expect(
        page.getByRole("heading", { level: 1, name: String(product.name) }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await api.dispose();
    }

    // The availability row is streamed in through a Suspense boundary
    // (`stockSlot`), so wait for it rather than racing it.
    await expect(
      page.getByText(/^(In Stock|Out of Stock|Only \d+ in Stock)$/).first(),
      "the availability row never rendered — the rhythm assertion has no anchor",
    ).toBeVisible({ timeout: 30_000 });

    const rhythm = await page.evaluate(() => {
      const isAvailability = (el: Element): boolean =>
        typeof el.className === "string" &&
        el.className.includes("items-baseline") &&
        el.className.includes("font-medium") &&
        /^(In Stock|Out of Stock|Only \d+ in Stock)$/.test(
          (el.textContent ?? "").trim(),
        );
      const inner = [...document.querySelectorAll("div")].find(isAvailability);
      if (!inner?.parentElement) return null;
      const row = inner.parentElement;
      const prev = row.previousElementSibling as HTMLElement | null;
      if (!prev) return { prev: null, gap: null, margin: null, text: null };
      return {
        prev: prev.className,
        margin: getComputedStyle(prev).marginBottom,
        gap:
          row.getBoundingClientRect().top - prev.getBoundingClientRect().bottom,
        text: (prev.textContent ?? "").trim().slice(0, 80),
        siblingCount: row.parentElement?.children.length ?? 0,
      };
    });

    expect(
      rhythm,
      "could not locate the availability row on the PDP — the anchor for this measurement is gone",
    ).not.toBeNull();

    // 1. Sibling identity. With the plugin active this is the add-on form's
    //    `mb-5 flex flex-col gap-6` root and this assertion goes red naming it.
    expect(
      rhythm!.prev,
      `the availability row's immediate previous sibling is not the variation block. ` +
        `It is: "${rhythm!.prev}" carrying text "${rhythm!.text}". With the plugin absent nothing ` +
        `may sit between them — not an element, not an empty wrapper`,
    ).toBe(VARIATION_BLOCK_CLASS);
    expect(
      foldLabel(rhythm!.text ?? ""),
      `the block before the availability row does not carry the variation attribute ` +
        `"${variationAttrName}" — it is not the variation block. Its text was: "${rhythm!.text}"`,
    ).toContain(foldLabel(variationAttrName));

    // 2. The block's own computed spacing, as a number rather than an absence.
    expect(
      rhythm!.margin,
      "the variation block's computed bottom margin moved off the recorded mb-5 value",
    ).toBe(`${VARIATION_BLOCK_MARGIN_PX}px`);

    // 3. The rendered distance. A `display: contents` wrapper is a sibling to
    //    nobody, so checks 1 and 2 would both pass while its children still
    //    pushed the availability row down. This is what sees that.
    expect(
      Math.abs((rhythm!.gap as number) - VARIATION_BLOCK_MARGIN_PX),
      `the rendered gap between the variation block and the availability row is ` +
        `${(rhythm!.gap as number).toFixed(2)}px, not ${VARIATION_BLOCK_MARGIN_PX}px — something is ` +
        `occupying layout between them even though no element sits between them`,
    ).toBeLessThan(0.5);
  });

  // -------------------------------------------------------------------------
  // UI-SPEC assertions 1 and 5 — the cart, order and account surfaces
  // -------------------------------------------------------------------------

  test("PAO-04 (6/10): an add-on fixture is an ORDINARY purchasable product — it adds to the cart unconfigured, and its cart line carries no Options panel", async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const api = await request.newContext();
    try {
      const product = await readProduct(api, PACKAGE_SLUG);
      const token = await mintCartToken(api);
      const { status, body } = await bareAddItem(
        api,
        token,
        Number(product.id),
      );

      // THE DISCRIMINATOR. `glam-booth-package` carries a REQUIRED group
      // (`Backdrop Design`, 1900000003), so with the plugin active this exact
      // request is rejected 400 `woocommerce_rest_cart_invalid_product_addons`.
      // With the plugin absent there is nothing to require, and the product is
      // an ordinary $1299 item that adds cleanly. The failure message says which
      // of the two happened rather than reporting a bare status.
      expect(
        status,
        `an unconfigured add-item for "${PACKAGE_SLUG}" was rejected with the plugin absent: ` +
          `${String(body.code ?? "no code")} — ${String(body.message ?? "")}. ` +
          `Without the plugin the store has no add-on requirements to enforce, so this must be a 201`,
      ).toBe(201);

      await contextWith(context, [{ name: "hk-cart-token", value: token }]);
      await page.goto(`${BASE_URL}/products/${PACKAGE_SLUG}`);
      await page.locator('button[aria-label="Cart"]:visible').first().click();
      await expect(drawer(page), "the cart drawer did not open").toBeVisible({
        timeout: 30_000,
      });
      await expect(
        drawer(page).getByText(String(product.name)).first(),
        "the unconfigured add-on product is not on the cart drawer line",
      ).toBeVisible({ timeout: 20_000 });

      await expect(
        addonPanel(drawer(page)),
        "an add-on Options panel is on the cart drawer line with the plugin absent",
      ).toHaveCount(0);

      // And the line root gained no child — the zero-height-wrapper check on the
      // surface that actually carries the panel.
      const roots = await measureLineRoots(page);
      expect(
        roots.length,
        "no line root was measurable in the drawer",
      ).toBeGreaterThan(0);
      for (const root of roots) {
        expect(
          root.children,
          `a drawer line root has ${root.children} children (expected 1) — a wrapper with no ` +
            `content is still a wrapper. Line text: ${root.text}`,
        ).toBe(1);
      }
    } finally {
      await api.dispose();
    }
  });

  test("PAO-04 (7/10): an add-on fixture's cart line is INDISTINGUISHABLE from a plain product's line rendered beside it — baseline derived in this run", async ({
    page,
    context,
  }) => {
    // The "unchanged vertical rhythm" half of PAO-04, stated as a comparison
    // this run can make on its own. One cart, two lines: a plain product that
    // has never had an add-on, and an add-on fixture with the plugin gone. If
    // anything about add-ons reaches the DOM — a panel, an empty wrapper, a
    // margin — the two lines stop matching.
    //
    // THIS DISCRIMINATES. `glam-booth-package` carries a REQUIRED group, so
    // with the plugin ACTIVE the unconfigured add-item below is rejected 400
    // and this case fails, naming that rejection. It is deliberately the same
    // fixture cases 6 and 9 use for that reason.
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const api = await request.newContext();
    try {
      const plain = await readProduct(api, PLAIN_PRODUCT_SLUG);
      const addon = await readProduct(api, PACKAGE_SLUG);
      const token = await mintCartToken(api);

      for (const product of [plain, addon]) {
        const { status, body } = await bareAddItem(
          api,
          token,
          Number(product.id),
        );
        expect(
          status,
          `could not seed the comparison cart with "${String(product.name)}": ` +
            `${String(body.code ?? "no code")} — ${String(body.message ?? "")}. ` +
            `With the plugin absent both products are ordinary items and must add cleanly`,
        ).toBe(201);
      }

      await contextWith(context, [{ name: "hk-cart-token", value: token }]);
      await page.goto(`${BASE_URL}/products/${PLAIN_PRODUCT_SLUG}`);
      await page.locator('button[aria-label="Cart"]:visible').first().click();
      await expect(drawer(page), "the cart drawer did not open").toBeVisible({
        timeout: 30_000,
      });
      for (const name of [String(plain.name), String(addon.name)]) {
        await expect(
          drawer(page).getByText(name).first(),
          `"${name}" is not on a cart drawer line`,
        ).toBeVisible({ timeout: 20_000 });
      }

      await expect(
        addonPanel(drawer(page)),
        "an add-on Options panel is in the cart drawer with the plugin absent",
      ).toHaveCount(0);

      const roots = await measureLineRoots(page);
      expect(
        roots.length,
        `expected one line root per cart line (2), measured ${roots.length}: ` +
          roots.map((r) => `"${r.text}"`).join(", "),
      ).toBe(2);

      const plainLine = lineFor(roots, String(plain.name), "cart drawer");
      const addonLine = lineFor(roots, String(addon.name), "cart drawer");
      expectNoExtraLineContent(plainLine, "cart drawer (plain product line)");
      expectNoExtraLineContent(addonLine, "cart drawer (add-on fixture line)");
      expectSameLineShape(addonLine, plainLine, "cart drawer");
    } finally {
      await api.dispose();
    }
  });

  test("PAO-04 (8/10): the confirmation page and the account order detail show no Options panel, and an add-on fixture's order line matches a plain product's line on BOTH — order and baseline both from this run", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });

    // The order is PLACED BY THIS RUN and carries both products, so the
    // baseline is the line rendered beside the one under test. Naming a
    // recorded order id here made the case a property of one machine — CI could
    // only ever report that order 222 does not exist there.
    const order = await gateOrder();

    // `/account/orders/*` is gated on the PRESENCE of `hk-auth-token` only
    // (`proxy.ts` `isPrivateAccountPath` — no verification), and the page
    // resolves the order from (orderId, orderKey) via `getOrderAction` without
    // ever reading the token. 14.1-06 established this and corroborated it with
    // the numbers: the account markup hash for order 222 is byte-identical to
    // the confirmation page's.
    //
    // The cookie is (re-)established by `gotoAccountSurface` immediately before
    // the request that needs it, NOT once here: the order-confirmation page
    // visited first in this loop is itself an app page, and every app page
    // deletes an unverifiable token — read that function's docblock before
    // moving this back.
    const perSurface: Array<{ where: string; shape: string }> = [];

    for (const [where, url, gated] of [
      [
        "order confirmation",
        `${BASE_URL}/checkout/success/${order.id}?key=${order.key}`,
        false,
      ],
      [
        "account order detail",
        `${BASE_URL}/account/orders/${order.id}?key=${order.key}`,
        true,
      ],
    ] as const) {
      if (gated) {
        await gotoAccountSurface(page, context, url);
      } else {
        await page.goto(url);
      }
      for (const name of [order.plainName, order.addonName]) {
        await expect(
          page.getByText(name).first(),
          `${where}: order ${order.id} did not render "${name}" (url settled at ${page.url()})`,
        ).toBeVisible({ timeout: 30_000 });
      }

      await expect(
        addonPanel(page),
        `${where}: an add-on Options panel rendered for an order that has none`,
      ).toHaveCount(0);

      const roots = await measureLineRoots(page);
      expect(
        roots.length,
        `${where}: expected one line root per ordered product (2), measured ${roots.length}: ` +
          roots.map((r) => `"${r.text}"`).join(", "),
      ).toBe(2);

      const plainLine = lineFor(roots, order.plainName, where);
      const addonLine = lineFor(roots, order.addonName, where);
      expectNoExtraLineContent(plainLine, `${where} (plain product line)`);
      expectNoExtraLineContent(addonLine, `${where} (add-on fixture line)`);
      expectSameLineShape(addonLine, plainLine, where);

      // The shape, without the heights — the two surfaces lay out at different
      // widths and a height comparison ACROSS them would measure the layout,
      // not the add-on contract. What must match across them is the structure.
      perSurface.push({
        where,
        shape: JSON.stringify(
          [plainLine, addonLine].map((l) => l.childClasses),
        ),
      });
    }

    // 14.1-06 recorded that the account markup was byte-identical to the
    // confirmation page's. Byte-identity is a property of one build; that the
    // two surfaces build the line the same way is the claim, and this run can
    // check it against itself.
    expect(
      perSurface[1]!.shape,
      `the account order detail builds the order line differently from the order confirmation ` +
        `page. Both render <LineItemDisplay>, so with the plugin absent both must produce the ` +
        `same structure.\n  confirmation: ${perSurface[0]!.shape}\n  account:      ${perSurface[1]!.shape}`,
    ).toBe(perSurface[0]!.shape);
  });

  test("PAO-04 (9/10): an order placed from an UNCONFIGURED add-on fixture carries no add-on selections and shows no Options panel", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const api = await request.newContext();
    try {
      const product = await readProduct(api, PACKAGE_SLUG);
      const token = await mintCartToken(api);
      const add = await bareAddItem(api, token, Number(product.id));
      expect(
        add.status,
        `unconfigured add-item rejected with the plugin absent: ` +
          `${String(add.body.code ?? "no code")} — ${String(add.body.message ?? "")}`,
      ).toBe(201);

      // Placed through `POST /wc/store/v1/checkout` — the same write the
      // storefront performs, and the only route to a completed order while
      // commerce holds a placeholder Stripe key (14.1-06 deferred item 5).
      const res = await api.post(`${STORE_API}/checkout`, {
        headers: { "Content-Type": "application/json", "Cart-Token": token },
        data: {
          billing_address: AU_ADDRESS,
          shipping_address: AU_ADDRESS,
          payment_method: PAY_METHOD,
          customer_note: "14.1-09 PAO-04 plugin-absent gate",
        },
      });
      const body = (await res.json()) as Record<string, unknown>;
      expect(
        [200, 201],
        `POST /checkout returned ${res.status()} (${String(body.code ?? "no code")}) — ` +
          `${String(body.message ?? "")}`,
      ).toContain(res.status());
      const orderId = String(body.order_id ?? "");
      const orderKey = String(body.order_key ?? "");
      expect(Number(orderId), "checkout returned no order_id").toBeGreaterThan(
        0,
      );

      // The wire first: the order path's own `addons` field must be an empty
      // list too. 14.1-03 puts it there from `_pao_ids`, which a store without
      // the plugin never writes.
      const { json } = await gateway(
        api,
        `query{commerce{storeOrder(id:"${orderId}",key:"${orderKey}",billingEmail:"${AU_ADDRESS.email}"){id items{name addons{addonId name value}}}}}`,
      );
      expect(
        json.errors,
        `the order read errored: ${JSON.stringify(json.errors)}`,
      ).toBeUndefined();
      const items = (
        json.data as {
          commerce?: {
            storeOrder?: { items?: Array<{ addons?: unknown[] }> };
          };
        }
      )?.commerce?.storeOrder?.items;
      expect(
        items?.length,
        "the placed order carries no items",
      ).toBeGreaterThan(0);
      for (const item of items!) {
        expect(
          Array.isArray(item.addons),
          `an order line's addons is ${JSON.stringify(item.addons)} — a non-null list must never be null`,
        ).toBe(true);
        expect(
          item.addons!.length,
          "the order carries add-on selections although the plugin is absent",
        ).toBe(0);
      }

      // Then the surface.
      await page.goto(
        `${BASE_URL}/checkout/success/${orderId}?key=${orderKey}`,
      );
      await expect(
        page.getByText(String(product.name)).first(),
        `the confirmation page for order ${orderId} did not render`,
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        addonPanel(page),
        `an add-on Options panel rendered on the confirmation page for order ${orderId}`,
      ).toHaveCount(0);
    } finally {
      await api.dispose();
    }
  });

  // -------------------------------------------------------------------------
  // UI-SPEC assertion 4 — the console
  // -------------------------------------------------------------------------

  test("PAO-04 (10/10): the browser console carries no warning and no error on every asserted page, beyond messages whose CLASS is environmental", async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    const noise = collectConsole(page);
    const perPage: Array<{ url: string; unexplained: string[] }> = [];

    // Set once, exactly as before, so the FIRST page loaded below still carries
    // the cookie and still exercises `AuthProvider`'s rehydrate-and-fail path
    // under this case's console assertion.
    await contextWith(context, [
      { name: "hk-auth-token", value: PRESENCE_ONLY_AUTH_TOKEN },
    ]);

    const order = await gateOrder();
    // The account order detail is the ONLY entry here behind the cookie gate,
    // and it is reached through `gotoAccountSurface` so the cookie is present on
    // the request rather than left over from five PDPs ago — by which point the
    // app has always deleted it. Before that, this case walked into the 307 and
    // measured the console of the LOGIN page while reporting the order URL: the
    // same defect as PAO-04 (8/10), silent here because the assertion below
    // holds on `/account` too.
    const accountOrderUrl = `${BASE_URL}/account/orders/${order.id}?key=${order.key}`;
    const urls = [
      ...FIXTURES.map((f) => `${BASE_URL}/products/${f.slug}`),
      `${BASE_URL}/checkout/success/${order.id}?key=${order.key}`,
      accountOrderUrl,
    ];

    for (const url of urls) {
      noise.length = 0;
      if (url === accountOrderUrl) {
        await gotoAccountSurface(page, context, url);
      } else {
        await page.goto(url);
      }
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const unexplained = unexplainedConsole(noise);
      perPage.push({ url, unexplained });

      // An add-on mention in the console is a failure whatever its type — a
      // store without the plugin should not know the word.
      const addonMentions = noise.filter((l) => /add-?on/i.test(l));
      expect(
        addonMentions,
        `${url}: the console mentions add-ons with the plugin absent`,
      ).toEqual([]);
    }

    const dirty = perPage.filter((p) => p.unexplained.length > 0);
    expect(
      dirty,
      `unexplained console warnings/errors with the plugin absent. The only tolerated messages are ` +
        `those matching a class that cannot carry add-on information:\n` +
        ENVIRONMENT_CONSOLE.map((e) => `  - ${e.pattern} — ${e.why}`).join(
          "\n",
        ) +
        `\nFound:\n` +
        dirty
          .map((p) => `  ${p.url}\n    ${p.unexplained.join("\n    ")}`)
          .join("\n"),
    ).toEqual([]);
  });
});
