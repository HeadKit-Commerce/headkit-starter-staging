import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildCheckoutBillingAddressElementOptions,
  buildCheckoutShippingAddressElementOptions,
  buildCheckoutShippingContacts,
  buildStripeAddressSeed,
  contactsWithoutPhone,
  isPickupLocationAddress,
  personalSavedShippingAddress,
  savedShippingFromAddressInput,
  type SavedShippingAddress,
} from "@/lib/checkout-address-seed";

/**
 * Layer 4b — buildStripeAddressSeed (CKA-04/CKA-05).
 *
 * On load the delivery step seeds the saved WP shipping/billing address into
 * the Stripe Checkout Session via the Sessions-native
 * updateShippingAddress/updateBillingAddress — NOT the create-only `contacts`
 * option (ENG-755). This pure helper builds that payload from the delivery-form
 * address (or returns null when there is nothing seedable, so the guest path
 * fires no update). The wiring/fire-once effect is covered by Plan 05 E2E; the
 * mapping branches (present/absent, ISO country, empty-field handling) are
 * unit-tested here in the node vitest env (the app has no jsdom setup —
 * mirrors lib/address-form.ts).
 */

const FULL: SavedShippingAddress = {
  firstName: "Ada",
  lastName: "Lovelace",
  line1: "1 Analytical Way",
  line2: "Unit 5",
  city: "Sydney",
  state: "NSW",
  country: "AU",
  postalCode: "2000",
  phone: "0400000000",
};

describe("buildStripeAddressSeed (CKA-04/CKA-05)", () => {
  it("returns null when no address is provided (guest — fires no seed)", () => {
    expect(buildStripeAddressSeed(null)).toBeNull();
    expect(buildStripeAddressSeed(undefined)).toBeNull();
    expect(buildStripeAddressSeed({})).toBeNull();
  });

  it("returns null when line1 is missing (nothing to seed)", () => {
    expect(buildStripeAddressSeed({ ...FULL, line1: "" })).toBeNull();
    expect(buildStripeAddressSeed({ ...FULL, line1: "   " })).toBeNull();
  });

  it("returns null when country is missing (Stripe requires a country)", () => {
    expect(buildStripeAddressSeed({ ...FULL, country: "" })).toBeNull();
    expect(buildStripeAddressSeed({ ...FULL, country: undefined })).toBeNull();
  });

  it("maps a full saved address to the Stripe seed payload (ISO country, postal_code)", () => {
    const seed = buildStripeAddressSeed(FULL);
    expect(seed).toEqual({
      name: "Ada Lovelace",
      address: {
        line1: "1 Analytical Way",
        line2: "Unit 5",
        city: "Sydney",
        state: "NSW",
        postal_code: "2000",
        country: "AU",
      },
    });
  });

  it("omits an empty line2 rather than sending an empty string", () => {
    const seed = buildStripeAddressSeed({ ...FULL, line2: "" });
    expect(seed?.address).not.toHaveProperty("line2");
  });

  it("builds the name from first+last, omitting the name key when both are empty", () => {
    const seed = buildStripeAddressSeed({
      ...FULL,
      firstName: "",
      lastName: "",
    });
    expect(seed).not.toHaveProperty("name");
    expect(seed?.address.line1).toBe("1 Analytical Way");
  });

  it("trims fields and tolerates missing city/state/postcode (default to empty)", () => {
    const seed = buildStripeAddressSeed({
      firstName: "  Grace  ",
      line1: "  10 Hopper St  ",
      country: "  NZ  ",
    });
    expect(seed).toEqual({
      name: "Grace",
      address: {
        line1: "10 Hopper St",
        city: "",
        state: "",
        postal_code: "",
        country: "NZ",
      },
    });
  });
});

