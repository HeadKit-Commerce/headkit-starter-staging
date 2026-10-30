"use client";

import React, { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ContactDetailsElement,
  useCheckout,
} from "@stripe/react-stripe-js/checkout";
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
import { Checkbox } from "@/components/ui/checkbox";
import { updateCustomerAddressAction } from "@/lib/cart-actions";
import { decideContactSubmit } from "@/lib/contact-email-submit";
import { useCheckoutActions } from "@/app/checkout/checkout-actions-context";
import { useToast } from "@/hooks/use-toast";
import { CheckoutFormStepEnum } from "@/components/checkout/utils";
import { subscribeEmailAction } from "@/lib/email-marketing-actions";
import { reportSubscribeOutcome } from "@/lib/subscribe-outcome";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { useAuth } from "@/components/headkit-ui/auth-context";
import { CheckoutSignInForm } from "@/components/checkout/steps/checkout-sign-in-form";

const contactSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email"),
  newsletter: z.boolean(),
});

interface ContactFormStepProps {
  enableStripe: boolean;
  onNext: (data: {
    email: string;
    newsletter: boolean;
  }) => void | Promise<void>;
  buttonLabel?: string;
  defaultValues?: { email?: string; newsletter?: boolean };
  /** When provided, creates a new checkout session and updates cart on email submit instead of using Stripe updateEmail. */
  onRefreshSession?: (email: string, nextStep: string) => Promise<void>;
  /** When false/undefined, hide the newsletter opt-in (no email marketing provider). */
  emailMarketingEnabled?: boolean;
  /**
   * Whether the inline customer sign-in panel replaces the step body. Owned by
   * `CheckoutSteps` because the control that toggles it renders in the
   * accordion's header band (`ContactAccountRow`), not here.
   */
  signInOpen?: boolean;
  onSignInOpenChange?: (open: boolean) => void;
  /**
   * Called with the account email once a shopper signs in from this step. The
   * caller recreates the Checkout Session so the draft order is stamped with
   * the customer and the ContactDetailsElement shows the account email — the
   * element takes no options in Checkout Sessions custom mode and the provider
   * reads `defaultValues.email` once at mount, so only a new session can.
   */
  onSignedIn?: (email: string) => void | Promise<void>;
}

