import { redirect } from "next/navigation";
import { validateCartStock, autoCorrectCart } from "@/lib/cart-validation";
import type { CartFieldsFragment } from "@headkit/sdk";
import { getFullCartAction } from "@/lib/cart-actions";
import { getCustomer } from "@/lib/account-actions";
import { getAuthToken } from "@/lib/auth-cookie";
import { resolveCheckoutEmail } from "@/lib/checkout-email";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { getBranding } from "@/lib/branding";
import { normalizeCheckoutMode } from "@/lib/checkout-mode";
import { QuoteCheckout } from "@/components/quote/quote-checkout";
import { QuoteEmpty } from "@/components/quote/quote-empty";

/**
 * HeadKit Quote checkout — form-based enquiry flow (no Stripe).
 * Creates a WooCommerce order via the headkit-quote gateway (Quote status).
 */
export default async function QuoteCheckoutPage(): Promise<React.ReactElement> {
  // Same rule as `app/checkout/page.tsx`: a client prefetch is a runtime
  // prerender that resolves `cookies()`, so without this boundary it would
  // start the cart read below, abandon it, and resolve to `<QuoteEmpty />`.
  await connection();

  const { storeSettings } = await getBranding();
  const mode = normalizeCheckoutMode(storeSettings.checkoutType);
  if (mode !== "quote") {
    redirect("/checkout");
  }

  let cart = await getFullCartAction();

  if (!cart || cart.itemsCount === 0) {
    return <QuoteEmpty />;
  }

  const validation = validateCartStock(cart.items);
  let stockCorrectionMessage: string | null = null;

  if (!validation.isValid) {
    const correction = await autoCorrectCart(validation.issues);
    stockCorrectionMessage = correction.message;

    cart = await getFullCartAction();

    if (!cart || cart.itemsCount === 0) {
      return <QuoteEmpty />;
    }
  }

  const authToken = getAuthToken(await cookies());
  let fallbackEmail: string | undefined;
  if (authToken && !cart.billingAddress?.email?.trim()) {
    const customer = await getCustomer(authToken);
    if (customer.success && customer.data?.email) {
      fallbackEmail = customer.data.email;
    }
  }
  const customerEmail = resolveCheckoutEmail(cart, fallbackEmail);

  return (
    <div className="headkit-quote bg-brand-bg text-brand-fg">
      {stockCorrectionMessage ? (
        <div className="px-5 pt-6 md:px-10">
          <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
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
            <p className="text-sm text-amber-800">{stockCorrectionMessage}</p>
          </div>
        </div>
      ) : null}
      <QuoteCheckout
        initialCart={cart as unknown as CartFieldsFragment}
        {...(customerEmail ? { customerEmail } : {})}
      />
    </div>
  );
}