describe("buildCheckoutShippingAddressElementOptions", () => {
  it("returns empty object when there are no contacts (guest)", () => {
    expect(buildCheckoutShippingAddressElementOptions(undefined)).toEqual({});
    expect(buildCheckoutShippingAddressElementOptions([])).toEqual({});
  });

  it("passes contacts only — never fields (Checkout Session create contract)", () => {
    const contacts = [
      {
        name: "Ada Lovelace",
        address: {
          line1: "1 Analytical Way",
          city: "Sydney",
          state: "NSW",
          postal_code: "2000",
          country: "AU",
        },
      },
    ];
    const options = buildCheckoutShippingAddressElementOptions(contacts);
    expect(options).toEqual({ contacts });
    expect(options).not.toHaveProperty("fields");
    expect(JSON.stringify(options)).not.toContain('"fields"');
  });
});

describe("buildCheckoutShippingContacts", () => {
  it("returns undefined when there is no seedable address", () => {
    expect(buildCheckoutShippingContacts(null)).toBeUndefined();
    expect(buildCheckoutShippingContacts({})).toBeUndefined();
  });

  it("never puts phone on contacts even when the saved address has one", () => {
    const contacts = buildCheckoutShippingContacts(FULL);
    expect(contacts).toEqual([
      {
        name: "Ada Lovelace",
        address: {
          line1: "1 Analytical Way",
          line2: "Unit 5",
          city: "Sydney",
          state: "NSW",
          postal_code: "2000",
          country: "AU",
        },
      },
    ]);
    expect(contacts?.[0]).not.toHaveProperty("phone");
    expect(JSON.stringify(contacts)).not.toContain("phone");
  });
});

describe("contactsWithoutPhone", () => {
  it("strips phone from a contact that carried one", () => {
    const stripped = contactsWithoutPhone([
      {
        name: "Ada Lovelace",
        address: {
          line1: "1 Analytical Way",
          city: "Sydney",
          state: "NSW",
          postal_code: "2000",
          country: "AU",
        },
        phone: "0400000000",
      },
    ]);
    expect(stripped?.[0]).not.toHaveProperty("phone");
    expect(JSON.stringify(stripped)).not.toContain("phone");
  });
});

describe("buildCheckoutBillingAddressElementOptions", () => {
  const shippingWithPhone = {
    firstName: "Ada",
    lastName: "Lovelace",
    address1: "1 Analytical Way",
    address2: "Unit 5",
    city: "Sydney",
    state: "NSW",
    postcode: "2000",
    country: "AU",
    phone: "0400000000",
  };

  // The payment-step Elements instance runs with syncAddressCheckbox:"billing",
  // and Stripe renders that native checkbox only for an UNSEEDED billing
  // element. Seeding it from the shipping address swapped the checkbox for a
  // saved-address card ("Ada Lovelace / 1 Analytical Way / Change"), which is
  // how staging run 33193675514 failed `expectBillingSameAsShippingControl`.
  it("never seeds billing contacts from a shipping address", () => {
    const options = buildCheckoutBillingAddressElementOptions(
      // @ts-expect-error shippingAddress is no longer an accepted seed source
      { shippingAddress: shippingWithPhone },
    );
    expect(options).toEqual({});
    expect(options).not.toHaveProperty("contacts");
    expect(options).not.toHaveProperty("fields");
  });

  it("prefers remount contacts and still strips phone", () => {
    const options = buildCheckoutBillingAddressElementOptions({
      remountContacts: [
        {
          name: "Grace Hopper",
          address: {
            line1: "10 Hopper St",
            city: "Auckland",
            state: "AUK",
            postal_code: "1010",
            country: "NZ",
          },
          phone: "+64211234567",
        },
      ],
    });
    expect(options).toEqual({
      contacts: [
        {
          name: "Grace Hopper",
          address: {
            line1: "10 Hopper St",
            city: "Auckland",
            state: "AUK",
            postal_code: "1010",
            country: "NZ",
          },
        },
      ],
    });
    expect(JSON.stringify(options)).not.toContain("phone");
  });

  it("returns empty options when there is nothing to seed (guest)", () => {
    expect(buildCheckoutBillingAddressElementOptions({})).toEqual({});
    expect(
      buildCheckoutBillingAddressElementOptions({ remountContacts: null }),
    ).toEqual({});
    expect(
      buildCheckoutBillingAddressElementOptions({ remountContacts: [] }),
    ).toEqual({});
  });

  it("maps AddressInput-shaped shipping onto the seed without phone", () => {
    expect(savedShippingFromAddressInput(shippingWithPhone)).toEqual({
      firstName: "Ada",
      lastName: "Lovelace",
      line1: "1 Analytical Way",
      line2: "Unit 5",
      city: "Sydney",
      state: "NSW",
      country: "AU",
      postalCode: "2000",
    });
  });
});

