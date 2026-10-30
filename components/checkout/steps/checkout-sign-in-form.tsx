"use client";

/**
 * The checkout-local customer sign-in panel: the store's own account sign-in
 * (`/account`), reached from the Contact step so a returning shopper does not
 * have to leave checkout to use it. It is NOT Stripe Link — Link rides the
 * ContactDetailsElement and is unrelated to a store account.
 *
 * It only authenticates. What checkout does next — landing the account email
 * on the cart and recreating the Checkout Session so the draft order carries
 * the customer — belongs to the caller (`onSuccess`), because that sequence
 * needs the step's cart context and `CheckoutSteps`' session refresh.
 *
 * It never renders a register form: `/account` owns that, and a shopper with
 * no account simply stays a guest.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import Link from "next/link";

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
import { useAuth } from "@/components/headkit-ui/auth-context";
import { login } from "@/lib/account-actions";

const signInSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

interface CheckoutSignInFormProps {
  /**
   * Called with the signed-in customer's email AFTER the auth token is stored.
   * The caller owns what checkout does next; this component only authenticates.
   */
  onSuccess: (email: string) => void | Promise<void>;
}

const CheckoutSignInForm: React.FC<CheckoutSignInFormProps> = ({
  onSuccess,
}) => {
  const [error, setError] = useState<string | null>(null);
  const { setAuthToken } = useAuth();

  const form = useForm<z.infer<typeof signInSchema>>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const handleSignIn = async (data: z.infer<typeof signInSchema>) => {
    setError(null);
    const result = await login(data.email, data.password);
    if (!result.success || !result.data) {
      // A wrong password leaves the shopper exactly where they were: still a
      // guest, cart and session untouched, with the panel up to try again or
      // go back to checking out as a guest.
      setError(result.error ?? "Invalid email or password");
      return;
    }

    // `setAuthToken` writes the `hk-auth-token` cookie synchronously via
    // `document.cookie` BEFORE this returns, so every server action the caller
    // fires next (cart write, session create) is already user-scoped.
    setAuthToken(result.data.token, {
      id: result.data.userId,
      email: result.data.email,
      firstName: result.data.firstName,
      lastName: result.data.lastName,
      refreshToken: result.data.refreshToken,
    });

    await onSuccess(result.data.email);
  };

  return (
    <div className="space-y-4" data-testid="checkout-sign-in">
      {error ? (
        <div
          role="alert"
          className="p-4 text-red-700 bg-red-50 border border-red-200 rounded-lg"
        >
          {error}
        </div>
      ) : null}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSignIn)} className="space-y-4">
          <FormField
            name="email"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="Enter your email"
                    autoComplete="username"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            name="password"
            control={form.control}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <Input
                    type="password"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="flex justify-between items-center">
            <Link
              href="/account/forgot-password"
              className="text-sm text-primary hover:underline"
            >
              Forgot Password?
            </Link>
            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
              loading={form.formState.isSubmitting}
            >
              Sign In
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export { CheckoutSignInForm, type CheckoutSignInFormProps };
