import { describe, expect, it, vi, afterEach } from "vitest";
import { reportSubscribeOutcome } from "@/lib/subscribe-outcome";

type Global = { Sentry?: unknown };

afterEach(() => {
  delete (globalThis as Global).Sentry;
});

function installSentry(): ReturnType<typeof vi.fn> {
  const captureMessage = vi.fn();
  (globalThis as Global).Sentry = { captureMessage };
  return captureMessage;
}

describe("reportSubscribeOutcome", () => {
  it("reports nothing when the subscribe succeeded", async () => {
    const captureMessage = installSentry();
    await reportSubscribeOutcome(Promise.resolve({ success: true }), {
      source: "form",
    });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("reports a failed result with its source", async () => {
    const captureMessage = installSentry();
    await reportSubscribeOutcome(
      Promise.resolve({ success: false, error: "Unable to subscribe" }),
      { source: "form" },
    );
    expect(captureMessage).toHaveBeenCalledWith(
      "email_marketing_subscribe_failed source=form",
      "error",
    );
  });

  it("handles a rejection instead of letting it go unhandled", async () => {
    const captureMessage = installSentry();
    await expect(
      reportSubscribeOutcome(Promise.reject(new Error("boom")), {
        source: "checkout",
      }),
    ).resolves.toBeUndefined();
    expect(captureMessage).toHaveBeenCalledWith(
      "email_marketing_subscribe_rejected source=checkout",
      "error",
    );
  });

  it("resolves (never throws) with no reporter registered", async () => {
    await expect(
      reportSubscribeOutcome(Promise.reject(new Error("boom")), {
        source: "form",
      }),
    ).resolves.toBeUndefined();
  });

  it("never carries the subscriber's address", async () => {
    const captureMessage = installSentry();
    await reportSubscribeOutcome(
      Promise.resolve({
        success: false,
        error: "shopper@example.com rejected",
      }),
      { source: "form" },
    );
    const [message] = captureMessage.mock.calls[0] as [string];
    expect(message).not.toContain("@");
  });
});