const SYDNEY_PICKUP = {
  name: "Sydney Store",
  address: "123 George Street",
  city: "Sydney",
  postcode: "2000",
  countryCode: "AU",
};

describe("isPickupLocationAddress", () => {
  it("is false when there is no address or no pickup list", () => {
    expect(isPickupLocationAddress(undefined, [SYDNEY_PICKUP])).toBe(false);
    expect(isPickupLocationAddress(FULL, [])).toBe(false);
    expect(isPickupLocationAddress(FULL, undefined)).toBe(false);
  });

  it("is false for a real home address that is not a pickup location", () => {
    expect(isPickupLocationAddress(FULL, [SYDNEY_PICKUP])).toBe(false);
  });

  it("is true when the saved address is the Click & Collect store", () => {
    expect(
      isPickupLocationAddress(
        {
          line1: "123 George Street",
          city: "Sydney",
          postalCode: "2000",
          country: "AU",
        },
        [SYDNEY_PICKUP],
      ),
    ).toBe(true);
  });

  it("is true when checkout wrote the location name as line1 (empty store street)", () => {
    expect(
      isPickupLocationAddress(
        {
          line1: "Sydney Store",
          city: "Pickup",
          postalCode: "2000",
          country: "AU",
        },
        [{ ...SYDNEY_PICKUP, address: "" }],
      ),
    ).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(
      isPickupLocationAddress(
        {
          line1: "  123  GEORGE STREET ",
          city: "SYDNEY",
          postalCode: "2000",
          country: "au",
        },
        [SYDNEY_PICKUP],
      ),
    ).toBe(true);
  });
});

describe("personalSavedShippingAddress", () => {
  it("returns the address when it is not a pickup location", () => {
    expect(personalSavedShippingAddress(FULL, [SYDNEY_PICKUP])).toEqual(FULL);
  });

  it("returns undefined when the saved address is a Click & Collect store", () => {
    const storeAddr: SavedShippingAddress = {
      line1: "123 George Street",
      city: "Sydney",
      postalCode: "2000",
      country: "AU",
    };
    expect(
      personalSavedShippingAddress(storeAddr, [SYDNEY_PICKUP]),
    ).toBeUndefined();
  });
});

describe("buildCheckoutShippingContacts pickup exclusion", () => {
  it("does not emit Stripe contacts for a Click & Collect store address", () => {
    expect(
      buildCheckoutShippingContacts(
        {
          firstName: "",
          lastName: "",
          line1: "123 George Street",
          city: "Sydney",
          postalCode: "2000",
          country: "AU",
        },
        [SYDNEY_PICKUP],
      ),
    ).toBeUndefined();
  });

  it("still emits contacts for a personal home address", () => {
    const contacts = buildCheckoutShippingContacts(FULL, [SYDNEY_PICKUP]);
    expect(contacts?.[0]?.address.line1).toBe("1 Analytical Way");
  });
});

