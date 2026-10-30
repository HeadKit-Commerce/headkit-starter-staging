"use client";

/**
 * "Have an account? Sign in" / "Checkout as guest" in the Contact step's HEADER
 * BAND — `AccordionWrapper`'s `rightMenu` slot, rendered only while the step is
 * active. The sign-in panel it toggles lives in `ContactFormStep` (a sibling of
 * this row, not a child), which is why `signInOpen` is owned by `CheckoutSteps`.
 *
 * A signed-in shopper sees nothing here, and there is deliberately no sign-OUT
 * control: on this storefront `AuthProvider.signOut` calls `clearCartTokenAction()`,
 * which deletes the httpOnly `hk-cart-token` cookie, so a sign-out at the Contact
 * step would empty the cart under the shopper. Restoring the control needs a cart
 * hand-over on sign-out, which is session work outside the checkout page.
 */

import { Button } from "@/components/ui/button";

const ACTION_CLASS =
  "p-0! h-fit! leading-none! text-base font-medium text-brand-fg underline hover:text-primary hover:opacity-100";

interface ContactAccountRowProps {
  /** Whether the inline sign-in panel is currently showing. */
  signInOpen: boolean;
  onSignInOpenChange: (open: boolean) => void;
  /** Whether a customer session is active. */
  isAuthenticated: boolean;
}

const ContactAccountRow: React.FC<ContactAccountRowProps> = ({
  signInOpen,
  onSignInOpenChange,
  isAuthenticated,
}) => {
  if (isAuthenticated) return null;

  return (
    <div className="flex justify-end gap-1 text-base">
      <span className="hidden lg:block">
        {signInOpen ? "Checkout as" : "Have an account?"}
      </span>
      <Button
        type="button"
        variant="link"
        className={ACTION_CLASS}
        onClick={(e) => {
          // The accordion card carries its own click handler once the step is
          // completed; without this the toggle also re-navigates the accordion.
          e.stopPropagation();
          onSignInOpenChange(!signInOpen);
        }}
      >
        {signInOpen ? "Guest" : "Sign in"}
      </Button>
    </div>
  );
};

export { ContactAccountRow, ACTION_CLASS as CONTACT_ACCOUNT_ACTION_CLASS };
