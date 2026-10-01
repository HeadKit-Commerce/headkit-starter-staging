"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BillingAddressElement } from "@stripe/react-stripe-js/checkout";
import {
  buildCheckoutShippingAddressElementOptions,
  buildCheckoutShippingContacts,
} from "@/lib/checkout-address-seed";
import * as z from "zod";
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  isValidCheckoutPhone,
  CHECKOUT_PHONE_MESSAGE,
} from "@/components/checkout/utils";
import { PhoneInput } from "@/components/ui/phone-input-lazy";
import { useCheckoutActions } from "@/app/checkout/checkout-actions-context";

const addressSchema = z.object({
  billingAddress: z.object({
    firstName: z.string().min(1, "First Name is required"),
    lastName: z.string().min(1, "Last Name is required"),
    line1: z.string().min(1, "Address Line 1 is required"),
    line2: z.string().optional(),
    city: z.string().min(1, "City is required"),
    state: z.string().min(1, "State is required"),
    country: z.string().min(1, "Country is required"),
    postalCode: z.string().min(1, "Postal Code is required"),
    phone: z
      .string()
      .min(1, "Phone is required")
      .refine(isValidCheckoutPhone, CHECKOUT_PHONE_MESSAGE),
  }),
});

interface BillingAddressStepProps {
  enableStripe: boolean;
  onNext: (data: z.infer<typeof addressSchema>) => void;
  defaultValues?: z.infer<typeof addressSchema> | undefined;
  buttonLabel?: string | undefined;
}

