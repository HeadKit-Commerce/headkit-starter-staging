/**
 * The Contact step's sign-in is wired through `CheckoutForm.tsx`, which no unit
 * test renders (it needs Stripe.js). These pin the three joins a refactor could
 * silently cut — each one leaves a checkout that LOOKS fine:
 *
 *  - the live `useAuth` value must be OR'd over the server flag in BOTH
 *    components. The server flag is read from the cookie during the RSC render
 *    and stays false for a shopper who signs in mid-checkout, and the provider
 *    prefill gate (ENG-783) must see them as authed or the recreated session —
 *    created with the auth cookie, so a bound customer — is handed the one
 *    combination known to kill every Stripe element.
 *  - signing in must RECREATE the session on CONTACT through `onRefreshSession`;
 *    `refreshSession` is what expires the guest session it replaces.
 *  - the row and the step must share one `signInOpen` state.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "./CheckoutForm.tsx"), "utf8");

describe("CheckoutForm: the Contact step sign-in wiring", () => {
  it("ORs the live auth state over the server flag in both components", () => {
    const matches = source.match(
      /isAuthenticatedFromServer \|\| isAuthenticatedLive/g,
    );
    expect(matches).toHaveLength(2);
    expect(source).toMatch(
      /isAuthenticated: isAuthenticatedFromServer = false,/,
    );
  });

  it("gates the provider prefill on the combined flag, not the server one", () => {
    expect(source).toMatch(/sessionPrefillEmail && !isAuthenticated\b/);
    expect(source).not.toMatch(
      /sessionPrefillEmail && !isAuthenticatedFromServer/,
    );
  });

  it("recreates the session on CONTACT once the shopper has signed in", () => {
    expect(source).toMatch(
      /const handleSignedIn = async \(email: string\) => \{\s*if \(!onRefreshSession\) return;\s*await onRefreshSession\(email, CheckoutFormStepEnum\.CONTACT\);/,
    );
    expect(source).toContain("onSignedIn={handleSignedIn}");
  });

  it("shares one signInOpen state between the header row and the step", () => {
    expect(source).toMatch(
      /const \[signInOpen, setSignInOpen\] = useState\(false\)/,
    );
    expect(source).toContain("onSignInOpenChange={setSignInOpen}");
    expect(source.match(/signInOpen=\{signInOpen\}/g)).toHaveLength(2);
  });
});
