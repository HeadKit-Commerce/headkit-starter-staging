"use client";

import { useState, type ReactElement } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  copyTestCardNumber,
  formatTestCardNumber,
  isStripeTestCheckout,
  STRIPE_TEST_CARDS,
  type CheckoutTestModeInput,
  type StripeTestCard,
} from "@/lib/checkout-test-mode";

/**
 * Sticky checkout banner shown only on Stripe test-key sessions.
 *
 * Stripe's Payment Element used to surface a copyable test-card popup inside
 * the iframe; custom Checkout (`ui_mode=custom`) does not reliably show it.
 * This is the storefront stand-in: a TEST MODE bar plus a popover of the
 * official cards, gated by {@link isStripeTestCheckout}. Never mounts on
 * live keys, Shopify hosted checkout, or a session-less (free / offline) page.
 */
export function CheckoutTestModeBanner(
  session: CheckoutTestModeInput,
): ReactElement | null {
  if (!isStripeTestCheckout(session)) {
    return null;
  }
  return <CheckoutTestModeBannerInner />;
}

function CheckoutTestModeBannerInner(): ReactElement {
  return (
    <div
      data-testid="checkout-test-mode-banner"
      className="sticky top-0 z-40 border-b border-[#4b3fd4] bg-[#635bff] text-white"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
        <p className="text-sm font-semibold tracking-wide">Test mode</p>
        <TestCardsPopover />
      </div>
    </div>
  );
}

function TestCardsPopover(): ReactElement {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="rounded-md bg-white/15 px-3 py-1 text-sm font-medium underline-offset-2 hover:bg-white/25"
          />
        }
      >
        Test cards
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-4" sideOffset={8}>
        <p className="text-sm font-semibold text-neutral-950">Test cards</p>
        <p className="mt-1 text-xs text-neutral-600">
          Copy a number into the payment form. Use any future expiry and any
          3-digit CVC.
        </p>
        <ul className="mt-3 space-y-2">
          {STRIPE_TEST_CARDS.map((card) => (
            <TestCardRow key={card.id} card={card} />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function TestCardRow({ card }: { card: StripeTestCard }): ReactElement {
  const [copied, setCopied] = useState(false);
  const formatted = formatTestCardNumber(card.number);

  return (
    <li className="flex items-start justify-between gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-neutral-700">{card.label}</p>
        <p className="font-mono text-sm tracking-wide text-neutral-950">
          {formatted}
        </p>
        <p className="text-xs text-neutral-500">{card.description}</p>
      </div>
      <button
        type="button"
        className="shrink-0 rounded px-2 py-1 text-xs font-medium text-[#635bff] hover:bg-[#635bff]/10"
        onClick={() => {
          void copyTestCardNumber(formatted).then((ok) => {
            if (!ok) return;
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </li>
  );
}
