"use client";

import type { ReactElement } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { GIFT_MESSAGE_MAX_LENGTH } from "@/lib/cart-attributes";
import type { CartTheme } from "@/lib/store-theme";

export interface CartDrawerExtrasProps {
  cart: CartTheme;
  selectedPackagingId: string;
  onPackagingChange: (id: string) => void;
  giftOpen: boolean;
  onGiftOpenChange: (open: boolean) => void;
  giftText: string;
  onGiftTextChange: (text: string) => void;
}

/**
 * Packaging and gift message pinned under the scrolling cart lines.
 * Both are omitted when the theme does not opt in.
 */
export function CartDrawerExtras({
  cart,
  selectedPackagingId,
  onPackagingChange,
  giftOpen,
  onGiftOpenChange,
  giftText,
  onGiftTextChange,
}: CartDrawerExtrasProps): ReactElement | null {
  const packaging = cart.packaging;
  const giftMessage = cart.giftMessage;
  if (!packaging && !giftMessage) return null;

  return (
    <div
      data-cart-pinned
      className="flex shrink-0 flex-col gap-4 border-t border-neutral-200 pt-4"
    >
      {packaging ? (
        <fieldset className="min-w-0">
          <legend className="text-sm font-medium text-primary">
            {packaging.title}
          </legend>
          <RadioGroup
            value={selectedPackagingId}
            onValueChange={onPackagingChange}
            className="mt-2 grid grid-cols-2 gap-2"
          >
            {packaging.options.map((option) => (
              <label
                key={option.id}
                className="flex cursor-pointer flex-col gap-2 rounded-md border border-neutral-200 p-2 has-[[data-checked]]:border-primary"
              >
                {option.image ? (
                  // Arbitrary merchant URLs are not in next/image remotePatterns.
                  // rounded-brand tracks branding --radius (square is 0). Bare
                  // `rounded` bakes Tailwind's 0.25rem and ignores cornerStyle.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={option.image}
                    alt=""
                    className="aspect-[4/3] w-full rounded-brand object-cover"
                  />
                ) : (
                  <span
                    aria-hidden
                    className="aspect-[4/3] w-full rounded-brand bg-neutral-200"
                  />
                )}
                <span className="flex items-start gap-2">
                  <RadioGroupItem
                    value={option.id}
                    id={`packaging-${option.id}`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-primary">
                      {option.title}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
        </fieldset>
      ) : null}
      {giftMessage ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <Checkbox
              id="cart-gift-message"
              checked={giftOpen}
              onCheckedChange={(checked) => onGiftOpenChange(checked === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="cart-gift-message"
              className="text-sm font-normal leading-snug"
            >
              {giftMessage.label}
            </Label>
          </div>
          {giftOpen ? (
            <Textarea
              value={giftText}
              maxLength={GIFT_MESSAGE_MAX_LENGTH}
              onChange={(event) => onGiftTextChange(event.target.value)}
              aria-label="Gift message"
              placeholder="Write a note to include with the order"
              rows={3}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