const BillingAddressStep: React.FC<BillingAddressStepProps> = ({
  enableStripe,
  onNext,
  defaultValues = {
    billingAddress: {
      firstName: "",
      lastName: "",
      line1: "",
      line2: "",
      city: "",
      state: "",
      country: "",
      postalCode: "",
      phone: "",
    },
  },
  buttonLabel = "Next",
}) => {
  const { actions } = useCheckoutActions();
  /** When using Stripe BillingAddressElement, track completion and last value so we can enable submit and pass data even if form sync is delayed or value shape differs. */
  const [billingElementComplete, setBillingElementComplete] = useState(false);
  const [lastBillingValue, setLastBillingValue] = useState<{
    firstName: string;
    lastName: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    phone: string;
  } | null>(null);

  const form = useForm<z.infer<typeof addressSchema>>({
    resolver: zodResolver(addressSchema),
    defaultValues,
  });

  // CKA-04 (visible prefill): seed the Stripe BillingAddressElement from the
  // saved WP billing address via `contacts` at element CREATION (create-only —
  // ENG-755). The element key flips seeded↔empty so it remounts once (never
  // update()) when the async saved address arrives.
  const billingContacts = buildCheckoutShippingContacts(
    defaultValues.billingAddress,
  );
  const billingElementOptions =
    buildCheckoutShippingAddressElementOptions(billingContacts);

  const onSubmit = async (data: z.infer<typeof addressSchema>) => {
    const billingToUse = data.billingAddress?.line1
      ? data.billingAddress
      : lastBillingValue;
    const phone =
      (billingToUse?.phone?.trim() || data.billingAddress?.phone?.trim()) ?? "";
    const payload: z.infer<typeof addressSchema> = {
      billingAddress: billingToUse
        ? {
            firstName: billingToUse.firstName ?? "",
            lastName: billingToUse.lastName ?? "",
            line1: billingToUse.line1 ?? "",
            line2: billingToUse.line2,
            city: billingToUse.city ?? "",
            state: billingToUse.state ?? "",
            country: billingToUse.country ?? "",
            postalCode: billingToUse.postalCode ?? "",
            phone,
          }
        : (data.billingAddress ?? {
            firstName: "",
            lastName: "",
            line1: "",
            line2: undefined,
            city: "",
            state: "",
            country: "",
            postalCode: "",
            phone: "",
          }),
    };

    if (actions && payload.billingAddress?.line1) {
      const name = [
        payload.billingAddress.firstName,
        payload.billingAddress.lastName,
      ]
        .filter(Boolean)
        .join(" ")
        .trim();
      const [billingRes, phoneRes] = await Promise.all([
        actions.updateBillingAddress({
          ...(name ? { name } : {}),
          address: {
            line1: payload.billingAddress.line1,
            ...(payload.billingAddress.line2
              ? { line2: payload.billingAddress.line2 }
              : {}),
            city: payload.billingAddress.city,
            state: payload.billingAddress.state,
            postal_code: payload.billingAddress.postalCode,
            country: payload.billingAddress.country,
          },
        }),
        phone.trim()
          ? actions.updatePhoneNumber(phone)
          : Promise.resolve({ type: "success" as const }),
      ]);
      if (billingRes.type === "error")
        throw new Error(
          billingRes.error?.message ?? "Failed to update billing address",
        );
      if (phoneRes.type === "error")
        throw new Error(
          phoneRes.error?.message ?? "Failed to update phone number",
        );
    }
    onNext(payload);
  };

  if (enableStripe) {
    return (
      <Form {...form}>
        <div className="space-y-4">
          <BillingAddressElement
            // CKA-04: `contacts` at CREATION visibly prefills + auto-selects the
            // saved WP billing address (editable). Create-only (ENG-755 — passing
            // it to element.update() after mount 400s), so the key flips
            // seeded↔empty to force a fresh mount (never update()) once the async
            // saved address resolves. updateBillingAddress (onSubmit) still syncs
            // the session.
            key={billingContacts ? "seeded" : "empty"}
            options={billingElementOptions}
            onChange={(event) => {
              if (event.complete && event.value) {
                const { address, phone, firstName, lastName, name } =
                  event.value;
                const first = (name?.split(" ")?.[0] || firstName) ?? "";
                const last = (name?.split(" ")?.[1] || lastName) ?? "";
                const addr = address ?? {};
                const value = {
                  firstName: first,
                  lastName: last,
                  line1: addr.line1 ?? "",
                  line2: addr.line2 ?? "",
                  city: addr.city ?? "",
                  state: addr.state ?? "",
                  country: addr.country ?? "",
                  postalCode: addr.postal_code ?? "",
                  phone: phone ?? "",
                };
                setLastBillingValue(value);
                setBillingElementComplete(!!value.line1);
                form.setValue("billingAddress.firstName", value.firstName, {
                  shouldValidate: true,
                });
                form.setValue("billingAddress.lastName", value.lastName, {
                  shouldValidate: true,
                });
                form.setValue("billingAddress.line1", value.line1, {
                  shouldValidate: true,
                });
                form.setValue("billingAddress.line2", value.line2 ?? "", {
                  shouldValidate: true,
                });
                form.setValue("billingAddress.city", value.city, {
                  shouldValidate: true,
                });
                form.setValue("billingAddress.state", value.state, {
                  shouldValidate: true,
                });
                form.setValue("billingAddress.country", value.country, {
                  shouldValidate: true,
                });
                form.setValue("billingAddress.postalCode", value.postalCode, {
                  shouldValidate: true,
                });
                if ((value.phone ?? "").trim()) {
                  form.setValue("billingAddress.phone", value.phone ?? "", {
                    shouldValidate: true,
                  });
                }
                void form.trigger("billingAddress");
              } else {
                setBillingElementComplete(false);
              }
            }}
          />
          {/* Workaround: Stripe BillingAddressElement does not return phone in event.value. Remove when fixed. */}
          <FormField
            name="billingAddress.phone"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl>
                  <PhoneInput
                    value={field.value ?? ""}
                    onChange={(v) => {
                      field.onChange(v || "");
                      void form.trigger("billingAddress.phone");
                    }}
                    className="w-full"
                    placeholder="Enter phone number"
                    countries={["AU", "NZ"]}
                    defaultCountry="AU"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full"
            disabled={!form.formState.isValid}
            onClick={form.handleSubmit(onSubmit)}
            rightIcon="arrowRight"
          >
            {buttonLabel}
          </Button>
        </div>
      </Form>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          name="billingAddress.firstName"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>First Name</FormLabel>
              <FormControl>
                <Input type="text" placeholder="First Name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="billingAddress.lastName"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Last Name</FormLabel>
              <FormControl>
                <Input type="text" placeholder="Last Name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="billingAddress.line1"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address Line 1</FormLabel>
              <FormControl>
                <Input type="text" placeholder="Address Line 1" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          name="billingAddress.line2"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Address Line 2 (Optional)</FormLabel>
              <FormControl>
                <Input type="text" placeholder="Address Line 2" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-4">
          <FormField
            name="billingAddress.city"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>City</FormLabel>
                <FormControl>
                  <Input type="text" placeholder="City" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            name="billingAddress.state"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>State</FormLabel>
                <FormControl>
                  <Input type="text" placeholder="State" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField
            name="billingAddress.country"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Country</FormLabel>
                <FormControl>
                  <Input type="text" placeholder="Country" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            name="billingAddress.postalCode"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Postal Code</FormLabel>
                <FormControl>
                  <Input type="text" placeholder="Postal Code" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          name="billingAddress.phone"
          control={form.control}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <PhoneInput
                  value={field.value ?? ""}
                  onChange={(v) => field.onChange(v || "")}
                  className="w-full"
                  placeholder="Enter phone number"
                  countries={["AU", "NZ"]}
                  defaultCountry="AU"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          className="w-full"
          rightIcon="arrowRight"
          disabled={!form.formState.isValid || form.formState.isSubmitting}
          loading={form.formState.isSubmitting}
        >
          {buttonLabel}
        </Button>
      </form>
    </Form>
  );
};

export { BillingAddressStep };
