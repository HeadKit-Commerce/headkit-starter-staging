import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The checkout stock hold's server actions (checkout plan v3 §1). They turn the
 * SDK's GraphQL errors into VALUES, because a Server Action error reaches the
 * browser without its extensions in production — and the Pay click must know
 * whether to confirm, which lines to correct, or to ask for a retry.
 *
 * The rule under test: confirm ONLY on held / not-required. Every other
 * outcome of the hold call — a refusal, the hold-unavailable code, an unrelated
 * error, no cart — is a refusal. The hold fails closed.
 */

const createServerHeadkitMock = vi.fn();
const getCartTokenMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    set: vi.fn(),
    delete: vi.fn(),
  }),
}));
vi.mock("@/lib/cart", () => ({ getCartToken: () => getCartTokenMock() }));
vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: (...args: unknown[]) => createServerHeadkitMock(...args),
}));

/** The shape the SDK throws: a GraphQLError with extensions. */
function sdkError(extensions: Record<string, unknown>) {
  return Object.assign(new Error("refused"), {
    errors: [{ message: "refused", extensions }],
  });
}

function sdkWithPayments(payments: Record<string, unknown>) {
  createServerHeadkitMock.mockReturnValue({ payments });
}

let actions: typeof import("./actions");

beforeEach(async () => {
  vi.clearAllMocks();
  getCartTokenMock.mockReturnValue("ct");
  actions = await import("./actions");
});

describe("holdCheckoutStockAction", () => {
  it("passes the Checkout Session and answers held", async () => {
    const hold = vi.fn().mockResolvedValue({ status: "HELD" });
    sdkWithPayments({ holdCheckoutStock: hold });
    await expect(actions.holdCheckoutStockAction("cs_1")).resolves.toEqual({
      status: "held",
    });
    expect(hold).toHaveBeenCalledWith("cs_1");
  });

  it("answers not_required", async () => {
    sdkWithPayments({
      holdCheckoutStock: vi.fn().mockResolvedValue({ status: "NOT_REQUIRED" }),
    });
    await expect(actions.holdCheckoutStockAction("cs_1")).resolves.toEqual({
      status: "not_required",
    });
  });

  it("returns a refusal with the lines to correct", async () => {
    const issues = [{ code: "OUT_OF_STOCK", itemKey: "k1", available: 0 }];
    sdkWithPayments({
      holdCheckoutStock: vi
        .fn()
        .mockRejectedValue(sdkError({ code: "CART_ITEM_UNAVAILABLE", issues })),
    });
    await expect(actions.holdCheckoutStockAction("cs_1")).resolves.toEqual({
      status: "refused",
      issues,
    });
  });

  it.each([
    [
      "the hold-unavailable code",
      sdkError({ code: "CHECKOUT_STOCK_HOLD_UNAVAILABLE" }),
    ],
    ["an unrelated GraphQL error", sdkError({ code: "SOMETHING_ELSE" })],
    ["a network failure", new Error("fetch failed")],
  ])("fails CLOSED on %s", async (_label, err) => {
    sdkWithPayments({ holdCheckoutStock: vi.fn().mockRejectedValue(err) });
    await expect(actions.holdCheckoutStockAction("cs_1")).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("fails closed with no cart, without calling commerce", async () => {
    getCartTokenMock.mockReturnValue(undefined);
    await expect(actions.holdCheckoutStockAction("cs_1")).resolves.toEqual({
      status: "unavailable",
    });
    expect(createServerHeadkitMock).not.toHaveBeenCalled();
  });

  it("answers not_required against an SDK that predates the hold (what it did before)", async () => {
    sdkWithPayments({});
    await expect(actions.holdCheckoutStockAction("cs_1")).resolves.toEqual({
      status: "not_required",
    });
  });
});

describe("releaseCheckoutStockAction", () => {
  it("forwards the attempt to commerce, which decides", async () => {
    const release = vi.fn().mockResolvedValue({ status: "KEPT" });
    sdkWithPayments({ releaseCheckoutStock: release });
    await actions.releaseCheckoutStockAction({ paymentIntentId: "pi_1" });
    expect(release).toHaveBeenCalledWith({ paymentIntentId: "pi_1" });
  });

  it("never throws", async () => {
    sdkWithPayments({
      releaseCheckoutStock: vi.fn().mockRejectedValue(new Error("down")),
    });
    await expect(
      actions.releaseCheckoutStockAction({ checkoutSessionId: "cs_1" }),
    ).resolves.toBeUndefined();
  });
});

describe("createPaymentIntentAction (the Express hold)", () => {
  it("returns the client secret when the intent is created", async () => {
    sdkWithPayments({
      createIntent: vi
        .fn()
        .mockResolvedValue({ clientSecret: "pi_1_secret_x" }),
    });
    await expect(actions.createPaymentIntentAction()).resolves.toEqual({
      ok: true,
      clientSecret: "pi_1_secret_x",
    });
  });

  it("returns a hold refusal as a value", async () => {
    const issues = [{ code: "INSUFFICIENT_STOCK", itemKey: "k", available: 1 }];
    sdkWithPayments({
      createIntent: vi
        .fn()
        .mockRejectedValue(sdkError({ code: "CART_ITEM_UNAVAILABLE", issues })),
    });
    await expect(actions.createPaymentIntentAction()).resolves.toEqual({
      ok: false,
      hold: { status: "refused", issues },
    });
  });

  it("returns an unplaced hold as a value", async () => {
    sdkWithPayments({
      createIntent: vi
        .fn()
        .mockRejectedValue(
          sdkError({ code: "CHECKOUT_STOCK_HOLD_UNAVAILABLE" }),
        ),
    });
    await expect(actions.createPaymentIntentAction()).resolves.toEqual({
      ok: false,
      hold: { status: "unavailable" },
    });
  });

  it("still throws any other failure, as before", async () => {
    sdkWithPayments({
      createIntent: vi.fn().mockRejectedValue(new Error("stripe down")),
    });
    await expect(actions.createPaymentIntentAction()).rejects.toThrow(
      "stripe down",
    );
  });
});
