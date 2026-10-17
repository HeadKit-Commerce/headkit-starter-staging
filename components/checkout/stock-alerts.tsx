"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { StockAlertList } from "@/components/headkit-ui/stock-alert-list";
import { correctCartAction } from "@/app/checkout/actions";
import { getFullCartAction } from "@/lib/cart-actions";
import {
  planStockCorrections,
  type HoldOutcome,
  type StockAlert,
} from "@/lib/stock-hold";
import type { CartIssueLike } from "@/lib/cart-issues";

interface StockAlertsValue {
  alerts: StockAlert[];
  /** Replaces the alerts on show and scrolls them into view. */
  show: (alerts: StockAlert[]) => void;
  dismiss: (index: number) => void;
}

const StockAlertsContext = createContext<StockAlertsValue | null>(null);

/**
 * Holds the per-item stock alerts shown above the checkout steps (checkout
 * plan v3 §2). `initialAlerts` are the corrections the checkout page made at
 * entry (C1); C2 and C3 add theirs through `useStockRefusal`.
 */
export function StockAlertsProvider({
  initialAlerts = [],
  children,
}: {
  initialAlerts?: StockAlert[];
  children: ReactNode;
}) {
  const [alerts, setAlerts] = useState<StockAlert[]>(initialAlerts);
  const [revision, setRevision] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const show = useCallback((next: StockAlert[]) => {
    setAlerts(next);
    setRevision((r) => r + 1);
  }, []);
  const dismiss = useCallback((index: number) => {
    setAlerts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // The Pay button sits at the bottom of the page and the alerts at the top:
  // bring a new set into view so the shopper sees why nothing was charged.
  useEffect(() => {
    if (revision > 0) {
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [revision]);

  const value = useMemo(
    () => ({ alerts, show, dismiss }),
    [alerts, show, dismiss],
  );
  return (
    <StockAlertsContext.Provider value={value}>
      {alerts.length > 0 && (
        <div className="mx-auto max-w-6xl px-4 pt-6 pb-2">
          <StockAlertList ref={listRef} alerts={alerts} onDismiss={dismiss} />
        </div>
      )}
      {children}
    </StockAlertsContext.Provider>
  );
}

/** The checkout's alert API; a no-op outside the provider. */
export function useStockAlerts(): StockAlertsValue {
  return (
    useContext(StockAlertsContext) ?? {
      alerts: [],
      show: () => {},
      dismiss: () => {},
    }
  );
}

/**
 * Handles a refused stock check at C2 or C3 without leaving checkout:
 * removes unavailable lines and reduces short ones (keeping the Checkout
 * Session, which the cart change then re-syncs), and shows one alert per item.
 * A hold that could not be placed shows the retry alert. When the corrections
 * empty the cart, the shopper is sent to the bag with the same alerts — the
 * only case that leaves checkout.
 */
export function useStockRefusal(): (outcome: HoldOutcome) => Promise<void> {
  const { cartData, setCartData, setBagAlerts, toggleCart } = useCartContext();
  const { show } = useStockAlerts();
  const router = useRouter();

  return useCallback(
    async (outcome: HoldOutcome) => {
      if (outcome.status === "unavailable") {
        show([{ kind: "hold_failed" }]);
        return;
      }
      if (outcome.status !== "refused") return;

      const { corrections, alerts } = planStockCorrections(
        outcome.issues,
        cartData?.items ?? [],
      );
      const shown: StockAlert[] =
        alerts.length > 0 ? alerts : [{ kind: "unnamed" }];
      // Only a cart that actually changed is written back. Writing an
      // unchanged cart would re-run the sync effect into the same refusal,
      // forever; an issue no line can be tied to is shown and left to the
      // shopper instead.
      if (corrections.length === 0) {
        show(shown);
        return;
      }
      const next =
        (await correctCartAction(corrections)) ??
        (await getFullCartAction().catch(() => null));
      if (!next) {
        show(shown);
        return;
      }
      setCartData(next);

      if (next.itemsCount === 0) {
        setBagAlerts(shown);
        toggleCart(true);
        router.push("/");
        return;
      }
      show(shown);
    },
    [cartData, setCartData, setBagAlerts, toggleCart, show, router],
  );
}

/** Structural read of the issues a sync refusal carried (route JSON). */
export function issuesFromSyncBody(body: unknown): CartIssueLike[] {
  const issues = (body as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as CartIssueLike[]) : [];
}
