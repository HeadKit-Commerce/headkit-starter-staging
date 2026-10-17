"use client";

import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

const getErrorMessage = (reason?: string): string => {
  switch (reason) {
    case "empty_cart":
      return "Your cart is empty. Add items to your cart to continue.";
    case "item_unavailable":
      return "An item in your cart is no longer available. Open your cart, remove it, and try again.";
    case "stock_correction_empty":
      return "Some items were out of stock and removed. Your cart is now empty.";
    case "stock_unavailable":
      return "An item in your order went out of stock before we could complete it. If a payment was taken it will be refunded — please review your cart and try again.";
    case "invalid_session":
      return "We couldn't prepare your checkout session. Please try again.";
    case "session_creation_failed":
      return "Checkout session could not be created. Please try again.";
    case "missing_data":
    case "missing_parameters":
      return "We couldn't find your checkout information. Please try again.";
    case "invalid_data":
      return "Your checkout information was invalid. Please try again.";
    case "missing_billing":
    case "missing_address":
      return "Address information is missing. Please complete all checkout steps.";
    case "missing_shipping":
      return "Shipping information is missing. Please try again.";
    case "order_creation_failed":
    case "checkout_failed":
    case "checkout_execution_error":
      return "We couldn't create your order. Please try again.";
    case "payment_failed":
      return "Your payment was not successful. Please check your payment details and try again.";
    case "payment_canceled":
      return "Your payment was cancelled and you have not been charged — your cart changed while the payment was in progress. Please review your cart and try again.";
    case "cart_changed":
      // Defensive copy — cart-changed flows normally land on /checkout with
      // the banner (ENG-784); this covers any direct/legacy link here.
      return "Your cart changed while your payment was in progress, so that payment was cancelled and nothing was charged. Please review your updated order and pay again.";
    case "session_expired":
      return "Your cart session has expired. Please add items to your cart and try again.";
    case "no_session":
      return "Your cart session has expired. Please start a new checkout.";
    case "processing_error":
      return "There was an error processing your order. Please try again.";
    default:
      return "There was a problem processing your payment. Please try again.";
  }
};

function ErrorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [showDetails, setShowDetails] = useState(false);

  const reason = searchParams.get("reason") ?? undefined;
  const errorDetails =
    searchParams.get("error") ?? searchParams.get("message") ?? undefined;
  const errorMessage = getErrorMessage(reason);

  let parsedError: unknown = null;
  if (errorDetails) {
    try {
      parsedError = JSON.parse(errorDetails);
    } catch {
      parsedError = errorDetails;
    }
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <div className="bg-white rounded-lg shadow-lg p-8 text-center space-y-6">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-16 h-16 mx-auto text-red-500"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>

        <h1 className="text-2xl text-gray-900">Payment Failed</h1>
        <p className="text-gray-600">{errorMessage}</p>

        {errorDetails && (
          <div className="mt-4">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-blue-600 underline text-sm"
            >
              {showDetails ? "Hide Details" : "Show Technical Details"}
            </button>
            {showDetails && (
              <div className="mt-2 p-4 bg-gray-100 rounded text-left overflow-auto max-h-60">
                <pre className="text-xs whitespace-pre-wrap">
                  {JSON.stringify(parsedError, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4">
          <Button onClick={() => router.push("/checkout")} className="w-full">
            Try Again
          </Button>
          <Button
            onClick={() => router.push("/")}
            variant="secondary"
            className="w-full"
          >
            Return to Home
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto px-4 py-12 max-w-3xl">
          <div className="bg-white rounded-lg shadow-lg p-8 text-center">
            <p className="text-gray-500">Loading…</p>
          </div>
        </div>
      }
    >
      <ErrorContent />
    </Suspense>
  );
}
