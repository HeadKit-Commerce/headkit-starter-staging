import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Known accordion step titles. Match CheckoutForm: Contact → Delivery →
 * Shipping Options → Payment. Content inside each step may still load
 * (Stripe), but the chrome is fixed and should not flash as anonymous bars.
 */
const STEPS: ReadonlyArray<{ order: number; title: string; active?: boolean }> =
  [
    { order: 1, title: "Contact", active: true },
    { order: 2, title: "Delivery" },
    { order: 3, title: "Shipping Options" },
    { order: 4, title: "Payment" },
  ];

function StepChrome({
  order,
  title,
  active,
  children,
}: {
  order: number;
  title: string;
  active?: boolean;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={cn(
        "relative mb-2 rounded-brand border bg-white px-5 py-5 md:px-10 md:py-5",
        active ? "border-primary shadow-sm" : "border-gray-200",
      )}
    >
      <div className="flex items-center gap-3 text-2xl font-extrabold">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
            active ? "bg-primary text-white" : "bg-gray-200 text-gray-500",
          )}
        >
          {order}
        </span>
        <span className={active ? "text-primary" : "text-gray-400"}>
          {title}
        </span>
      </div>
      {active && children ? <div className="mt-5 space-y-3">{children}</div> : null}
    </div>
  );
}

/**
 * Layout-stable placeholder while the Stripe Checkout Session mints or
 * Stripe.js resolves. Step titles are real; only the active step's fields
 * skeleton. Same rhythm as {@link AccordionWrapper}.
 */
export function CheckoutFormSkeleton(): React.ReactElement {
  return (
    <div
      data-testid="checkout-form-skeleton"
      className="space-y-2"
      aria-busy="true"
      aria-label="Loading checkout steps"
    >
      {/* Reserve express-checkout height so Apple/Google Pay mounting does not
          shove the accordion down. Mirrors ExpressCheckoutPi: label + wallet
          button + "Or" rule. Collapses only when the live form decides there
          is no wallet — same trade-off as waiting on Stripe either way. */}
      <div
        data-testid="checkout-express-skeleton"
        className="mb-2"
        aria-hidden="true"
      >
        <Skeleton className="mb-2 h-4 w-28" />
        <Skeleton className="h-12 w-full rounded-brand" />
        <div className="my-6 flex items-center gap-3">
          <div className="h-px flex-1 bg-gray-200" />
          <span className="text-xs uppercase tracking-wide text-gray-400">
            Or
          </span>
          <div className="h-px flex-1 bg-gray-200" />
        </div>
      </div>
      {STEPS.map((step) => (
        <StepChrome
          key={step.order}
          order={step.order}
          title={step.title}
          active={step.active}
        >
          {step.active ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-11 w-32" />
            </>
          ) : null}
        </StepChrome>
      ))}
    </div>
  );
}
