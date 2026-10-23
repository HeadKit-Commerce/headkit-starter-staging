import type { CartFieldsFragment } from "@headkit/sdk";
import type { CartCorrection } from "./stock-hold";

/** What the correction endpoint answered. */
export interface CartCorrectionResult {
  /** Every correction applied. */
  ok: boolean;
  /** The cart now — corrected, or re-read after a failure; null when none. */
  cart: CartFieldsFragment | null;
}

/**
 * Asks `/api/checkout/correct-cart` to apply a stock refusal's corrections.
 * Null when the endpoint could not be reached at all. A Route Handler, not a
 * Server Action — that route's header says why (a cookie-setting action
 * re-renders /checkout, which can redirect it to /checkout/error).
 */
export async function requestCartCorrection(
  corrections: ReadonlyArray<CartCorrection>,
): Promise<CartCorrectionResult | null> {
  try {
    const res = await fetch("/api/checkout/correct-cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ corrections }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      ok?: boolean;
      cart?: CartFieldsFragment | null;
    };
    return { ok: body.ok === true, cart: body.cart ?? null };
  } catch {
    return null;
  }
}

/** The corrections in a request body, or null when it is not exactly that. */
export function parseCorrections(body: unknown): CartCorrection[] | null {
  const raw = (body as { corrections?: unknown } | null)?.corrections;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 50) return null;
  const out: CartCorrection[] = [];
  for (const c of raw) {
    const itemKey = (c as { itemKey?: unknown } | null)?.itemKey;
    const action = (c as { action?: unknown } | null)?.action;
    const quantity = (c as { quantity?: unknown } | null)?.quantity;
    if (typeof itemKey !== "string" || itemKey.length === 0) return null;
    if (action !== "remove" && action !== "reduce") return null;
    if (
      typeof quantity !== "number" ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      (action === "reduce" && quantity === 0)
    ) {
      return null;
    }
    out.push({ itemKey, action, quantity });
  }
  return out;
}
