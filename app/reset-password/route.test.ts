import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /reset-password", () => {
  it("307s to /account/reset-password with the query unchanged", () => {
    const res = GET(
      new Request(
        "https://shop.example.test/reset-password?key=AbC%2Bd%2Fe&login=jo%40x.test",
      ),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://shop.example.test/account/reset-password?key=AbC%2Bd%2Fe&login=jo%40x.test",
    );
  });

  it("stays on the request origin and port", () => {
    const res = GET(
      new Request("http://localhost:3000/reset-password?key=k&login=u"),
    );
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/account/reset-password?key=k&login=u",
    );
  });

  it("redirects a bare visit with no query", () => {
    const res = GET(new Request("https://shop.example.test/reset-password"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://shop.example.test/account/reset-password",
    );
  });
});
