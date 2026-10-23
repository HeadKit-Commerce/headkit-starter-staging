import { describe, expect, it } from "vitest";
import {
  buildStripeCartPaymentData,
  buildStripeOrderPaymentData,
} from "./checkout-payment-data";

/**
 * The `payment_data` keys are a contract with the theme (its duplicate-
 * finalize claim row is keyed on `checkout_session_id`). These pin both
 * arrays to the exact shape each return page sent before they were extracted,
 * so the extraction moved no key and changed no value.
 */

const SESSION = {
  paymentIntentId: "pi_1",
  paymentMethod: "card",
  livemode: true,
  cardBrand: "visa",
  cardLast4: "4242",
  walletType: "apple_pay",
  stripeCustomerId: "cus_1",
};

describe("buildStripeOrderPaymentData (order page)", () => {
  it("sends nine keys in order, then the customer", () => {
    expect(buildStripeOrderPaymentData("cs_1", SESSION)).toEqual([
      { key: "checkout_session_id", value: "cs_1" },
      { key: "payment_status", value: "paid" },
      { key: "payment_intent_id", value: "pi_1" },
      { key: "payment_method", value: "card" },
      { key: "payment_mode", value: "live" },
      { key: "payment_provider", value: "stripe" },
      { key: "card_brand", value: "visa" },
      { key: "card_last4", value: "4242" },
      { key: "wallet_type", value: "apple_pay" },
      { key: "stripe_customer_id", value: "cus_1" },
    ]);
  });

  it("fills blanks rather than dropping keys", () => {
    expect(buildStripeOrderPaymentData("cs_1", {})).toEqual([
      { key: "checkout_session_id", value: "cs_1" },
      { key: "payment_status", value: "paid" },
      { key: "payment_intent_id", value: "" },
      { key: "payment_method", value: "card" },
      { key: "payment_mode", value: "test" },
      { key: "payment_provider", value: "stripe" },
      { key: "card_brand", value: "" },
      { key: "card_last4", value: "" },
      { key: "wallet_type", value: "" },
    ]);
  });
});

describe("buildStripeCartPaymentData (cart page)", () => {
  it("sends three keys always and the rest only when present", () => {
    expect(buildStripeCartPaymentData("cs_1", SESSION)).toEqual([
      { key: "checkout_session_id", value: "cs_1" },
      { key: "payment_status", value: "paid" },
      { key: "payment_provider", value: "stripe" },
      { key: "payment_intent_id", value: "pi_1" },
      { key: "payment_method", value: "card" },
      { key: "card_brand", value: "visa" },
      { key: "card_last4", value: "4242" },
      { key: "wallet_type", value: "apple_pay" },
      { key: "payment_mode", value: "live" },
      { key: "stripe_customer_id", value: "cus_1" },
    ]);
    expect(buildStripeCartPaymentData("cs_1", {})).toEqual([
      { key: "checkout_session_id", value: "cs_1" },
      { key: "payment_status", value: "paid" },
      { key: "payment_provider", value: "stripe" },
    ]);
  });

  it("keeps the page's livemode rule: only undefined omits the mode", () => {
    expect(
      buildStripeCartPaymentData("cs_1", { livemode: null }).at(-1),
    ).toEqual({ key: "payment_mode", value: "test" });
  });
});
