// @vitest-environment jsdom

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { CartFieldsFragment } from "@headkit/sdk";
import { CartProvider } from "@/components/headkit-ui/cart-context";

/**
 * ENG-784 mechanism 1 registers the checkout's ACTIVE session in the
 * hk-checkout-session cookie. It used to do that through a Server Action, and
 * a cookie written by a Server Action re-renders the calling route: every
 * /checkout view ran its whole server path twice and created a second Stripe
 * Checkout Session nobody used (`x-action-revalidated: 1` on the action's
 * response). Registration is a fetch to `POST /api/checkout/active-session`
 * now, and the page must call NO Server Action to register.
 *
 * Every export of `@/app/checkout/actions` is a spy here, including the
 * removed `registerActiveCheckoutSessionAction`, so a regression to any
 * action-based registration fails the first case.
 */

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const actions = vi.hoisted(() => ({
  createCheckoutSessionAction: vi.fn(),
  getCheckoutAction: vi.fn(),
  registerActiveCheckoutSessionAction: vi.fn(async () => undefined),
  expireCheckoutSessionAction: vi.fn(async () => undefined),
  updateCustomerAction: vi.fn(),
  correctCartAction: vi.fn(),
}));
const form = vi.hoisted(() => ({
  onRefreshSession: undefined as
    | undefined
    | ((email: string, step: string) => Promise<void>),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/checkout/actions", () => actions);
vi.mock("@/lib/cart-actions", () => ({
  getFullCartAction: vi.fn(async () => null),
}));
// The form is not under test: it only hands back the refresh callback.
vi.mock("@/app/checkout/CheckoutForm", () => ({
  CheckoutForm: ({
    onRefreshSession,
  }: {
    onRefreshSession?: (email: string, step: string) => Promise<void>;
  }) => {
    form.onRefreshSession = onRefreshSession;
    return null;
  },
}));
vi.mock("@/components/checkout/cart", () => ({ Cart: () => null }));

const cart = {
  token: "tok",
  items: [{ key: "a", name: "Shock Bolt" }],
  itemsCount: 1,
  needsShipping: true,
  shippingRates: [],
  paymentMethods: [],
  currency: { code: "AUD", symbol: "$", minorUnit: 2 },
  totals: { totalItems: "31.95", totalItemsTax: "0", totalPrice: "31.95" },
} as unknown as CartFieldsFragment;

function session(sessionId: string): {
  clientSecret: string;
  sessionId: string;
  publishableKey: string;
} {
  return {
    clientSecret: `${sessionId}_secret`,
    sessionId,
    publishableKey: "pk_test_1",
  };
}

const fetchMock = vi.fn<typeof fetch>();
let container: HTMLDivElement;
let root: Root;

/** Session ids the page POSTed to the registration route, in order. */
function registeredIds(): string[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/checkout/active-session")
    .map(
      ([, init]) =>
        (JSON.parse(String(init?.body)) as { sessionId: string }).sessionId,
    );
}

async function mount(sessionId: string | null): Promise<void> {
  const { CheckoutPageContent } = await import("./checkout-page-content");
  await act(async () => {
    root.render(
      <CartProvider>
        <CheckoutPageContent
          initialCart={cart}
          checkoutSession={sessionId ? session(sessionId) : null}
          returnUrl="http://localhost:3000/checkout/success"
        />
      </CartProvider>,
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  form.onRefreshSession = undefined;
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("registers the session through the route handler and calls no Server Action", async () => {
  await mount("cs_test_1");

  expect(registeredIds()).toEqual(["cs_test_1"]);
  const [, init] = fetchMock.mock.calls[0]!;
  expect(init?.method).toBe("POST");
  expect(new Headers(init?.headers).get("content-type")).toBe(
    "application/json",
  );
  for (const [name, spy] of Object.entries(actions)) {
    expect(spy, `${name} must not run on mount`).not.toHaveBeenCalled();
  }
});

it("registers nothing for a checkout with no session (zero-total)", async () => {
  await mount(null);

  expect(registeredIds()).toEqual([]);
});

it("a failed registration is swallowed", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

  await mount("cs_test_1");

  expect(registeredIds()).toEqual(["cs_test_1"]);
  expect(container.isConnected).toBe(true);
});

it("on supersede, expires the old session only AFTER the new one is registered, registering it once", async () => {
  await mount("cs_test_1");
  let finishRegistration!: () => void;
  fetchMock.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finishRegistration = () => resolve(new Response(null, { status: 204 }));
      }),
  );
  actions.createCheckoutSessionAction.mockResolvedValue(session("cs_test_2"));

  await act(async () => {
    await form.onRefreshSession!("shopper@example.com", "delivery");
  });

  // The expire action reads the cookie its own request carries; sent now it
  // would still see cs_test_1, delete the cookie and orphan cs_test_2.
  expect(registeredIds()).toEqual(["cs_test_1", "cs_test_2"]);
  expect(actions.expireCheckoutSessionAction).not.toHaveBeenCalled();

  await act(async () => {
    finishRegistration();
  });

  expect(actions.expireCheckoutSessionAction).toHaveBeenCalledWith(
    "cs_test_1",
    "SUPERSEDED",
  );
  // The mount effect for cs_test_2 shared the refresh's request.
  expect(registeredIds()).toEqual(["cs_test_1", "cs_test_2"]);
});
