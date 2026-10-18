import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/checkout/active-session` writes the ENG-784 hk-checkout-session cookie
 * with the locked attributes (httpOnly / lax / 45-min maxAge, in lockstep with
 * the Stripe session's expires_at), and refuses anything it should not store.
 * `@/lib/checkout-session-cookie` runs REAL so the attribute contract is
 * proven, not assumed.
 */

const cookieSetMock = vi.fn();

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: vi.fn(), set: cookieSetMock, delete: vi.fn() }),
}));

function post(body: unknown, contentType = "application/json"): Request {
  return new Request("http://localhost/api/checkout/active-session", {
    method: "POST",
    headers: { "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let POST: typeof import("./route").POST;

beforeEach(async () => {
  vi.clearAllMocks();
  ({ POST } = await import("./route"));
});

describe("POST /api/checkout/active-session", () => {
  it("sets the httpOnly/lax/45-min cookie and answers 204", async () => {
    const res = await POST(post({ sessionId: "cs_test_b1xfqW" }));

    expect(res.status).toBe(204);
    expect(cookieSetMock).toHaveBeenCalledWith({
      name: "hk-checkout-session",
      value: "cs_test_b1xfqW",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 45 * 60,
    });
  });

  it.each([
    ["missing", {}],
    ["not a string", { sessionId: 42 }],
    ["empty", { sessionId: "" }],
    ["cookie-unsafe characters", { sessionId: "cs_1; Path=/; Domain=evil" }],
    ["too long", { sessionId: `cs_${"a".repeat(300)}` }],
  ])("400s a sessionId that is %s, setting nothing", async (_label, body) => {
    const res = await POST(post(body));

    expect(res.status).toBe(400);
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it("400s a body that is not JSON", async () => {
    const res = await POST(post("not json"));

    expect(res.status).toBe(400);
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it("415s a non-JSON content type (a cross-site form POST), setting nothing", async () => {
    const res = await POST(post('{"sessionId":"cs_test_1"}', "text/plain"));

    expect(res.status).toBe(415);
    expect(cookieSetMock).not.toHaveBeenCalled();
  });
});
