import {
  AmexIcon,
  ApplePayIcon,
  GooglePayIcon,
  MastercardIcon,
  VisaIcon,
} from "@/components/icon";

const ICONS = [
  { key: "visa", Icon: VisaIcon, label: "Visa" },
  { key: "mastercard", Icon: MastercardIcon, label: "Mastercard" },
  { key: "amex", Icon: AmexIcon, label: "American Express" },
  { key: "applePay", Icon: ApplePayIcon, label: "Apple Pay" },
  { key: "googlePay", Icon: GooglePayIcon, label: "Google Pay" },
] as const;

/**
 * Static accepted-methods row for the checkout order summary. These brands
 * are known without a Stripe session — same set the footer defaults to — so
 * the summary can feel finished while Payment Element still loads.
 */
export function CheckoutPaymentIcons(): React.ReactElement {
  return (
    <ul
      className="mt-6 flex flex-wrap items-center gap-3 text-gray-500"
      aria-label="Accepted payment methods"
    >
      {ICONS.map(({ key, Icon, label }) => (
        <li key={key} className="leading-none" title={label}>
          <Icon className="h-7 w-10" aria-hidden />
          <span className="sr-only">{label}</span>
        </li>
      ))}
    </ul>
  );
}
