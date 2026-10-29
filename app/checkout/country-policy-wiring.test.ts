import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The pre-charge country gate's policy reaches every gate, from its own read.
 *
 * A SOURCE scan, so it proves the props are named at each hop and nothing
 * more: it does not render the page, run a checkout or prove a value arrives.
 * The behaviour at each end is asserted beside it — `lib/country-policy.test.ts`
 * (the read), and the card, billing-step and wallet gate tests.
 */

const STARTER = join(import.meta.dirname, "..", "..");
const read = (file: string): string =>
  readFileSync(join(STARTER, file), "utf8");

describe("country policy wiring", () => {
  it("the checkout session gate reads the policy on its own, not off the branding bundle", () => {
    const gate = read("app/checkout/checkout-session-gate.tsx");
    expect(gate).toContain(
      'import { getCountryPolicy } from "@/lib/country-policy"',
    );
    expect(gate).toMatch(/getCountryPolicy\(\)/);
    expect(gate).toContain("countryPolicy={countryPolicy}");
    // Rendered by the page below its `await connection()` — the condition
    // that keeps the policy read (which throws inside its cached scope) out
    // of every prerender.
    const page = read("app/checkout/page.tsx");
    expect(page.indexOf("await connection()")).toBeGreaterThan(-1);
    expect(page.indexOf("await connection()")).toBeLessThan(
      page.indexOf("<CheckoutSessionGate"),
    );
  });

  it("the read depends on neither dashboard-api nor lib/branding", () => {
    const source = read("lib/country-policy.ts");
    expect(source).not.toMatch(/from "@\/lib\/branding"/);
    expect(source).not.toMatch(/DASHBOARD_API_/);
  });

  it("the page content hands it to the form", () => {
    expect(read("app/checkout/checkout-page-content.tsx")).toContain(
      "{...(countryPolicy && { countryPolicy })}",
    );
  });

  it("the form hands it to the wallet, the billing step and the payment step", () => {
    const form = read("app/checkout/CheckoutForm.tsx");
    const handOffs = form.match(
      /\{\.\.\.\(countryPolicy && \{ countryPolicy \}\)\}/g,
    );
    // ExpressCheckoutTop, CheckoutSteps, two BillingAddressStep mounts and
    // StripePaymentStep.
    expect(handOffs?.length).toBe(5);
    expect(read("components/checkout/express-checkout-top.tsx")).toContain(
      "{...(countryPolicy && { countryPolicy })}",
    );
  });
});
