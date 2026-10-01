import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The subscribe server action is the only record when the request never reaches
 * commerce, and it is also where a discarded `void subscribeEmailAction(...)`
 * used to lose a provider rejection. These tests pin the lines it emits and the
 * privacy rule: the subscriber's address never appears, only a truncated hash
 * (the same derivation commerce logs, so the two lines join on it).
 */

const subscribeMock = vi.fn();

vi.mock("@/lib/sdk.server", () => ({
  createServerHeadkit: () => ({ emailMarketing: { subscribe: subscribeMock } }),
}));

vi.mock("@/lib/email-marketing", () => ({
  getEmailMarketingStatus: vi.fn(),
}));

const EMAIL = "Shopper@Example.com";
// printf 'shopper@example.com' | shasum -a 256 | cut -c1-16
const EMAIL_HASH = "a85e9ca18f34935a";

let stderrLines: string[] = [];
let stdoutLines: string[] = [];

beforeEach(() => {
  stderrLines = [];
  stdoutLines = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderrLines.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdoutLines.push(String(chunk));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  subscribeMock.mockReset();
});

function parsed(lines: string[]): Record<string, unknown>[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function assertNoAddress(lines: string[]): void {
  for (const line of lines) {
    expect(line.toLowerCase()).not.toContain("shopper@");
    expect(line.toLowerCase()).not.toContain("example.com");
  }
}

describe("subscribeEmailAction logging", () => {
  it("logs nothing on success", async () => {
    subscribeMock.mockResolvedValue({ success: true, userErrors: [] });
    const { subscribeEmailAction } =
      await import("@/lib/email-marketing-actions");

    await expect(
      subscribeEmailAction({ email: EMAIL, source: "form" }),
    ).resolves.toEqual({ success: true });
    expect(stderrLines).toHaveLength(0);
    expect(stdoutLines).toHaveLength(0);
  });

  it("logs a provider rejection with its code and the source", async () => {
    subscribeMock.mockResolvedValue({
      success: false,
      userErrors: [
        { code: "SUBSCRIBE_FAILED", message: "Unable to subscribe right now" },
      ],
    });
    const { subscribeEmailAction } =
      await import("@/lib/email-marketing-actions");

    await subscribeEmailAction({ email: EMAIL, source: "form" });

    const [line, ...rest] = parsed(stderrLines);
    expect(rest).toHaveLength(0);
    expect(line).toMatchObject({
      level: "error",
      event: "email_marketing_subscribe_rejected",
      source: "form",
      reason: "user_error",
      code: "SUBSCRIBE_FAILED",
      emailHash: EMAIL_HASH,
    });
    assertNoAddress(stderrLines);
  });

  it("logs the unreachable case when the SDK throws", async () => {
    const err = Object.assign(
      new Error("HeadKit authentication failed: body"),
      {
        code: "NETWORK_ERROR",
        status: 502,
      },
    );
    subscribeMock.mockRejectedValue(err);
    const { subscribeEmailAction } =
      await import("@/lib/email-marketing-actions");

    const result = await subscribeEmailAction({
      email: EMAIL,
      source: "checkout",
    });
    expect(result.success).toBe(false);

    const [line] = parsed(stderrLines);
    expect(line).toMatchObject({
      level: "error",
      event: "email_marketing_subscribe_unreachable",
      source: "checkout",
      emailHash: EMAIL_HASH,
      code: "NETWORK_ERROR",
      status: 502,
    });
    // errorFields is the bounded reader: a raw upstream body in the message
    // must not reach the log line.
    expect(JSON.stringify(line)).not.toContain("authentication failed");
  });

  it("logs the store-not-connected no-op at info, not error", async () => {
    subscribeMock.mockResolvedValue({ success: false, userErrors: [] });
    const { subscribeEmailAction } =
      await import("@/lib/email-marketing-actions");

    await subscribeEmailAction({ email: EMAIL, source: "footer" });

    expect(stderrLines).toHaveLength(0);
    const [line] = parsed(stdoutLines);
    expect(line).toMatchObject({
      level: "info",
      event: "email_marketing_subscribe_noop",
      source: "footer",
      emailHash: EMAIL_HASH,
    });
    assertNoAddress(stdoutLines);
  });

  it("logs a missing email without a hash of an empty value", async () => {
    const { subscribeEmailAction } =
      await import("@/lib/email-marketing-actions");

    await subscribeEmailAction({ email: "   ", source: "form" });

    const [line] = parsed(stderrLines);
    expect(line).toMatchObject({
      event: "email_marketing_subscribe_rejected",
      reason: "email_missing",
      source: "form",
    });
    expect(line?.["emailHash"]).toBeUndefined();
    expect(subscribeMock).not.toHaveBeenCalled();
  });
});
