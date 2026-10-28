import { describe, expect, it } from "vitest";
import { withoutResetCredentials } from "./reset-password-link";

describe("withoutResetCredentials", () => {
  const base = "https://shop.example.test/account/reset-password";

  it("drops key and login and keeps the path", () => {
    expect(withoutResetCredentials(`${base}?key=abc&login=jo`)).toBe(
      "/account/reset-password",
    );
  });

  it("keeps unrelated params and the hash", () => {
    expect(
      withoutResetCredentials(`${base}?utm_source=email&key=a&login=b#x`),
    ).toBe("/account/reset-password?utm_source=email#x");
  });

  it("returns null when there is nothing to strip", () => {
    expect(withoutResetCredentials(base)).toBeNull();
    expect(withoutResetCredentials(`${base}?utm_source=email`)).toBeNull();
  });
});
