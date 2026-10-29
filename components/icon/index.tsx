import type { IconType } from "react-icons";

export type IconComponent = IconType;

// ---------------------------------------------------------------------------
// UI Icons — resolve from branding icon library via BrandingIconsProvider
// ---------------------------------------------------------------------------
export {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  ArrowPathIcon,
  MenuIcon,
  CheckIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsUpDownIcon,
  ClockIcon,
  HeartIcon,
  HomeIcon,
  SearchIcon,
  MinusIcon,
  PlusIcon,
  ShoppingBagIcon,
  UserIcon,
  XCircleIcon,
  XIcon,
} from "@/components/icon/ui-icons";

// ---------------------------------------------------------------------------
// Fallback Icons — react-icons/fa6 (not available / brand-specific)
// ---------------------------------------------------------------------------
export { FaCircle as CircleIcon } from "react-icons/fa6";
export { FaSpinner as SpinnerIcon } from "react-icons/fa6";

// ---------------------------------------------------------------------------
// Social Icons — react-icons/fa6
// ---------------------------------------------------------------------------
export { FaFacebook as FacebookIcon } from "react-icons/fa6";
export { FaInstagram as InstagramIcon } from "react-icons/fa6";
export { FaDiscord as DiscordIcon } from "react-icons/fa6";
export { FaGithub as GithubIcon } from "react-icons/fa6";
export { FaLinkedin as LinkedinIcon } from "react-icons/fa6";
export { FaYoutube as YoutubeIcon } from "react-icons/fa6";

// ---------------------------------------------------------------------------
// Payment Icons — react-icons/fa6
// ---------------------------------------------------------------------------
export { FaCcVisa as VisaIcon } from "react-icons/fa6";
export { FaCcMastercard as MastercardIcon } from "react-icons/fa6";
export { FaCcAmex as AmexIcon } from "react-icons/fa6";
export { FaCcDiscover as DiscoverIcon } from "react-icons/fa6";
export { FaApplePay as ApplePayIcon } from "react-icons/fa6";
export { FaGooglePay as GooglePayIcon } from "react-icons/fa6";
export { FaPaypal as PayPalIcon } from "react-icons/fa6";
export { FaCreditCard as CreditCardIcon } from "react-icons/fa6";

/**
 * Stripe Link wallet mark (ENG-788). react-icons ships no Link icon, so this
 * is a minimal monochrome inline-SVG pill following the same IconType contract
 * as the react-icons exports (size/color/title props, currentColor default).
 */
export const LinkPayIcon: IconType = ({ size, color, title, ...rest }) => (
  <svg
    viewBox="0 0 40 24"
    width={size ?? "1em"}
    height={size ?? "1em"}
    fill={color ?? "currentColor"}
    role="img"
    xmlns="http://www.w3.org/2000/svg"
    {...rest}
  >
    {title ? <title>{title}</title> : null}
    <rect
      x="1"
      y="1"
      width="38"
      height="22"
      rx="6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    />
    <text
      x="20"
      y="16.5"
      textAnchor="middle"
      fontSize="12"
      fontWeight="700"
      fontFamily="inherit"
      fill="currentColor"
      stroke="none"
    >
      link
    </text>
  </svg>
);

/**
 * BNPL brand marks. react-icons ships none of these, so each is a
 * minimal inline-SVG pill in the brand's own colours, following the same
 * IconType contract as LinkPayIcon above.
 */
export const AfterpayIcon: IconType = ({ size, title, ...rest }) => (
  <svg
    viewBox="0 0 64 24"
    width={size ?? "1em"}
    height={size ?? "1em"}
    role="img"
    xmlns="http://www.w3.org/2000/svg"
    {...rest}
  >
    {title ? <title>{title}</title> : null}
    <rect width="64" height="24" rx="6" fill="#B2FCE4" />
    <text
      x="32"
      y="16.5"
      textAnchor="middle"
      fontSize="10"
      fontWeight="700"
      fontFamily="inherit"
      fill="#000000"
      stroke="none"
    >
      Afterpay
    </text>
  </svg>
);

export const KlarnaIcon: IconType = ({ size, title, ...rest }) => (
  <svg
    viewBox="0 0 56 24"
    width={size ?? "1em"}
    height={size ?? "1em"}
    role="img"
    xmlns="http://www.w3.org/2000/svg"
    {...rest}
  >
    {title ? <title>{title}</title> : null}
    <rect width="56" height="24" rx="6" fill="#FFB3C7" />
    <text
      x="28"
      y="16.5"
      textAnchor="middle"
      fontSize="11"
      fontWeight="700"
      fontFamily="inherit"
      fill="#000000"
      stroke="none"
    >
      Klarna
    </text>
  </svg>
);

export const ZipIcon: IconType = ({ size, title, ...rest }) => (
  <svg
    viewBox="0 0 36 24"
    width={size ?? "1em"}
    height={size ?? "1em"}
    role="img"
    xmlns="http://www.w3.org/2000/svg"
    {...rest}
  >
    {title ? <title>{title}</title> : null}
    <rect width="36" height="24" rx="6" fill="#000000" />
    <text
      x="18"
      y="16.5"
      textAnchor="middle"
      fontSize="11"
      fontWeight="700"
      fontFamily="inherit"
      fill="#FFFFFF"
      stroke="none"
    >
      Zip
    </text>
  </svg>
);