const ContactFormStep: React.FC<ContactFormStepProps> = ({
  enableStripe,
  onNext,
  defaultValues = { email: "", newsletter: false },
  buttonLabel = "Next",
  onRefreshSession,
  emailMarketingEnabled = false,
  signInOpen = false,
  onSignInOpenChange,
  onSignedIn,
}) => {
  const checkoutState = useCheckout();
  // The store's own customer session (NOT Stripe Link).
  const { isAuthenticated, user } = useAuth();
  const { actions } = useCheckoutActions();
  const { setCartData } = useCartContext();
  const { toast } = useToast();
  const form = useForm<z.infer<typeof contactSchema>>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      ...defaultValues,
      email: defaultValues.email ?? "",
      newsletter: defaultValues.newsletter ?? false,
    },
  });

  // ENG-801 (quick-260714-n0w): the Stripe path renders the
  // ContactDetailsElement ALWAYS — single mode, no toggle. The returning-
  // shopper prefill is delivered one level UP, via CheckoutElementsProvider
  // `options.defaultValues.email` (stripe-js checkout.d.ts:40-50), which
  // prefills the element's display, keeps it editable, and initiates Link
  // auth for enrolled emails. Element-level options remain unsupported in
  // Checkout Sessions custom mode (Record<string, never>) — the element
  // itself takes no prefill prop. `hasPrefillEmail` only gates the
  // mount-time validation below so Continue enables without interaction
  // when a prefill exists.
  const hasPrefillEmail = !!(defaultValues.email ?? "").trim();

  // Prefill path: validate once on mount so isValid reflects the seeded
  // email and the submit button enables without user interaction.
  useEffect(() => {
    if (hasPrefillEmail) {
      void form.trigger("email");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync RHF when defaultValues.email arrives late (React Hook Form
  // defaultValues only apply on mount) — e.g. the async getFullCartAction
  // fill in CheckoutSteps. A late (post-provider-mount) prefill reaches
  // RHF/submit but NOT the element's display (provider defaultValues were
  // read at provider mount); the submit path's update-email branch is the
  // safety net that still lands it on the session.
  useEffect(() => {
    const incoming = defaultValues.email ?? "";
    const current = form.getValues("email");
    if (incoming && !current) {
      form.reset({
        email: incoming,
        newsletter: defaultValues.newsletter ?? false,
      });
      void form.trigger("email");
    }
  }, [defaultValues.email, defaultValues.newsletter, form]);

  const maybeSubscribe = (data: z.infer<typeof contactSchema>) => {
    // Best-effort list subscribe — never blocks checkout.
    if (emailMarketingEnabled && data.newsletter) {
      void reportSubscribeOutcome(
        subscribeEmailAction({
          email: data.email,
          source: "checkout",
        }),
        { source: "checkout" },
      );
    }
  };

  const handleSubmit = async (data: z.infer<typeof contactSchema>) => {
    try {
      // Branch selection is extracted to a pure, unit-tested helper — the
      // "update-email" branch is the safety net for any session whose email
      // is still empty at submit time (async-arriving prefill missed by the
      // provider defaultValues, or the bounded push not yet landed).
      const decision = decideContactSubmit({
        initialEmail: defaultValues.email ?? "",
        submittedEmail: data.email,
        sessionEmail:
          checkoutState.type === "success"
            ? (checkoutState.checkout.email ?? "")
            : null,
        hasRefreshSession: !!onRefreshSession,
      });

      // Recreate session only when email actually changed (avoids unnecessary session creation)
      if (decision === "recreate" && onRefreshSession) {
        // keepCheckoutSession: checkout-mounted — refreshSession itself
        // supersedes the old session deliberately (ENG-784).
        const result = await updateCustomerAddressAction(
          { billingAddress: { email: data.email } },
          { keepCheckoutSession: true },
        );
        if (!result.success) throw new Error(result.error);
        setCartData(result.cart);
        maybeSubscribe(data);
        await onRefreshSession(
          data.email,
          CheckoutFormStepEnum.DELIVERY_METHOD,
        );
        return;
      }

      // Scene 2: email prefilled from cart and Stripe already has email.
      // When email unchanged, do NOT call updateEmail (Stripe forbids it).
      // The cart still gets the email (checkout plan v3 §4.4): the store sends
      // Klaviyo's Started Checkout from WooCommerce's update-customer route,
      // so a returning shopper who never retypes their email would otherwise
      // never start a checkout as far as Klaviyo knows. Best effort — a failed
      // push never holds the shopper on this step.
      if (decision === "advance") {
        const pushed = await updateCustomerAddressAction(
          { billingAddress: { email: data.email } },
          { keepCheckoutSession: true },
        ).catch(() => null);
        if (pushed?.success) setCartData(pushed.cart);
        maybeSubscribe(data);
        await onNext(data);
        return;
      }

      // Stripe has no email (or email changed): update Stripe session and cart
      if (actions) {
        const res = await actions.updateEmail(data.email);
        if (res.type === "error")
          throw new Error(res.error?.message ?? "Failed to update email");

        const updateResult = await actions.runServerUpdate(async () => {
          const result = await updateCustomerAddressAction(
            { billingAddress: { email: data.email } },
            { keepCheckoutSession: true },
          );
          if (!result.success) throw new Error(result.error);
          setCartData(result.cart);
        });
        if (updateResult.type === "error") {
          throw new Error(
            updateResult.error?.message ?? "Failed to update email",
          );
        }
      } else {
        const res = await updateCustomerAddressAction(
          { billingAddress: { email: data.email } },
          { keepCheckoutSession: true },
        );
        if (!res.success) throw new Error(res.error);
      }

      maybeSubscribe(data);
      await onNext(data);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Error",
        description:
          err instanceof Error
            ? err.message
            : "Something went wrong. Please try again.",
      });
    }
  };

  // The inline sign-in panel REPLACES the step body: the email field, the
  // opt-in and Continue are all gone while it is up, so there is one thing to do.
  if (signInOpen && !isAuthenticated) {
    return (
      <CheckoutSignInForm
        onSuccess={async (email) => {
          onSignInOpenChange?.(false);
          try {
            // Land the account email on the CART before the caller recreates
            // the Checkout Session, so the two agree — the same write, with the
            // same `keepCheckoutSession` reasoning, as the recreate branch of
            // `handleSubmit` below (refreshSession supersedes the old session
            // itself, ENG-784, so letting this mutation expire it first would
            // race its own replacement). It lives here rather than in
            // CheckoutForm because that file may contain no
            // `updateCustomerAddressAction` at all — see `handleSignedIn` there.
            const result = await updateCustomerAddressAction(
              { billingAddress: { email } },
              { keepCheckoutSession: true },
            );
            if (!result.success) throw new Error(result.error);
            setCartData(result.cart);
            await onSignedIn?.(email);
          } catch {
            // The shopper IS signed in — only the checkout refresh failed, so
            // say that and leave them on a usable step rather than a dead one.
            toast({
              variant: "destructive",
              title: "Signed in",
              description:
                "We could not refresh your checkout. Please check your email address before continuing.",
            });
          }
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {isAuthenticated && user?.email ? (
        <p className="text-sm text-brand-fg" data-testid="contact-signed-in">
          Signed in as {user.email}
        </p>
      ) : null}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          {/* Prefill lives at the provider (CheckoutElementsProvider
              options.defaultValues.email); the element takes no options in
              custom mode (Record<string, never>). Typing drives Link. */}
          {/* ENG-783 fix2: ContactDetailsElement mounts ALWAYS (Callan
              directive ENG-801/n0w) — including for logged-in shoppers. When
              the session carries a bound email-ful customer, the element
              displays the fixed (uneditable) email — Stripe-doc-sanctioned —
              and Link stays available (session email presence is the Link
              gate). The authed loaderror was never the element itself; it was
              the provider-level defaultValues.email prefill colliding with the
              bound customer's email (gated in CheckoutForm.tsx). */}
          {enableStripe ? (
            <ContactDetailsElement
              onChange={(event) => {
                form.setValue("email", event.value.email);
                form.trigger("email");
              }}
            />
          ) : (
            <FormField
              name="email"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="Email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {emailMarketingEnabled ? (
            <FormField
              control={form.control}
              name="newsletter"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-2 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>
                      Email me with the latest news, products and special
                      offers.
                    </FormLabel>
                  </div>
                </FormItem>
              )}
            />
          ) : null}

          <Button
            type="submit"
            className="w-full"
            disabled={!form.formState.isValid || form.formState.isSubmitting}
            loading={form.formState.isSubmitting}
            rightIcon="arrowRight"
          >
            {buttonLabel}
          </Button>
        </form>
      </Form>
    </div>
  );
};

export { ContactFormStep, type ContactFormStepProps };
