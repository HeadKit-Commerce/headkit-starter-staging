"use client";

import { InstantLink } from "@/components/headkit-ui/instant-link";
import { CheckIcon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/headkit-ui/auth-context";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { SearchDrawer } from "@/components/headkit-ui/lazy-search-drawer";
import { useChromeIcons } from "@/components/branding/branding-icons-provider";
import { useIsQuoteMode } from "@/components/checkout/checkout-mode-provider";
import { PlusIcon } from "@/components/icon";
import {
  HeaderActionExtras,
  MobileHeaderActionExtras,
} from "@/overrides/header-actions";
import type { NavStyle } from "@/lib/store-theme";

interface HeaderActionsProps {
  /**
   * Cart item count pre-fetched server-side to avoid CLS on initial render.
   * The client will update it live once the cart loads.
   */
  initialCartCount?: number;
  /** Desktop presentation — icons (default) or uppercase text labels. */
  navStyle?: NavStyle;
}

/**
 * Right-side header icon row: Search · Wishlist · Account · [overrides] · Cart
 *
 * Icons come from the branding icon library (default Heroicons 2).
 * Colour: primary at rest, slight opacity drop on hover.
 * Extra actions (e.g. phone) come from `overrides/header-actions`.
 */
export function HeaderActions({
  initialCartCount = 0,
  navStyle = "icons",
}: HeaderActionsProps) {
  const { isAuthenticated } = useAuth();
  const { cartData, optimisticCart, toggleCart } = useCartContext();
  const cartCount =
    (optimisticCart ?? cartData)?.itemsCount ?? initialCartCount;
  const { Search, Heart, User, Cart } = useChromeIcons();
  const isQuoteMode = useIsQuoteMode();
  const textLabels = navStyle === "text-labels";

  if (textLabels) {
    return (
      <div className="headkit-nav-actions headkit-nav-actions--text flex items-center gap-5 uppercase text-[15px] tracking-[0.05em]">
        <SearchDrawer
          trigger={
            <Button
              variant="ghost"
              className="h-auto px-0 py-0 font-body font-normal uppercase tracking-[0.05em] text-primary hover:bg-transparent hover:opacity-70"
            >
              Search
            </Button>
          }
        />

        <Button
          variant="ghost"
          className="relative h-auto px-0 py-0 font-body font-normal uppercase tracking-[0.05em] text-primary hover:bg-transparent hover:opacity-70"
          asChild
        >
          <InstantLink
            href="/account"
            aria-label={isAuthenticated ? "Account (signed in)" : "Account"}
          >
            my account
            {isAuthenticated ? (
              <span className="sr-only"> (signed in)</span>
            ) : null}
          </InstantLink>
        </Button>

        <HeaderActionExtras />

        {isQuoteMode ? (
          <Button
            variant="ghost"
            className="relative h-auto px-0 py-0 font-body font-normal uppercase tracking-[0.05em] text-primary hover:bg-transparent hover:opacity-70"
            onClick={() => toggleCart(true)}
          >
            my quote [{cartCount}]
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="relative h-auto px-0 py-0 font-body font-normal uppercase tracking-[0.05em] text-primary hover:bg-transparent hover:opacity-70"
            onClick={() => toggleCart(true)}
          >
            cart [{cartCount}]
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="headkit-nav-actions flex items-center">
      <SearchDrawer
        trigger={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search"
            className="h-9 w-9 justify-end pr-0"
          >
            <Search className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
          </Button>
        }
      />

      <Button
        variant="ghost"
        size="icon"
        aria-label="Wishlist"
        className="h-9 w-9 justify-end pr-0"
        asChild
      >
        <InstantLink href="/account/wishlist" aria-label="Wishlist">
          <Heart className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
        </InstantLink>
      </Button>

      <Button
        variant="ghost"
        size="icon"
        aria-label={isAuthenticated ? "Account (signed in)" : "Account"}
        className="relative h-9 w-9 justify-end pr-0"
        asChild
      >
        <InstantLink
          href="/account"
          aria-label={isAuthenticated ? "Account (signed in)" : "Account"}
        >
          <User className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
          {isAuthenticated && <AccountLoggedInBadge />}
        </InstantLink>
      </Button>

      <HeaderActionExtras />

      {isQuoteMode ? (
        <Button
          variant="default"
          size="sm"
          aria-label="My Quote"
          className="relative ml-5 h-9 gap-1.5 pl-[10px] pr-3"
          onClick={() => toggleCart(true)}
        >
          <span>My Quote</span>
          <PlusIcon className="h-4 w-4" />
          <CartBadge
            count={cartCount}
            className="-right-1 -top-1 bg-brand-bg text-primary"
          />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Cart"
          className="relative h-9 w-9 justify-end pr-0"
          onClick={() => toggleCart(true)}
        >
          <Cart className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
          <CartBadge count={cartCount} className="right-0 top-[10px]" />
        </Button>
      )}
    </div>
  );
}

/**
 * Mobile variant: Search · Wishlist · Account · [overrides]
 * (Cart stays in the mobile header bar trigger, not duplicated here).
 *
 * Use `text-*` (currentColor), not `stroke-*` — Lucide / MD / FA packs
 * ignore Tailwind stroke colour utilities and would look unchanged.
 */
export function MobileHeaderActions() {
  const { isAuthenticated } = useAuth();
  const { Search, Heart, User } = useChromeIcons();
  return (
    <div className="flex items-center gap-4">
      <SearchDrawer
        trigger={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Search"
            className="h-9 w-9 p-0"
          >
            <Search className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
          </Button>
        }
      />

      <InstantLink href="/account/wishlist">
        <Heart className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
      </InstantLink>

      <span className="relative">
        <InstantLink
          href="/account"
          aria-label={isAuthenticated ? "Account (signed in)" : "Account"}
        >
          <User className="h-6 w-6 text-primary transition-opacity hover:opacity-70" />
        </InstantLink>
        {isAuthenticated && <AccountLoggedInBadge />}
      </span>

      <MobileHeaderActionExtras />
    </div>
  );
}

function AccountLoggedInBadge() {
  return (
    <span
      className={cn(
        "absolute right-0 top-[10px] z-10 flex h-[14px] min-w-[14px] items-center justify-center rounded-full",
        "bg-primary text-white",
      )}
    >
      <CheckIcon className="h-2.5 w-2.5 stroke-[2.5]" />
    </span>
  );
}

function CartBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "absolute z-10 h-[14px] min-w-[14px] rounded-full",
        "bg-primary text-center text-[10px] font-medium leading-[14px] text-white px-0.5",
        className ?? "right-0 top-[10px]",
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
