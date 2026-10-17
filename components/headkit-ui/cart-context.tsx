"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useOptimistic,
  useTransition,
  useCallback,
  type ReactNode,
} from "react";
import type { CartFieldsFragment } from "@headkit/sdk";
import {
  BAG_ALERTS_PARAM,
  bagAlertsFromSearch,
  type StockAlert,
} from "@/lib/stock-hold";

type CartData = CartFieldsFragment;

type OptimisticAction =
  | { type: "update_quantity"; key: string; quantity: number }
  | { type: "remove_item"; key: string }
  | { type: "set_cart"; cart: CartData };

interface CartContextValue {
  cartData: CartData | null;
  optimisticCart: CartData | null;
  setCartData: (cart: CartData | null) => void;
  cartOpen: boolean;
  toggleCart: (open?: boolean) => void;
  isPending: boolean;
  optimisticUpdateQuantity: (key: string, quantity: number) => void;
  optimisticRemoveItem: (key: string) => void;
  startCartTransition: (fn: () => Promise<void>) => void;
  /**
   * Alerts the bag shows when checkout sent the shopper here because a stock
   * correction emptied the cart (lib/stock-hold.ts). Empty otherwise.
   */
  bagAlerts: StockAlert[];
  setBagAlerts: (alerts: StockAlert[]) => void;
}

const CartContext = createContext<CartContextValue | null>(null);

function cartReducer(
  state: CartData | null,
  action: OptimisticAction,
): CartData | null {
  if (!state) return state;

  switch (action.type) {
    case "update_quantity":
      return {
        ...state,
        items: state.items.map((item) =>
          item.key === action.key
            ? { ...item, quantity: action.quantity }
            : item,
        ),
      };
    case "remove_item": {
      const removed = state.items.find((item) => item.key === action.key);
      const qty = removed?.quantity ?? 1;
      const items = state.items.filter((item) => item.key !== action.key);
      return {
        ...state,
        items,
        itemsCount:
          items.length === 0 ? 0 : Math.max(0, state.itemsCount - qty),
      };
    }
    case "set_cart":
      return action.cart;
    default:
      return state;
  }
}

export function CartProvider({
  children,
  initialCart,
}: {
  children: ReactNode;
  initialCart?: CartData | null;
}) {
  const [cartData, setCartDataInternal] = useState<CartData | null>(
    initialCart ?? null,
  );
  const [cartOpen, setCartOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [bagAlerts, setBagAlerts] = useState<StockAlert[]>([]);

  // A server redirect from /checkout (a correction emptied the cart at checkout
  // entry) arrives as a full page load carrying ?bag_alerts=. Read it from
  // window.location in a mount effect, never through useSearchParams: this
  // provider is mounted by the root layout, and a request-time read there would
  // turn every route dynamic. Client-side checkout corrections set the alerts
  // directly instead (this provider outlives client navigation).
  useEffect(() => {
    const alerts = bagAlertsFromSearch(window.location.search);
    if (alerts.length === 0) return;
    setBagAlerts(alerts);
    setCartOpen(true);
    const url = new URL(window.location.href);
    url.searchParams.delete(BAG_ALERTS_PARAM);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const [optimisticCart, addOptimistic] = useOptimistic<
    CartData | null,
    OptimisticAction
  >(cartData, cartReducer);

  const setCartData = useCallback((cart: CartData | null) => {
    setCartDataInternal(cart);
  }, []);

  const toggleCart = useCallback((open?: boolean) => {
    setCartOpen((prev) => (open !== undefined ? open : !prev));
  }, []);

  const optimisticUpdateQuantity = useCallback(
    (key: string, quantity: number) => {
      addOptimistic({ type: "update_quantity", key, quantity });
    },
    [addOptimistic],
  );

  const optimisticRemoveItem = useCallback(
    (key: string) => {
      addOptimistic({ type: "remove_item", key });
    },
    [addOptimistic],
  );

  const startCartTransition = useCallback(
    (fn: () => Promise<void>) => {
      startTransition(async () => {
        await fn();
      });
    },
    [startTransition],
  );

  return (
    <CartContext.Provider
      value={{
        cartData,
        optimisticCart,
        setCartData,
        cartOpen,
        toggleCart,
        isPending,
        optimisticUpdateQuantity,
        optimisticRemoveItem,
        startCartTransition,
        bagAlerts,
        setBagAlerts,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCartContext(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCartContext must be used within CartProvider");
  }
  return ctx;
}
