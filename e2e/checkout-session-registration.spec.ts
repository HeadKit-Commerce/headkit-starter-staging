import {
  test,
  expect,
  request,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  BASE_URL,
  installCartCookie,
  seedRegularCart,
  stackIsUp,
  stripeConnectAccountId,
  stripeTestKeys,
} from "./helpers";

/**
 * One /checkout view is ONE server render and ONE Stripe Checkout Session.
 *
 * The page registers its session in the httpOnly `hk-checkout-session` cookie
 * (ENG-784 mechanism 1) from a mount effect. That registration used to be a
 * Server Action, and a cookie written by a Server Action re-renders the
 * calling route: every view ran the full checkout server path a second time
 * (`x-action-revalidated` on the action's response) and created a second
 * Stripe session that nothing ever used. It is a fetch to
 * `POST /api/checkout/active-session` now.
 *
 * Asserted against the real chain (starter → gateway → commerce → WooCommerce
 * → Stripe TEST), three ways that each fail on the old code:
 *   - no Server Action response on /checkout carries `x-action-revalidated`;
 *   - Stripe holds exactly ONE session for this cart (`metadata.cart_token`,
 *     which commerce stamps on every session it creates, so parallel workers
 *     cannot disturb the count);
 *   - the cookie names that session, and it is the one Stripe.js initialised.
 *
 * LOCAL-ONLY: localhost stack, Stripe TEST keys only (self-skips without).
 */

const STRIPE_INIT =
  /api\.stripe\.com\/v1\/payment_pages\/(cs_[A-Za-z0-9_]+)\/init/;

/** Sessions Stripe holds for `cartToken`, created at or after `since` (unix s). */
async function stripeSessionsForCart(
  api: APIRequestContext,
  cartToken: string,
  since: number,
): Promise<string[]> {
  const account = await stripeConnectAccountId(api);
  for (const sk of stripeTestKeys()) {
    for (const acct of [account, null]) {
      const res = await api.get(
        `https://api.stripe.com/v1/checkout/sessions?limit=100&created[gte]=${since}`,
        {
          headers: {
            Authorization: `Bearer ${sk}`,
            ...(acct ? { "Stripe-Account": acct } : {}),
          },
        },
      );
      const json = (await res.json()) as {
        error?: unknown;
        data?: { id: string; metadata?: Record<string, string> }[];
      };
      if (json.error || !json.data) continue;
      const ids = json.data
        .filter((s) => s.metadata?.cart_token === cartToken)
        .map((s) => s.id);
      if (ids.length > 0) return ids;
    }
  }
  return [];
}

/**
 * Resolves once no Server Action POST to /checkout has been in flight for
 * `quietMs`. The old registration's re-render streams for as long as a whole
 * checkout server render takes, so "the cookie is set" is not "the work is
 * done"; this is.
 */
function trackCheckoutActions(page: Page): {
  revalidated: string[];
  settled: (quietMs: number) => Promise<void>;
} {
  const revalidated: string[] = [];
  let inFlight = 0;
  let lastChange = Date.now();
  const isAction = (req: {
    method(): string;
    url(): string;
    headers(): Record<string, string>;
  }) =>
    req.method() === "POST" &&
    "next-action" in req.headers() &&
    new URL(req.url()).pathname === "/checkout";
  page.on("request", (req) => {
    if (!isAction(req)) return;
    inFlight += 1;
    lastChange = Date.now();
  });
  const done = (req: Parameters<typeof isAction>[0]) => {
    if (!isAction(req)) return;
    inFlight -= 1;
    lastChange = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  page.on("response", (res) => {
    if (!isAction(res.request())) return;
    const header = res.headers()["x-action-revalidated"];
    if (header) revalidated.push(header);
  });
  return {
    revalidated,
    settled: (quietMs) =>
      expect
        .poll(() => inFlight === 0 && Date.now() - lastChange >= quietMs, {
          timeout: 60_000,
          intervals: [250],
        })
        .toBe(true),
  };
}

test.describe("Checkout session registration (ENG-784 mechanism 1)", () => {
  test.beforeAll(async () => {
    test.skip(
      !(await stackIsUp()),
      "local stack down — bring up WP :8090 + gateway :4000 + starter (E2E_BASE_URL)",
    );
    test.skip(
      stripeTestKeys().length === 0,
      "no Stripe TEST key — checkout creates no session without one",
    );
  });

  test("one /checkout view creates one Stripe session and re-renders nothing", async ({
    page,
    context,
  }) => {
    const api = await request.newContext();
    // Discover the Connect account first: the discovery creates a session of
    // its own, on a different cart.
    await stripeConnectAccountId(api);
    const cartToken = await seedRegularCart(api, 1);
    await installCartCookie(context, cartToken);
    const since = Math.floor(Date.now() / 1000) - 5;

    const actions = trackCheckoutActions(page);
    const initialised = new Set<string>();
    page.on("request", (req) => {
      const m = req.url().match(STRIPE_INIT);
      if (m) initialised.add(m[1]!);
    });

    await page.goto(`${BASE_URL}/checkout`);

    const sessionCookie = async (): Promise<string | null> =>
      (await context.cookies(BASE_URL)).find(
        (c) => c.name === "hk-checkout-session",
      )?.value ?? null;
    await expect
      .poll(sessionCookie, {
        timeout: 60_000,
        message: "checkout never registered its session in hk-checkout-session",
      })
      .toMatch(/^cs_test_/);
    await actions.settled(2_000);

    expect(
      actions.revalidated,
      "a Server Action on /checkout re-rendered the route (x-action-revalidated)",
    ).toEqual([]);

    const registered = await sessionCookie();
    const created = await stripeSessionsForCart(api, cartToken, since);
    expect(
      created,
      "Stripe sessions created for this cart by one /checkout view",
    ).toEqual([registered]);
    expect([...initialised]).toEqual([registered]);

    await api.dispose();
  });
});
