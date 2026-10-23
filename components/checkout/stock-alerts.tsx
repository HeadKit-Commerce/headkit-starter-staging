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
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { StockAlertList } from "@/components/headkit-ui/stock-alert-list";
import { requestCartCorrection } from "@/lib/checkout-cart-correction";
import {
  goToBag,
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
 *
 * The corrections go through `/api/checkout/correct-cart`, a Route Handler:
 * as a cookie-setting Server Action they re-rendered /checkout inside the
 * action's response, and an emptied cart then redirected to /checkout/error
 * before this hook could hand the shopper to the bag. The hand-off is a full
 * navigation to the same `?bag_alerts=` URL the server's entry redirect uses
 * (`goToBag`), so the bag opens on a fresh cart read.
 */
export function useStockRefusal(): (outcome: HoldOutcome) => Promise<void> {
  const { cartData, setCartData } = useCartContext();
  const { show } = useStockAlerts();

  return useCallback(
    async (outcome: HoldOutcome) => {
      if (outcome.status === "unavailable") {
        show([{ kind: "hold_failed" }]);
        return;
      }
      if (outcome.status !== "refused") return;

      const lines = cartData?.items ?? [];
      const { corrections, alerts } = planStockCorrections(
        outcome.issues,
        lines,
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
      const result = await requestCartCorrection(corrections);
      const next = result?.cart ?? null;
      // Removing a cart's LAST line can answer "session expired" and leave no
      // cart behind (see the route's header), so a correction that was
      // removing every line has emptied the cart even when it reports a
      // failure.
      const removesEverything =
        lines.length > 0 &&
        lines.every((line) =>
          corrections.some(
            (c) => c.itemKey === line.key && c.action === "remove",
          ),
        );
      // An emptied cart leaves BEFORE it reaches the page: published, it
      // would re-run the sync effect against a cart with nothing to pay for
      // while the navigation is still under way.
      if (
        (next && next.itemsCount === 0) ||
        (result && !next && removesEverything)
      ) {
        goToBag(shown);
        return;
      }
      if (next) setCartData(next);
      show(shown);
    },
    [cartData, setCartData, show],
  );
}

/** Structural read of the issues a sync refusal carried (route JSON). */
export function issuesFromSyncBody(body: unknown): CartIssueLike[] {
  const issues = (body as { issues?: unknown } | null)?.issues;
  return Array.isArray(issues) ? (issues as CartIssueLike[]) : [];
}