describe("ShippingAddressElement options source-scan", () => {
  it("delivery step never passes AddressElement fields to ShippingAddressElement", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../components/checkout/steps/delivery-method-step.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("buildCheckoutShippingAddressElementOptions");
    expect(source).toContain("options={stripeShippingOptions}");
    expect(source).toContain("<PhoneInput");
    expect(source).toContain("updatePhoneNumber");
    expect(source).not.toMatch(
      /<ShippingAddressElement[\s\S]{0,800}fields\s*[:=]/,
    );
  });

  it("helper source never mentions AddressElement fields as an accepted option", () => {
    const source = readFileSync(
      resolve(__dirname, "./checkout-address-seed.ts"),
      "utf8",
    );
    expect(source).toMatch(/Do NOT pass AddressElement `fields`/);
    expect(source).not.toMatch(/fields:\s*\{\s*phone/);
    expect(source).not.toMatch(
      /return\s*\[[\s\S]{0,200}\.\.\.\(phone \? \{ phone \}/,
    );
  });

  it("payment step never passes contacts[].phone or AddressElement phone fields", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../components/checkout/steps/stripe-checkout-step.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("buildCheckoutBillingAddressElementOptions");
    expect(source).not.toMatch(
      /<BillingAddressElement[\s\S]{0,800}fields\s*[:=]/,
    );
    expect(source).not.toMatch(/contacts:\s*\[[\s\S]{0,200}phone/);
    // Reseeding the payment-step billing element from the shipping address
    // hides Stripe's native billing-same-as-shipping checkbox.
    expect(source).not.toMatch(
      /buildCheckoutBillingAddressElementOptions\(\{[\s\S]{0,200}shippingAddress/,
    );
  });

  it("payment step unmounts BOTH address elements before confirm()", () => {
    const step = readFileSync(
      resolve(
        __dirname,
        "../components/checkout/steps/stripe-checkout-step.tsx",
      ),
      "utf8",
    );
    // Local (billing) unmount and the signal that unmounts the delivery step's
    // ShippingAddressElement must both fire before every confirm() path.
    const localUnmounts = step.match(/setHideBillingElement\(true\)/g) ?? [];
    const raisedSignals = step.match(/onConfirmingChange\?\.\(true\)/g) ?? [];
    expect(localUnmounts.length).toBeGreaterThan(0);
    expect(raisedSignals.length).toBe(localUnmounts.length);
    expect(step).toContain("onConfirmingChange?.(false)");

    // …and the form must actually honour the signal. Stripe rejects confirm()
    // with "You called confirm() while the Address Element is mounted, but you
    // previously also called updateShippingAddress()" otherwise.
    const form = readFileSync(
      resolve(__dirname, "../app/checkout/CheckoutForm.tsx"),
      "utf8",
    );
    expect(form).toContain("onConfirmingChange={setIsConfirmingPayment}");
    expect(form).toMatch(
      /keepMountedWhenInactive=\{[\s\S]{0,600}!isConfirmingPayment/,
    );
  });

  it("click-and-collect billing step never puts phone on contacts", () => {
    const source = readFileSync(
      resolve(
        __dirname,
        "../components/checkout/steps/billing-address-step.tsx",
      ),
      "utf8",
    );
    expect(source).toContain("buildCheckoutShippingAddressElementOptions");
    expect(source).not.toMatch(
      /<BillingAddressElement[\s\S]{0,800}fields\s*[:=]/,
    );
  });

  it("does not write Click & Collect pickup onto the Woo customer", () => {
    const source = readFileSync(
      resolve(__dirname, "../app/checkout/CheckoutForm.tsx"),
      "utf8",
    );
    expect(source).toContain("personalSavedAddressInput");
    expect(source).not.toContain("updateCustomerAddressAction");
    expect(source).toMatch(/Pickup goes onto the Stripe session only/);
  });

  it("Payment Element hides the wallets that the Express element owns", () => {
    // Since #665 Express Checkout on Payment Intents renders Apple Pay /
    // Google Pay at the top of the page, so the Payment Element hides them to
    // avoid a second set of wallet buttons. This used to assert "auto", the
    // pre-#665 contract, and has failed since that PR landed (unnoticed:
    // Build and Test stopped at Lint before reaching Test).
    const source = readFileSync(
      resolve(
        __dirname,
        "../components/checkout/steps/stripe-checkout-step.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(/applePay:\s*"never"/);
    expect(source).toMatch(/googlePay:\s*"never"/);
    expect(source).not.toMatch(/applePay:\s*"auto"/);
  });
});
