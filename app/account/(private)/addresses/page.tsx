"use client";

import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { useState, useEffect } from "react";
import { useAuth } from "@/components/headkit-ui/auth-context";
import { useToast } from "@/hooks/use-toast";
import { getAddresses, updateAddress } from "@/lib/account-actions";
import {
  addressFormSchema,
  emptyAddressForm,
  toAddressInput,
  type AddressFormValues,
} from "@/lib/address-form";

// Generic UI-SPEC error copy — never surface a raw error/stack (T-03-AB3).
const LOAD_ERROR =
  "We couldn't load this right now. Refresh the page, or try again in a moment.";
const SAVE_ERROR =
  "We couldn't save your address right now. Please try again in a moment.";

type Section = "billing" | "shipping";

function AddressFields({
  form,
  section,
}: {
  form: UseFormReturn<AddressFormValues>;
  section: Section;
}) {
  const text = (
    name: keyof AddressFormValues[Section],
    label: string,
    placeholder: string,
    type: "text" | "email" | "tel" = "text",
  ) => (
    <FormField
      name={`${section}.${name}` as const}
      control={form.control}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input type={type} placeholder={placeholder} {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {text("firstName", "First Name", "First name")}
        {text("lastName", "Last Name", "Last name")}
      </div>
      {text("company", "Company (optional)", "Company")}
      {text("address1", "Street Address", "Street address")}
      {text(
        "address2",
        "Apartment, suite, etc. (optional)",
        "Apt, suite, etc.",
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {text("city", "City", "City")}
        {text("state", "State / Province (optional)", "State / province")}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {text("postcode", "Postcode", "Postcode")}
        {text("country", "Country", "Country")}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {text("email", "Email (optional)", "Email", "email")}
        {text("phone", "Phone (optional)", "Phone", "tel")}
      </div>
    </div>
  );
}

export default function Page() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Empty state: no saved address yet → show CTA before revealing the form.
  const [hasAddress, setHasAddress] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const { user } = useAuth();
  const { toast } = useToast();

  const form = useForm<AddressFormValues>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: emptyAddressForm,
  });

  useEffect(() => {
    const token = user?.token ?? "";
    if (!token) {
      setLoading(false);
      return;
    }
    getAddresses(token).then((result) => {
      if (result.success && result.data) {
        form.reset({
          billing: result.data.billing,
          shipping: result.data.shipping,
        });
        setHasAddress(result.data.hasAddress);
        setShowForm(result.data.hasAddress);
      } else {
        setError(LOAD_ERROR);
      }
      setLoading(false);
    });
  }, [user, form]);

  const handleSubmit = async (data: AddressFormValues) => {
    setError(null);
    const token = user?.token ?? "";
    const result = await updateAddress(token, {
      billing: toAddressInput(data.billing),
      shipping: toAddressInput(data.shipping),
    });
    if (result.success) {
      toast({ title: "Address saved" });
      if (result.data) {
        form.reset({
          billing: result.data.billing,
          shipping: result.data.shipping,
        });
        setHasAddress(result.data.hasAddress);
      }
    } else {
      setError(result.error ?? SAVE_ERROR);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl mb-6">Address Book</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-12 bg-gray-200 rounded" />
          <div className="h-12 bg-gray-200 rounded" />
          <div className="h-12 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl mb-6">Address Book</h1>

      {error && (
        <div className="mb-4 p-4 text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      {!hasAddress && !showForm ? (
        <div className="p-6 border border-dashed rounded-lg text-center">
          <p className="text-muted-foreground mb-4">
            No saved addresses. Add a billing or shipping address to speed up
            checkout.
          </p>
          <Button type="button" onClick={() => setShowForm(true)}>
            Add address
          </Button>
        </div>
      ) : (
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-8"
          >
            <section>
              <h2 className="text-lg mb-4">Billing Address</h2>
              <AddressFields form={form} section="billing" />
            </section>
            <section>
              <h2 className="text-lg mb-4">Shipping Address</h2>
              <AddressFields form={form} section="shipping" />
            </section>
            <Button
              type="submit"
              className="w-full"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "Saving…" : "Save address"}
            </Button>
          </form>
        </Form>
      )}
    </div>
  );
}
