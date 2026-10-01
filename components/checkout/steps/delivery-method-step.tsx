"use client";

import React, { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ShippingAddressElement } from "@stripe/react-stripe-js/checkout";
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
import { PhoneInput } from "@/components/ui/phone-input-lazy";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  DeliveryStepEnum,
  getCheckoutAllowedCountries,
  isValidCheckoutPhone,
  CHECKOUT_PHONE_MESSAGE,
} from "@/components/checkout/utils";
import { updateCustomerAddressAction } from "@/lib/cart-actions";
import {
  buildCheckoutShippingAddressElementOptions,
  buildCheckoutShippingContacts,
  buildStripeAddressSeed,
  personalSavedShippingAddress,
} from "@/lib/checkout-address-seed";
import { useCheckoutActions } from "@/app/checkout/checkout-actions-context";
import { useToast } from "@/hooks/use-toast";

interface PickupLocation {
  address: string;
  city: string;
  country: string;
  /** ISO 2-letter country code (e.g. AU) — required for Stripe updateShippingAddress */
  countryCode: string;
  name: string;
  postcode: string;
  shippingMethodId: string;
  state: string;
}

const deliverySchema = z
  .object({
    deliveryMethod: z.nativeEnum(DeliveryStepEnum),
    location: z.string().optional(),
    shippingAddress: z
      .object({
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        line1: z.string().optional(),
        line2: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        country: z.string().optional(),
        postalCode: z.string().optional(),
        phone: z.string().optional(),
      })
      .optional(),
  })
  .superRefine((data, ctx) => {
    if (data.deliveryMethod === DeliveryStepEnum.SHIPPING_TO_HOME) {
      const addr = data.shippingAddress;
      if (!addr?.line1?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Address Line 1 is required",
          path: ["shippingAddress", "line1"],
        });
      }
      if (!addr?.city?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "City is required",
          path: ["shippingAddress", "city"],
        });
      }
      if (!addr?.state?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "State is required",
          path: ["shippingAddress", "state"],
        });
      }
      if (!addr?.country?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Country is required",
          path: ["shippingAddress", "country"],
        });
      }
      if (!addr?.postalCode?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Postal Code is required",
          path: ["shippingAddress", "postalCode"],
        });
      }
      if (!addr?.firstName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "First Name is required",
          path: ["shippingAddress", "firstName"],
        });
      }
      if (!addr?.phone?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Phone is required",
          path: ["shippingAddress", "phone"],
        });
      } else if (!isValidCheckoutPhone(addr.phone)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: CHECKOUT_PHONE_MESSAGE,
          path: ["shippingAddress", "phone"],
        });
      }
    }
    if (
      data.deliveryMethod === DeliveryStepEnum.CLICK_AND_COLLECT &&
      !data.location
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please select a pickup location",
        path: ["location"],
      });
    }
  });

type DeliveryFormData = z.infer<typeof deliverySchema>;

interface DeliveryMethodStepProps {
  enableStripe: boolean;
  onNext: (data: DeliveryFormData) => void | Promise<void>;
  defaultValues?: Partial<DeliveryFormData> | undefined;
  onChange?: ((data: Partial<DeliveryFormData>) => void) | undefined;
  buttonLabel?: string | undefined;
  pickupLocations: PickupLocation[];
  isLoading?: boolean | undefined;
}

