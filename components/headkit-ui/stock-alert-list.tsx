"use client";

import { forwardRef } from "react";
import { stockAlertText, type StockAlert } from "@/lib/stock-hold";

/**
 * One dismissible amber alert per item a stock check removed or reduced
 * (checkout plan v3 §2.2). Rendered above the checkout steps and at the top of
 * the bag — never as a toast or a separate page.
 */
export const StockAlertList = forwardRef<
  HTMLDivElement,
  { alerts: ReadonlyArray<StockAlert>; onDismiss: (index: number) => void }
>(function StockAlertList({ alerts, onDismiss }, ref) {
  if (alerts.length === 0) return null;
  return (
    <div ref={ref} role="alert" className="space-y-2" data-stock-alerts="">
      {alerts.map((alert, index) => (
        <div
          key={`${alert.kind}-${index}`}
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
        >
          <svg
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <p className="flex-1 text-sm text-amber-800">
            {stockAlertText(alert)}
          </p>
          <button
            type="button"
            onClick={() => onDismiss(index)}
            aria-label="Dismiss"
            className="shrink-0 rounded p-0.5 text-amber-500 hover:bg-amber-100 hover:text-amber-700"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
});