const DeliveryMethodStep: React.FC<DeliveryMethodStepProps> = ({
  enableStripe,
  onNext,
  defaultValues = {},
  onChange,
  buttonLabel = "Next",
  pickupLocations,
  isLoading = false,
}) => {
  const { actions } = useCheckoutActions();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  /** When using Stripe ShippingAddressElement, track completion and last value so we can enable submit and pass data even if form sync is delayed or value shape differs. */
  const [shippingElementComplete, setShippingElementComplete] = useState(false);
  const [lastShippingValue, setLastShippingValue] = useState<{
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

  const form = useForm<DeliveryFormData>({
    resolver: zodResolver(deliverySchema),
    defaultValues: {
      deliveryMethod:
        defaultValues.deliveryMethod ?? DeliveryStepEnum.SHIPPING_TO_HOME,
      location: defaultValues.location ?? "",
      shippingAddress: defaultValues.shippingAddress ?? {
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
  });

  const deliveryMethod = form.watch("deliveryMethod");

  // Reload prefill (CKA-04/CKA-05): seed the saved WP shipping/billing address
  // into the Stripe Checkout Session on load via the Sessions-native
  // updateShippingAddress/updateBillingAddress — the same calls proven on submit
  // — so a logged-in shopper's address prefills and survives a page reload while
  // staying fully editable (options={{}} is retained — never the create-only
  // `contacts`, ENG-755). A4 guard: fired exactly once, and only after Stripe
  // `actions` are ready (useCheckoutActions resolves them when the session
  // mounts) and a seedable address is present. We do NOT re-seed afterward:
  // account-first-then-Link (CKA-05) — once the email authenticates Link, Link's
  // selected address wins in the UI and no WP<->Link sync is attempted.
  const savedShippingAddress = personalSavedShippingAddress(
    defaultValues.shippingAddress,
    pickupLocations,
  );
  // CKA-04 (visible prefill): the saved WP address (from the user-scoped cart)
  // prefills the Stripe ShippingAddressElement VISIBLY via the `contacts` option
  // passed at element CREATION (first contact auto-selected, still editable).
  // `updateShippingAddress` alone only sets the Checkout Session (server-side) —
  // it does NOT populate the element's inputs. `contacts` is create-only
  // (ENG-755: forwarding it to element.update() after mount 400s), so the
  // element `key` flips seeded↔empty and the element remounts once (never
  // update()) when the async saved address resolves.
  // Click & Collect leftovers are dropped — they must not appear as Stripe's
  // "Saved address" on Ship to home.
  const shippingContacts = buildCheckoutShippingContacts(
    savedShippingAddress,
    pickupLocations,
  );
  const stripeShippingOptions =
    buildCheckoutShippingAddressElementOptions(shippingContacts);
  const seededRef = useRef(false);
  useEffect(() => {
    if (!enableStripe || seededRef.current || !actions) return;
    if (deliveryMethod !== DeliveryStepEnum.SHIPPING_TO_HOME) return;
    const seed = buildStripeAddressSeed(savedShippingAddress);
    if (!seed) return;
    seededRef.current = true;
    // Session-side sync for rate/tax calc; visual prefill is via `contacts`.
    void actions.updateShippingAddress(seed);
    void actions.updateBillingAddress(seed);
  }, [enableStripe, actions, deliveryMethod, savedShippingAddress]);

  const isDisabled =
    isSubmitting ||
    (deliveryMethod === DeliveryStepEnum.SHIPPING_TO_HOME &&
      !form.formState.isValid) ||
    (deliveryMethod === DeliveryStepEnum.CLICK_AND_COLLECT &&
      !form.formState.isValid);

  const onSubmit = async (data: DeliveryFormData) => {
    setIsSubmitting(true);
    try {
      const shippingToUse = data.shippingAddress?.line1
        ? data.shippingAddress
        : lastShippingValue;
      const phone =
        (shippingToUse?.phone?.trim() || data.shippingAddress?.phone?.trim()) ??
        "";
      const payload: DeliveryFormData = {
        ...data,
        shippingAddress:
          data.deliveryMethod === DeliveryStepEnum.SHIPPING_TO_HOME &&
          shippingToUse
            ? {
                firstName: shippingToUse.firstName ?? "",
                lastName: shippingToUse.lastName ?? "",
                line1: shippingToUse.line1 ?? "",
                line2: shippingToUse.line2,
                city: shippingToUse.city ?? "",
                state: shippingToUse.state ?? "",
                country: shippingToUse.country ?? "",
                postalCode: shippingToUse.postalCode ?? "",
                phone,
              }
            : data.shippingAddress,
      };
      // Click & Collect: Stripe requires a shipping address. Use pickup location address.
      if (
        payload.deliveryMethod === DeliveryStepEnum.CLICK_AND_COLLECT &&
        payload.location &&
        actions
      ) {
        const loc = pickupLocations.find(
          (l) => l.shippingMethodId === payload.location,
        );
        const defaultCountry = getCheckoutAllowedCountries()[0] ?? "AU";
        const country = loc?.countryCode?.trim() || defaultCountry;
        const defaultPostcode = country === "NZ" ? "1010" : "2000";
        const addr = loc
          ? {
              line1: loc.address?.trim() || loc.name,
              city: loc.city?.trim() || "Pickup",
              state: loc.state?.trim() || "",
              postal_code: loc.postcode?.trim() || defaultPostcode,
              country,
            }
          : {
              line1: "Pickup",
              city: "Pickup",
              state: "",
              postal_code: defaultPostcode,
              country: defaultCountry,
            };
        const shippingResult = await actions.updateShippingAddress({
          name: loc?.name?.trim() || "Pickup",
          address: addr,
        });
        if (shippingResult.type === "error") {
          throw new Error(
            shippingResult.error?.message ??
              "Failed to update shipping address",
          );
        }
      }
      // Fail safe: for Ship to Home we MUST set a shipping address on the Stripe
      // session before advancing. If the address never made it into the payload
      // (Stripe element value not captured), do NOT proceed to Payment — surface a
      // clear error instead of silently advancing to a confirm() that Stripe rejects
      // with "A shipping address is required to confirm this Checkout Session".
      if (
        payload.deliveryMethod === DeliveryStepEnum.SHIPPING_TO_HOME &&
        !payload.shippingAddress?.line1
      ) {
        throw new Error(
          "Please enter a complete shipping address before continuing.",
        );
      }
      if (
        payload.deliveryMethod === DeliveryStepEnum.SHIPPING_TO_HOME &&
        payload.shippingAddress?.line1
      ) {
        if (actions) {
          const name = [
            payload.shippingAddress.firstName,
            payload.shippingAddress.lastName,
          ]
            .filter(Boolean)
            .join(" ")
            .trim();

          const [shippingAddressResult, billingAddressResult, phoneResult] =
            await Promise.all([
              actions.updateShippingAddress({
                ...(name ? { name } : {}),
                address: {
                  line1: payload.shippingAddress.line1,
                  ...(payload.shippingAddress.line2
                    ? { line2: payload.shippingAddress.line2 }
                    : {}),
                  city: payload.shippingAddress.city ?? "",
                  state: payload.shippingAddress.state ?? "",
                  postal_code: payload.shippingAddress.postalCode ?? "",
                  country: payload.shippingAddress.country ?? "",
                },
              }),
              actions.updateBillingAddress({
                ...(name ? { name } : {}),
                address: {
                  line1: payload.shippingAddress.line1,
                  ...(payload.shippingAddress.line2
                    ? { line2: payload.shippingAddress.line2 }
                    : {}),
                  city: payload.shippingAddress.city ?? "",
                  state: payload.shippingAddress.state ?? "",
                  postal_code: payload.shippingAddress.postalCode ?? "",
                  country: payload.shippingAddress.country ?? "",
                },
              }),
              actions.updatePhoneNumber(phone),
            ]);

          if (shippingAddressResult.type === "error") {
            throw new Error(
              shippingAddressResult.error?.message ??
                "Failed to update shipping address",
            );
          }

          if (billingAddressResult.type === "error") {
            throw new Error(
              billingAddressResult.error?.message ??
                "Failed to update billing address",
            );
          }

          if (phoneResult.type === "error") {
            throw new Error(
              phoneResult.error?.message ?? "Failed to update phone number",
            );
          }

          const updateResult = await actions.runServerUpdate(async () => {
            // keepCheckoutSession: checkout-mounted — the sync effect re-syncs
            // the live session afterwards (ENG-784).
            const result = await updateCustomerAddressAction(
              {
                shippingAddress: {
                  firstName: payload.shippingAddress!.firstName ?? "",
                  lastName: payload.shippingAddress!.lastName ?? "",
                  address1: payload.shippingAddress!.line1 ?? "",
                  address2: payload.shippingAddress!.line2 ?? "",
                  city: payload.shippingAddress!.city ?? "",
                  state: payload.shippingAddress!.state ?? "",
                  postcode: payload.shippingAddress!.postalCode ?? "",
                  country: payload.shippingAddress!.country ?? "",
                  phone: payload.shippingAddress!.phone ?? "",
                },
                billingAddress: {
                  firstName: payload.shippingAddress!.firstName ?? "",
                  lastName: payload.shippingAddress!.lastName ?? "",
                  address1: payload.shippingAddress!.line1 ?? "",
                  address2: payload.shippingAddress!.line2 ?? "",
                  city: payload.shippingAddress!.city ?? "",
                  state: payload.shippingAddress!.state ?? "",
                  postcode: payload.shippingAddress!.postalCode ?? "",
                  country: payload.shippingAddress!.country ?? "",
                  phone: payload.shippingAddress!.phone ?? "",
                },
              },
              { keepCheckoutSession: true },
            );

            if (!result.success) throw new Error(result.error);
          });
          if (updateResult.type === "error") {
            throw new Error(
              updateResult.error?.message ?? "Failed to update address",
            );
          }
        } else {
          const result = await updateCustomerAddressAction(
            {
              shippingAddress: {
                firstName: payload.shippingAddress.firstName ?? "",
                lastName: payload.shippingAddress.lastName ?? "",
                address1: payload.shippingAddress.line1 ?? "",
                address2: payload.shippingAddress.line2 ?? "",
                city: payload.shippingAddress.city ?? "",
                state: payload.shippingAddress.state ?? "",
                postcode: payload.shippingAddress.postalCode ?? "",
                country: payload.shippingAddress.country ?? "",
                phone: payload.shippingAddress.phone ?? "",
              },
            },
            { keepCheckoutSession: true },
          );
          if (!result.success) throw new Error(result.error);
        }
      }
      // Await so async parent handlers (cart rate selection, address sync)
      // reject into this catch and surface a toast instead of an unhandled
      // rejection that leaves the step silently stuck.
      await onNext(payload);
    } catch (err) {
      // Surface the error to the user (e.g. missing shipping address) and do NOT
      // advance to Payment — leaving the step active so they can correct it.
      const message =
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.";
      toast({
        title: "Could not continue",
        description: message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3 py-2" aria-hidden="true">
        <Skeleton className="h-5 w-48" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {pickupLocations.length > 0 && (
          <FormField
            name="deliveryMethod"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>How would you like to receive your order?</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={(value) => {
                      field.onChange(value);
                      onChange?.({ deliveryMethod: value as DeliveryStepEnum });
                    }}
                    value={field.value}
                    className="grid md:grid-cols-2 gap-4"
                  >
                    <FormLabel
                      htmlFor="click-collect"
                      className={cn(
                        "flex items-center space-x-2 cursor-pointer h-[40px] px-[16px] border rounded-brand",
                        field.value === DeliveryStepEnum.CLICK_AND_COLLECT &&
                          "border-primary",
                      )}
                    >
                      <RadioGroupItem
                        value={DeliveryStepEnum.CLICK_AND_COLLECT}
                        id="click-collect"
                      />
                      <span className="font-normal">
                        Free Click &amp; Collect
                      </span>
                    </FormLabel>
                    <FormLabel
                      htmlFor="ship-home"
                      className={cn(
                        "flex items-center space-x-2 cursor-pointer h-[40px] px-[16px] border rounded-brand",
                        field.value === DeliveryStepEnum.SHIPPING_TO_HOME &&
                          "border-primary",
                      )}
                    >
                      <RadioGroupItem
                        value={DeliveryStepEnum.SHIPPING_TO_HOME}
                        id="ship-home"
                      />
                      <span className="font-normal">Ship to Home</span>
                    </FormLabel>
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {deliveryMethod === DeliveryStepEnum.CLICK_AND_COLLECT && (
          <FormField
            name="location"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Select your store to collect from</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    value={field.value ?? ""}
                    className="flex flex-col gap-3"
                  >
                    {pickupLocations.map((location) => (
                      <div
                        key={location.shippingMethodId}
                        className="flex items-center space-x-2 cursor-pointer w-fit"
                      >
                        <RadioGroupItem
                          value={location.shippingMethodId}
                          id={location.shippingMethodId}
                        />
                        <FormLabel htmlFor={location.shippingMethodId}>
                          <div className="flex flex-col gap-1">
                            <div className="font-medium">{location.name}</div>
                            <div className="text-gray-500">
                              {location.address}, {location.city}{" "}
                              {location.postcode}
                            </div>
                          </div>
                        </FormLabel>
                      </div>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {deliveryMethod === DeliveryStepEnum.SHIPPING_TO_HOME &&
          (enableStripe ? (
            <>
              <ShippingAddressElement
                // CKA-04: `contacts` at element CREATION visibly prefills +
                // auto-selects the saved WP address (editable). It is create-only
                // (ENG-755 — passing it to element.update() after mount 400s), so
                // the key flips seeded↔empty to force a fresh mount (never an
                // update()) once the async saved address resolves.
                key={`${deliveryMethod}:${shippingContacts ? "seeded" : "empty"}`}
                options={stripeShippingOptions}
                onChange={(event) => {
                  if (event.complete && event.value) {
                    const { address, firstName, lastName, name } = event.value;
                    const first = (name?.split(" ")?.[0] || firstName) ?? "";
                    const last = (name?.split(" ")?.[1] || lastName) ?? "";
                    const addr = address ?? {};
                    const existingPhone =
                      form.getValues("shippingAddress.phone") ?? "";
                    const value = {
                      firstName: first,
                      lastName: last,
                      line1: addr.line1 ?? "",
                      line2: addr.line2 ?? "",
                      city: addr.city ?? "",
                      state: addr.state ?? "",
                      country: addr.country ?? "",
                      postalCode: addr.postal_code ?? "",
                      phone: existingPhone,
                    };
                    setLastShippingValue(value);
                    setShippingElementComplete(!!value.line1);
                    form.setValue(
                      "shippingAddress.firstName",
                      value.firstName,
                      { shouldValidate: true },
                    );
                    form.setValue("shippingAddress.lastName", value.lastName, {
                      shouldValidate: true,
                    });
                    form.setValue("shippingAddress.line1", value.line1, {
                      shouldValidate: true,
                    });
                    form.setValue("shippingAddress.line2", value.line2 ?? "", {
                      shouldValidate: true,
                    });
                    form.setValue("shippingAddress.city", value.city, {
                      shouldValidate: true,
                    });
                    form.setValue(
                      "shippingAddress.postalCode",
                      value.postalCode,
                      { shouldValidate: true },
                    );
                    form.setValue("shippingAddress.state", value.state, {
                      shouldValidate: true,
                    });
                    form.setValue("shippingAddress.country", value.country, {
                      shouldValidate: true,
                    });
                    void form.trigger("shippingAddress");
                  } else {
                    setShippingElementComplete(false);
                  }
                }}
              />
              {/* Official Custom Checkout + Adaptive Pricing path: ShippingAddressElement
                  still has no phone input (Stripe: use a separate UI + updatePhoneNumber).
                  Session create already sets phone_number_collection[enabled]=true. */}
              <FormField
                name="shippingAddress.phone"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value ?? ""}
                        onChange={(v) => {
                          const next = v || "";
                          field.onChange(next);
                          setLastShippingValue((prev) =>
                            prev ? { ...prev, phone: next } : prev,
                          );
                          void form.trigger("shippingAddress.phone");
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
            </>
          ) : (
            <>
              <FormField
                name="shippingAddress.firstName"
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
                name="shippingAddress.lastName"
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
                name="shippingAddress.line1"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address Line 1</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Address Line 1"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="shippingAddress.line2"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Address Line 2</FormLabel>
                    <FormControl>
                      <Input
                        type="text"
                        placeholder="Address Line 2"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                name="shippingAddress.city"
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
                name="shippingAddress.state"
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
              <FormField
                name="shippingAddress.country"
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
                name="shippingAddress.postalCode"
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
              <FormField
                name="shippingAddress.phone"
                control={form.control}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <PhoneInput
                        value={field.value ?? ""}
                        onChange={(v) => {
                          const next = v || "";
                          field.onChange(next);
                          setLastShippingValue((prev) =>
                            prev ? { ...prev, phone: next } : prev,
                          );
                          void form.trigger("shippingAddress.phone");
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
            </>
          ))}

        <Button
          type="submit"
          className="w-full"
          disabled={isDisabled}
          loading={isSubmitting}
          rightIcon="arrowRight"
        >
          {buttonLabel}
        </Button>
      </form>
    </Form>
  );
};

export { DeliveryMethodStep };
