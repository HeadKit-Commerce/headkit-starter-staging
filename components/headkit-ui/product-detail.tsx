"use client";

import {
  useMemo,
  useState,
  useTransition,
  useCallback,
  useEffect,
  useRef,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import type {
  Product,
  ProductFieldsFragment,
  ProductVariation,
} from "@headkit/sdk";
import { ProductImageGallery } from "@/components/headkit-ui/product-image-gallery";
import { ProductBrandLink } from "@/components/headkit-ui/product-brand-link";
import { ProductIdentifiers } from "@/components/headkit-ui/product-identifiers";
import { PdpBuyBoxExtras } from "@/overrides/pdp-buy-box-extras";
import { ProductPrice } from "@/components/headkit-ui/product-price";
import { pickFirstPrice } from "@/lib/price-display";
import { VariantSwatch } from "@/components/headkit-ui/variant-swatch";
import { AvailabilityStatus } from "@/components/headkit-ui/availability-status";
import { Button } from "@/components/ui/button";
import { MinusIcon, PlusIcon, HeartIcon } from "@/components/icon";
import { addToCartAction, addToCartMultiAction } from "@/lib/cart-actions";
import { useCartContext } from "@/components/headkit-ui/cart-context";
import { useIsQuoteMode } from "@/components/checkout/checkout-mode-provider";
import { ProductMultiAdd } from "@/components/headkit-ui/product-multi-add";
import {
  resolveCompanionLineId,
  resolvePinAttributeSlug,
  resolvePinValue,
  type MultiAddCompanion,
} from "@/lib/multi-add";
import {
  ProductAddons,
  addonControlDomId,
  addonGroupDomId,
} from "@/components/headkit-ui/product-addons";
import {
  attributeAddonError,
  buildAddonsConfiguration,
  buildAddonsVerify,
  hasBlockingAddon,
  type AddonSelection,
  type AddonServerError,
} from "@/lib/addons";
import {
  cn,
  decodeHtmlEntities,
  formatPrice,
  formatWooRichText,
  getFloatVal,
  getStoreCurrency,
} from "@/lib/utils";
import { PaymentMethodMessaging } from "@/components/stripe/payment-messaging";
import { isInWishlist, toggleWishlist } from "@/lib/wishlist";
import {
  buildAddToCart,
  buildAddToWishlist,
  buildViewItem,
  productToGa4Item,
  pushGa4Ecommerce,
  type Ga4Item,
} from "@/lib/ga4-ecommerce";
import type { GiftCardFormValues } from "@/components/gift-card-form";
import { DeliveryType } from "@/components/gift-card-delivery-type";
import { ProductEnquiry } from "@/components/headkit-ui/product-enquiry";
import { TitleEmphasis } from "@/components/headkit-ui/title-emphasis";
import { SizeChartTrigger } from "@/components/headkit-ui/size-chart-trigger";
import { isBadgeTag, productBadgesFromTags } from "@/lib/product-badges";
import { stripTitleMarkers } from "@/lib/title-emphasis";
import { shopifyRichTextToHtml } from "@/lib/shopify-rich-text";
import { getStoreTheme } from "@/lib/store-theme";
import { themeSizeGuidePlacement } from "@/lib/size-guide-placement";
import { distinctShortDescription } from "@/lib/product-excerpt";
import { productSubtitle } from "@/lib/product-subtitle";
import { isColorAttrSlug } from "@/components/headkit-ui/collection/utils";
import { buildEnquiryInitialValues } from "@/lib/enquiry-form-values";
import {
  attributesForColourway,
  colourSlugFromProductPath,
} from "@/lib/product-colourway-nav";
import { findSwatchAttribute } from "@/lib/swatch-attribute";
import {
  isBackorderStockStatus,
  isSizeAttrSlug,
  isVariationOutOfStock,
} from "@/lib/variation-stock";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

// Lazy: gift-card-form drags react-hook-form + zod (~63 KB transfer) into the
// PDP bundle, but only gift-card products render it (RC-1 perf fix).
const GiftCardForm = lazy(() =>
  import("@/components/gift-card-form").then((m) => ({
    default: m.GiftCardForm,
  })),
);

interface Props {
  product: ProductFieldsFragment | Product;
  initialSearchParams?: Record<string, string>;
  /**
   * Kept for callers / agent reference — not rendered on the storefront.
   * BreadcrumbList JSON-LD is emitted separately for bots.
   */
  breadcrumbItems?: { name: string; uri: string; current: boolean }[];
  /** Color slug from URL path segment — enables path-based routing mode */
  initialColor?: string;
  /**
   * The product's canonical base path from `productPath` (`lib/canonical-path.ts`),
   * e.g. "/shop/tops/shirt" — triggers path-based routing. Pass the canonical, never
   * the requested URL: colourway links are built beneath it, so a flat
   * "/products/shirt" here would render links onto the shape that 308s away.
   */
  productBasePath?: string;
  /** Slot for dynamic stock rendering (e.g. PPR Suspense boundary). Replaces inline AvailabilityStatus. */
  stockSlot?: ReactNode;
  /** Per-store Stripe config for the BNPL badge. Omit to render no badge. */
  stripeConfig?: {
    publishableKey: string;
    accountId: string;
    bnplMessagingEnabled: boolean;
  };
  /**
   * When true and the product has multiAdd companions, show steppers + batch
   * add. Default off (branding.multiAddEnabled).
   */
  multiAddEnabled?: boolean;
  /**
   * Branding PDP gallery layout (`grid` | `thumbnails` | `carousel` | `stack`).
   * Unknown / omitted values render today's masonry grid.
   */
  pdpGalleryLayout?: string;
  /**
   * Display brand resolved by the page (`lib/product-brand.ts`): logo (or name)
   * rendered above the title, linking to `/brand/{slug}`. Omit / null renders
   * nothing, so a product without brand terms is laid out exactly as before.
   */
  brand?:
    | { name: string; slug: string; logoUrl?: string | null | undefined }
    | null
    | undefined;
  /**
   * Shopify storefronts have no Gravity Forms. When true, the PDP enquiry
   * uses the built-in Online Store contact form.
   */
  shopifyContact?: boolean;
}

const VARIABLE = "VARIABLE";

/**
 * Gravity Forms form id for the PDP product-enquiry form.
 *
 * Assign the right form in WordPress:
 * 1. Create (or keep) a GF form titled "Product Enquiry".
 * 2. Add visible fields (Name, Email, Message) plus HIDDEN fields labelled
 *    exactly: Product Name, Product URL, Product Size, Product Colour
 *    (snakeCase of those labels → product_name / product_url / …).
 * 3. Set this constant to that form's numeric id (local seed creates id 3 —
 *    see docker/wordpress/seed-gravity-forms.php).
 *
 * ProductEnquiry renders nothing when the form can't load, so a wrong id is a
 * silent no-op rather than a broken Enquire button.
 */
const ENQUIRY_FORM_ID = "3";

/** UI-SPEC's copy for a rejection that belongs to no single add-on group. */
const ADDON_FORM_ERROR_COPY =
  "We couldn't add this to your cart. Please review your options above and try again.";

/**
 * The one add-on rejection whose own sentence is the right thing to show a
 * shopper when it cannot be pinned to a group: the R1 drift guard's, which is
 * deliberately one string with two renderers (the theme's `esc_html__()` and
 * this banner). Everything else unattributable — `CART_REJECTED`, the two
 * `ADDONS_*_INVALID` shape sentinels — is either unreviewed or a storefront bug,
 * and must not reach a shopper as guidance.
 */
const ADDON_DRIFT_CODE = "headkit_addon_option_drift";

/** Anchors the disabled CTA to the reason it is disabled. */
const ADDON_UPLOAD_NOTICE_ID = "addon-upload-notice";

/**
 * Bring the rejected group into view and put the caret in it.
 *
 * On a phone this is the difference between a working form and a broken one: a
 * shopper taps the sticky add-to-cart bar, the rejection lands six screens up,
 * and without this nothing appears to have happened at all.
 */
function revealAddonGroup(addonId: string): void {
  if (typeof document === "undefined") return;
  document
    .getElementById(addonGroupDomId(addonId))
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
  document
    .getElementById(addonControlDomId(addonId))
    ?.focus({ preventScroll: true });
}

/** Original upload when the catalogue image carries one. The published SDK does not select it yet. */
function readImageFullSrc(img: object): string | undefined {
  if (!("fullSrc" in img)) return undefined;
  const value = (img as { fullSrc?: unknown }).fullSrc;
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function ProductDetail({
  product,
  initialSearchParams,
  initialColor,
  productBasePath,
  stockSlot,
  stripeConfig,
  multiAddEnabled = false,
  pdpGalleryLayout = "grid",
  brand,
  shopifyContact = false,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const [addingToCart, startTransition] = useTransition();
  const [cartFeedback, setCartFeedback] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [quantity, setQuantity] = useState(1);
  const [wishlisted, setWishlisted] = useState(false);
  const [showStickyAtc, setShowStickyAtc] = useState(false);
  const atcSectionRef = useRef<HTMLDivElement>(null);
  const { cartData, setCartData, toggleCart } = useCartContext();
  const isQuoteMode = useIsQuoteMode();

  useEffect(() => {
    setWishlisted(isInWishlist(product.id));
  }, [product.id]);

  // Prefer commerce `type`, but also treat products with variation attributes
  // as variable — e.g. Shopify colourways where sibling variants are unpublished
  // from Online Store leave a single Storefront variant (historically typed
  // simple) that must still show the colour swatch.
  const variationAttributes = useMemo(
    () => product.attributes.filter((a) => a.variation),
    [product.attributes],
  );
  const isVariable =
    product.type?.toUpperCase() === VARIABLE || variationAttributes.length > 0;
  const isGiftCard = product.isGiftCard === true;
  const [giftCardValues, setGiftCardValues] =
    useState<GiftCardFormValues | null>(null);
  const [isGiftCardFormValid, setIsGiftCardFormValid] = useState(false);

  // Add-on state is plain useState and the object is already the wire shape —
  // there is no model to translate, which is the whole reason that shape was
  // kept. No form library, and no client-side validity flag: unlike the gift
  // card above, the store is the only validator (D-14.1-02).
  const [addonSelection, setAddonSelection] = useState<AddonSelection>({});
  const [addonErrors, setAddonErrors] = useState<Record<string, string>>({});
  const [addonFormError, setAddonFormError] = useState<string | null>(null);
  // The schema types this `[ProductAddon!]!` with default `[]`, and that IS the
  // contract — but only for a response that CARRIES the field. A store still on an
  // older theme omits the key entirely and the SDK yields `undefined`, which is
  // every store until its theme ships. Treating the schema guarantee as a runtime
  // one threw inside `hasBlockingAddon` during prerender and failed the whole
  // build, rather than degrading to "no add-ons" as D-14.1-04 requires. Normalised
  // once here so every consumer below reads the same list.
  const addons = product.addons ?? [];
  const hasUploadAddon = hasBlockingAddon(addons);

  const multiAddBlock = (
    product as (ProductFieldsFragment | Product) & {
      multiAdd?: {
        pinOption?: string | null;
        products: MultiAddCompanion[];
      } | null;
    }
  ).multiAdd;
  const multiAddCompanions = multiAddBlock?.products ?? [];
  const showMultiAdd =
    multiAddEnabled &&
    !isGiftCard &&
    addons.length === 0 &&
    multiAddCompanions.length > 0;
  const [companionQty, setCompanionQty] = useState<Record<string, number>>({});

  const handleAddonChange = useCallback(
    (next: AddonSelection, changedAddonId: string) => {
      setAddonSelection(next);
      // The rejection clears the moment that group's value changes, not on the
      // next submit. The client cannot know the new value is valid — but a
      // stale rejection sitting beside a changed field is actively misleading.
      setAddonErrors((prev) => {
        if (!(changedAddonId in prev)) return prev;
        const rest = { ...prev };
        delete rest[changedAddonId];
        return rest;
      });
      setAddonFormError(null);
    },
    [],
  );

  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >(() => {
    if (!isVariable) return {};

    // Path-based mode: color comes from URL segment, size defaults from first matching variation.
    // localStorage is read in a useEffect to avoid SSR/hydration mismatch.
    if (productBasePath) {
      const colorKey = findSwatchAttribute(variationAttributes)?.slug;
      const attrs: Record<string, string> = {};
      if (colorKey && initialColor) attrs[colorKey] = initialColor;

      const firstMatch = product.variations.find(
        (v) =>
          !initialColor ||
          v.attributes.some(
            (a) =>
              (!colorKey || a.key === colorKey) && a.value === initialColor,
          ),
      );
      if (firstMatch) {
        for (const a of firstMatch.attributes) {
          if (!attrs[a.key]) attrs[a.key] = a.value;
        }
      }
      return attrs;
    }

    // Search-params mode (existing behavior)
    const fromParams: Record<string, string> = {};
    if (initialSearchParams) {
      for (const attr of variationAttributes) {
        const val = initialSearchParams[attr.slug];
        if (val) fromParams[attr.slug] = val;
      }
    }
    if (Object.keys(fromParams).length > 0) return fromParams;

    const firstVariation = product.variations[0];
    if (!firstVariation) return {};
    const defaults: Record<string, string> = {};
    for (const va of firstVariation.attributes) {
      defaults[va.key] = va.value;
    }
    return defaults;
  });

  // In path-based mode, restore the saved size from localStorage after mount
  // (deferred to avoid SSR/hydration mismatch).
  useEffect(() => {
    if (!productBasePath || !isVariable) return;
    const sizeKey = variationAttributes.find((a) =>
      isSizeAttrSlug(a.slug),
    )?.slug;
    if (!sizeKey) return;
    const saved = localStorage.getItem(`headkit:size:${product.slug}`);
    if (!saved) return;
    setSelectedAttributes((prev) => {
      if (prev[sizeKey] === saved) return prev;
      return { ...prev, [sizeKey]: saved };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally run once on mount only

  // Warm sibling colourway URLs so Instant Navigation / hard refresh stay fast.
  // Swatch clicks themselves use History API (below) — no RSC round-trip.
  useEffect(() => {
    if (!productBasePath || !isVariable) return;
    const colorKey = findSwatchAttribute(variationAttributes)?.slug;
    if (!colorKey) return;
    const colorAttr = variationAttributes.find((a) => a.slug === colorKey);
    for (const option of colorAttr?.fullOptions ?? []) {
      if (option.slug) {
        router.prefetch(`${productBasePath}/${option.slug}`);
      }
    }
  }, [productBasePath, isVariable, variationAttributes, router]);

  // Back/forward: History API updates usePathname without remounting — sync
  // selected colourway (and cascade size if needed) from the path.
  useEffect(() => {
    if (!productBasePath || !isVariable) return;
    const colorKey = findSwatchAttribute(variationAttributes)?.slug;
    if (!colorKey) return;

    const colourFromPath = colourSlugFromProductPath(pathname, productBasePath);
    if (!colourFromPath) return;

    setSelectedAttributes((prev) => {
      if (prev[colorKey] === colourFromPath) return prev;
      return attributesForColourway(
        product.variations,
        colorKey,
        colourFromPath,
        prev,
      );
    });
  }, [
    pathname,
    productBasePath,
    isVariable,
    variationAttributes,
    product.variations,
  ]);

  const syncUrlWithAttributes = useCallback(
    (attrs: Record<string, string>) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(attrs)) {
        if (value) params.set(key, value);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname],
  );

  const updateAttributes = useCallback(
    (next: Record<string, string>) => {
      if (productBasePath) {
        const colorKey = findSwatchAttribute(variationAttributes)?.slug;
        const sizeKey = variationAttributes.find((a) =>
          isSizeAttrSlug(a.slug),
        )?.slug;

        // Persist size to localStorage on every change
        if (sizeKey && next[sizeKey]) {
          localStorage.setItem(`headkit:size:${product.slug}`, next[sizeKey]);
        }

        // Colourway path URLs are SEO/shareable, but the product payload already
        // includes every colourway. Update UI + URL via History API so we skip
        // App Router soft-nav (Suspense/`loading` shell flash on first switch).
        // @see https://nextjs.org/docs/app/building-your-application/routing/linking-and-navigating#using-the-native-history-api
        if (colorKey && next[colorKey] !== selectedAttributes[colorKey]) {
          setSelectedAttributes(next);
          const colourUrl = `${productBasePath}/${next[colorKey]}`;
          window.history.pushState(null, "", colourUrl);
          return;
        }

        setSelectedAttributes(next);
        return;
      }

      setSelectedAttributes(next);
      syncUrlWithAttributes(next);
    },
    [
      productBasePath,
      product.slug,
      variationAttributes,
      selectedAttributes,
      syncUrlWithAttributes,
    ],
  );

  const selectedVariation = useMemo<ProductVariation | null>(() => {
    if (!isVariable) return null;
    return (
      product.variations.find((v: ProductVariation) =>
        v.attributes.every((a) => selectedAttributes[a.key] === a.value),
      ) ?? null
    );
  }, [isVariable, product.variations, selectedAttributes]);

  // Hidden product context injected into the enquiry form so the WordPress entry
  // captures which product/variant the shopper asked about. Field names must
  // match snakeCased GF labels — see buildEnquiryInitialValues (ENG-794).
  const enquiryInitialValues = useMemo(
    () =>
      buildEnquiryInitialValues({
        productName: stripTitleMarkers(decodeHtmlEntities(product.name)),
        productUrl:
          typeof window !== "undefined"
            ? `${window.location.origin}${pathname}`
            : undefined,
        variationAttributes,
        selectedAttributes,
        isColourAttrSlug: isColorAttrSlug,
      }),
    [product.name, pathname, variationAttributes, selectedAttributes],
  );

  const galleryImages = useMemo(() => {
    // Variation-owned gallery replaces the parent product gallery entirely
    // (hide parent featured + gallery while that colourway is selected).
    const productAlt = stripTitleMarkers(decodeHtmlEntities(product.name));
    const variationGallery = (selectedVariation?.images ?? [])
      .filter((img) => Boolean(img?.src))
      .map((img) => {
        const fullSrc = readImageFullSrc(img);
        return {
          src: img.src,
          alt: stripTitleMarkers(decodeHtmlEntities(img.alt || product.name)),
          ...(fullSrc ? { fullSrc } : {}),
        };
      });
    if (variationGallery.length > 0) {
      return variationGallery;
    }

    const base = product.images.map((img) => {
      const fullSrc = readImageFullSrc(img);
      return {
        src: img.src,
        alt: stripTitleMarkers(decodeHtmlEntities(img.alt || product.name)),
        ...(fullSrc ? { fullSrc } : {}),
      };
    });
    return base.length > 0
      ? base
      : [{ src: "/placeholder.png", alt: productAlt }];
  }, [product.images, product.name, selectedVariation]);

  // pickFirstPrice, not `??`: the gateway sends absent sale prices as ""
  // (empty string), which `??` keeps — rendering A$0.00 on simple non-sale
  // products (E2E P1-14).
  const displayPrice = pickFirstPrice(
    selectedVariation?.price,
    product.salePrice,
    product.price,
  );
  const displayRegularPrice = pickFirstPrice(
    selectedVariation?.regularPrice,
    product.regularPrice,
  );
  const isOnSale =
    selectedVariation !== null ? selectedVariation.onSale : product.onSale;

  const stockStatus =
    selectedVariation?.stockStatus ?? product.stockStatus ?? "instock";
  const stockQuantity =
    selectedVariation?.stockQuantity ?? product.stockQuantity ?? null;
  const isOutOfStock = isVariationOutOfStock({
    stockStatus,
    stockQuantity,
  });

  const targetId = isVariable
    ? (selectedVariation?.id ?? product.id)
    : product.id;
  const cartItemQty =
    cartData?.items.find((i) => i.id === String(targetId))?.quantity ?? 0;
  // Backorder / Shopify CONTINUE: quantity may be 0 while still sellable —
  // do not treat that as a max of 0 (would block Add to cart).
  const maxStock = isBackorderStockStatus(stockStatus)
    ? null
    : ((selectedVariation ?? product).stockQuantity ?? null);
  const isAtStockLimit = maxStock !== null && cartItemQty + quantity > maxStock;

  // For a gift card the button must stay disabled until BOTH the form is valid
  // (isGiftCardFormValid, set on blur) AND the captured values have landed
  // (giftCardValues, set asynchronously by the form's watch/trigger). Gating on
  // validity alone let a fast click fire an add BEFORE giftConfig was captured,
  // sending a bare gift-card line the WooCommerce plugin rejects with
  // "some required data is missing" (GIFT-02 flake / race).
  //
  // Add-ons contribute EXACTLY ONE new conjunct: whether the product carries a
  // file-upload group. Deliberately no validity term and no async-capture term.
  // The gift-card path above needs both because its form is validated
  // client-side and its values land asynchronously; the add-on path is neither,
  // and copying that gate would reintroduce the client-side required check this
  // phase exists to not port. An incomplete add-on form is submittable.
  const canAddToCart =
    (isVariable
      ? selectedVariation !== null && !isOutOfStock && !isAtStockLimit
      : !isOutOfStock && !isAtStockLimit) &&
    (!isGiftCard || (isGiftCardFormValid && giftCardValues !== null)) &&
    !hasUploadAddon;

  const multiAddPinSlug = useMemo(
    () =>
      resolvePinAttributeSlug(
        product.attributes.map((a) => ({
          name: a.name,
          slug: a.slug,
          variation: a.variation,
        })),
        multiAddBlock?.pinOption,
      ),
    [product.attributes, multiAddBlock?.pinOption],
  );
  const multiAddPinValue = resolvePinValue(
    multiAddPinSlug,
    selectedAttributes,
    product.defaultAttributes ?? [],
  );

  const companionLines = useMemo(() => {
    if (!showMultiAdd) return [];
    const lines: Array<{
      id: string;
      name: string;
      quantity: number;
      unitPrice: number;
    }> = [];
    for (const companion of multiAddCompanions) {
      const qty = companionQty[companion.id] ?? 0;
      if (qty <= 0) continue;
      const resolved = resolveCompanionLineId(
        companion,
        multiAddPinSlug,
        multiAddPinValue,
      );
      if (!resolved) continue;
      lines.push({
        id: resolved.id,
        // Carried for the GA4 `add_to_cart` payload only — the cart action
        // itself takes id + quantity. Without it a multi-add would report the
        // hero product and leave its companions out of the event entirely.
        name: companion.name,
        quantity: qty,
        unitPrice: resolved.unitPrice,
      });
    }
    return lines;
  }, [
    showMultiAdd,
    multiAddCompanions,
    companionQty,
    multiAddPinSlug,
    multiAddPinValue,
  ]);

  const hasCompanionLines = companionLines.length > 0;
  const companionTotal = companionLines.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0,
  );
  const heroUnitPrice = getFloatVal(displayPrice);
  const setTotal = heroUnitPrice * quantity + companionTotal;
  const setPieceCount =
    quantity + companionLines.reduce((sum, line) => sum + line.quantity, 0);
  const multiAddHeroImage = (() => {
    const productAlt = stripTitleMarkers(decodeHtmlEntities(product.name));
    const fromVariation = selectedVariation?.image;
    if (fromVariation?.src) {
      return {
        src: fromVariation.src,
        alt: stripTitleMarkers(
          decodeHtmlEntities(fromVariation.alt || product.name),
        ),
      };
    }
    const fromProduct = product.image;
    if (fromProduct?.src) {
      return {
        src: fromProduct.src,
        alt: stripTitleMarkers(
          decodeHtmlEntities(fromProduct.alt || product.name),
        ),
      };
    }
    const first = product.images[0];
    if (first?.src) {
      return {
        src: first.src,
        alt: stripTitleMarkers(decodeHtmlEntities(first.alt || product.name)),
      };
    }
    return productAlt ? { src: "/placeholder.png", alt: productAlt } : null;
  })();

  // Sticky ATC bar: only after the primary ATC scrolls above the viewport
  // (not when it is still below the fold).
  useEffect(() => {
    const el = atcSectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const scrolledPast =
          !entry.isIntersecting && entry.boundingClientRect.top < 0;
        setShowStickyAtc(scrolledPast);
      },
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const addToCartLabel =
    cartFeedback === "success"
      ? isQuoteMode
        ? "Added to quote!"
        : "Added to cart!"
      : cartFeedback === "error"
        ? "Error — try again"
        : isOutOfStock
          ? "Out of stock"
          : isAtStockLimit
            ? "Max qty reached"
            : isVariable && !selectedVariation
              ? "Select options"
              : hasCompanionLines
                ? isQuoteMode
                  ? `Add set to quote · ${formatPrice(setTotal)}`
                  : `Add set to cart · ${formatPrice(setTotal)}`
                : isQuoteMode
                  ? "Add to Quote"
                  : "Add to cart";

  /**
   * Land a rejection against the group it belongs to, or in the banner when it
   * belongs to none. The existing label ladder and the existing network-error
   * path are untouched — this channel sits beside them rather than replacing
   * them.
   */
  function routeAddonRejection(addonError: AddonServerError | undefined): void {
    if (!addonError) {
      setAddonErrors({});
      setAddonFormError(null);
      return;
    }

    const { addonId, message } = attributeAddonError(addons, addonError);

    if (addonId) {
      setAddonErrors({ [addonId]: message });
      setAddonFormError(null);
      revealAddonGroup(addonId);
      return;
    }

    setAddonErrors({});
    setAddonFormError(
      addonError.code === ADDON_DRIFT_CODE ? message : ADDON_FORM_ERROR_COPY,
    );
  }

  function handleAddToCart() {
    setCartFeedback("idle");
    startTransition(async () => {
      try {
        const id = isVariable
          ? (selectedVariation?.id ?? product.id)
          : product.id;

        const hasVariation =
          isVariable && Object.keys(selectedAttributes).length > 0;
        const variation = Object.entries(selectedAttributes).map(
          ([attribute, value]) => ({ attribute, value }),
        );

        if (hasCompanionLines) {
          const result = await addToCartMultiAction({
            lines: [
              {
                id,
                quantity,
                ...(hasVariation ? { variation } : {}),
              },
              ...companionLines.map((line) => ({
                id: line.id,
                quantity: line.quantity,
              })),
            ],
          });
          if (result.success) {
            setAddonErrors({});
            setAddonFormError(null);
            // Emitted from the success branch only: an add that the store
            // rejected must not report a conversion step.
            pushGa4Ecommerce(
              buildAddToCart(ga4Currency, [
                { ...ga4Item, quantity },
                ...companionLines.map((line) =>
                  productToGa4Item(
                    { id: line.id, name: line.name },
                    { price: line.unitPrice, quantity: line.quantity },
                  ),
                ),
              ]),
            );
            setCartData(result.cart);
            toggleCart(true);
            setQuantity(1);
            setCompanionQty({});
          }
          setCartFeedback(result.success ? "success" : "error");
          setTimeout(() => setCartFeedback("idle"), 2000);
          return;
        }

        const giftConfig =
          isGiftCard && giftCardValues
            ? {
                sendAsGift: true,
                toMultiple: [giftCardValues.wc_gc_giftcard_to_multiple],
                from: giftCardValues.wc_gc_giftcard_from,
                message: giftCardValues.wc_gc_giftcard_message ?? "",
                // "Now" (immediate) must OMIT the delivery date entirely — the
                // WooCommerce Gift Cards plugin validates a supplied delivery_date as a
                // future timestamp and rejects "today"/past (and empty) with "Invalid
                // delivery date." Sending an empty string makes commerce drop the field
                // (its `if DeliveryDate != ""` guard), so the plugin sends immediately.
                // Only "Later" forwards the user-picked (future) date.
                deliveryDate:
                  giftCardValues.wc_gc_giftcard_select_delivery ===
                  DeliveryType.Later
                    ? giftCardValues.wc_gc_giftcard_delivery
                    : "",
              }
            : undefined;

        // Indexes and text only. There is no field in this payload a price
        // could travel in, so the estimated total the shopper is looking at
        // cannot reach the store even by accident.
        const addonsConfiguration = buildAddonsConfiguration(
          addons,
          addonSelection,
        );
        const addonsVerify = buildAddonsVerify(addons, addonSelection);
        const addonConfig =
          Object.keys(addonsConfiguration).length > 0
            ? { addonsConfiguration, addonsVerify }
            : {};

        const result = await addToCartAction(
          hasVariation
            ? {
                id,
                quantity,
                variation,
                ...(giftConfig ? { giftConfig } : {}),
                ...addonConfig,
              }
            : {
                id,
                quantity,
                ...(giftConfig ? { giftConfig } : {}),
                ...addonConfig,
              },
        );
        if (result.success) {
          setAddonErrors({});
          setAddonFormError(null);
          pushGa4Ecommerce(
            buildAddToCart(ga4Currency, [{ ...ga4Item, quantity }]),
          );
          setCartData(result.cart);
          toggleCart(true);
          setQuantity(1);
        } else {
          routeAddonRejection(result.addonError);
        }
        setCartFeedback(result.success ? "success" : "error");
      } catch {
        // Never let an unhandled rejection from the server action trip the
        // route error boundary — show inline feedback instead.
        setCartFeedback("error");
      }
      setTimeout(() => setCartFeedback("idle"), 2000);
    });
  }

  const reviewsEnabled = Boolean(product.reviewsEnabled);
  const specifications = product.specifications?.trim()
    ? product.specifications
    : null;

  // GTIN/MPN: the selected variation's own identifiers when it has one, else
  // the product-level identifiers (simple products, or before a variation is
  // selected). Never mixed — a variation with neither falls through to the
  // product's, not to a half-variation/half-product pair.
  const identifierSource = selectedVariation ?? product;
  const gtin = identifierSource.gtin?.trim() || null;
  const mpn = identifierSource.mpn?.trim() || null;

  const tabs: Array<{
    key: string;
    label: string;
    hasContent: boolean;
  }> = [
    {
      key: "description",
      label: "Description",
      hasContent: !!product.description,
    },
    {
      key: "specifications",
      label: "Specifications",
      hasContent: !!specifications?.trim(),
    },
    {
      key: "additional",
      label: "Additional Info",
      hasContent:
        product.attributes.filter((a) => a.visible && !a.variation).length > 0,
    },
    {
      key: "reviews",
      label: "Reviews",
      hasContent: reviewsEnabled,
    },
  ];

  const visibleTabs = tabs.filter((t) => t.hasContent);

  // ---------------------------------------------------------------------
  // GA4 ecommerce (`lib/ga4-ecommerce.ts` owns the payload contract)
  // ---------------------------------------------------------------------

  // The shopper-readable variant label, e.g. "Carbon Black / 54". Built from
  // the attribute OPTION NAMES rather than the URL slugs the state holds, so
  // the value in the data layer reads the same as the one on screen.
  const ga4Variant = useMemo(() => {
    const parts = variationAttributes
      .map((attr) => {
        const slug = selectedAttributes[attr.slug];
        if (!slug) return null;
        const option = attr.fullOptions.find((o) => o.slug === slug);
        return decodeHtmlEntities(option?.name ?? slug);
      })
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(" / ") : null;
  }, [variationAttributes, selectedAttributes]);

  // `item_id` follows the SELECTED variation's SKU when there is one: that is
  // the identifier a Merchant Center feed keys a colourway on, so a Shopping
  // conversion lands on the variant the shopper actually bought.
  const ga4Item = useMemo<Ga4Item>(
    () =>
      productToGa4Item(product, {
        price: getFloatVal(displayPrice),
        quantity: 1,
        variant: ga4Variant,
        ...(selectedVariation?.sku?.trim()
          ? { itemId: selectedVariation.sku.trim() }
          : {}),
      }),
    [product, displayPrice, ga4Variant, selectedVariation],
  );

  const ga4Currency = getStoreCurrency();

  // `view_item` fires on render AND on every variant switch. Colourway changes
  // are shallow URL updates, not navigations, so nothing else would re-fire
  // it — and the classic site's data layer shows `view_item` more than once per
  // page, which is what the container's 8 `view_item` references expect.
  const ga4ViewItemKey = `${ga4Item.item_id}|${ga4Item.price}`;
  useEffect(() => {
    pushGa4Ecommerce(buildViewItem(ga4Currency, ga4Item));
    // Keyed on the identity + price that changed, not on the object: the memo
    // yields a new reference on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ga4ViewItemKey]);

  const handleWishlistToggle = () => {
    const { added } = toggleWishlist({ id: product.id, slug: product.slug });
    setWishlisted(added);
    // Removal is not an `add_to_wishlist`; GA4 has no counterpart event and the
    // container has no tag for one.
    if (added) {
      pushGa4Ecommerce(buildAddToWishlist(ga4Currency, ga4Item));
    }
  };

  const colorKey = findSwatchAttribute(variationAttributes)?.slug;
  const selectedColor = colorKey ? selectedAttributes[colorKey] : undefined;
  // The server `stockSlot` (`components/headkit-ui/product-stock.tsx`) resolves
  // stock from the COLOURWAY IN THE URL alone: it takes the first variation in
  // payload order carrying that colour, of whatever size that happens to be,
  // and it cannot see the size the shopper selected. The Add to Bag button and
  // every other stock-bearing element on this page read `selectedVariation` —
  // the FULL attribute match. Two different objects, so for any product with a
  // second variation axis the page could render both answers ~40px apart: a
  // green "In Stock" line above an "Out Of Stock" button, on one size click.
  // Measured at 36.3% of colourway PDPs on one store
  // (`260925-bs-variable-stock-out-of-stock`).
  //
  // So the server slot is used for SIMPLE products only. They structurally
  // cannot disagree: `variations` is empty, so both resolvers read
  // `product.stockStatus` off the same object. A variable product renders
  // `<AvailabilityStatus>` from `stockStatus` / `stockQuantity` below, which are
  // the selected variation's — ONE source of truth, shared with the button.
  //
  // This costs the static shell nothing, and that is a property of the seed
  // rather than luck: `selectedAttributes` is seeded on the server from the
  // first variation matching `initialColor` (see its initialiser above) — the
  // same variation `ProductStock` picks — so the prerendered line is unchanged.
  // Do not "restore" the slot for variable products by widening this condition;
  // add the size axis to the slot instead, or delete the slot.
  const useServerStock =
    Boolean(stockSlot) &&
    !isVariable &&
    (!productBasePath ||
      selectedColor === initialColor ||
      (!selectedColor && !initialColor));

  const storeTheme = getStoreTheme();
  const badgeAllowlist = storeTheme.catalog?.badgeTags;
  const sizeGuideHref = storeTheme.pdp?.sizeGuideHref;
  const sizeChartHtml = shopifyRichTextToHtml(product.sizeChart ?? "");
  // Metafield modal next to Size / standalone — only when Shopify sizeChart
  // HTML exists AND the theme has not set a shopper Size Guide page. Theme
  // Size Guide is a single control per PDP (see themeSizeGuidePlacement).
  const showSizeChartModal = Boolean(sizeChartHtml) && !sizeGuideHref;
  const customBadges = productBadgesFromTags(product.tags, badgeAllowlist, {
    hideNew: Boolean(product.isNew),
    hideSale: isOnSale,
  });
  const visibleTags = (product.tags ?? []).filter(
    (tag) => !isBadgeTag(tag, badgeAllowlist),
  );
  const hasSizeAttribute = variationAttributes.some((attr) =>
    isSizeAttrSlug(attr.slug),
  );
  const swatchAttribute = findSwatchAttribute(variationAttributes);
  const swatchCommerceSrc =
    product.image?.src || product.images[0]?.src || "";
  const sizeGuidePlacement = themeSizeGuidePlacement({
    sizeGuideHref,
    showMultiAdd,
    hasSwatchAttribute: Boolean(swatchAttribute),
    hasSizeAttribute,
  });
  const buyBoxExcerpt = distinctShortDescription(
    product.shortDescription,
    product.description,
  );
  const buyBoxSubtitle = productSubtitle(
    "subtitle" in product ? product.subtitle : null,
  );

  return (
    <div className="headkit-product-detail">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Left: image gallery */}
        <ProductImageGallery
          images={galleryImages}
          isSale={isOnSale}
          isNew={product.isNew}
          badges={customBadges}
          layout={pdpGalleryLayout}
          videoUrl={product.productVideoUrl}
        />

        {/* Right: product info */}
        <div className="flex flex-col">
          <ProductBrandLink brand={brand} />
          <div className="mb-3">
            <h1 className="text-primary">
              <TitleEmphasis text={product.name} highlight />
            </h1>
            {buyBoxSubtitle ? (
              <p className="headkit-product-subtitle mt-[6px] text-primary">
                {buyBoxSubtitle}
              </p>
            ) : null}
          </div>

          {buyBoxExcerpt ? (
            <div
              className="mb-5 text-base leading-normal text-primary [&_p]:mb-3 [&_p:last-child]:mb-0"
              dangerouslySetInnerHTML={{
                __html: formatWooRichText(buyBoxExcerpt),
              }}
            />
          ) : null}

          {!hasSizeAttribute && showSizeChartModal ? (
            <div className="mb-5">
              <SizeChartTrigger html={sizeChartHtml} />
            </div>
          ) : null}

          {sizeGuidePlacement === "standalone" && sizeGuideHref ? (
            <div className="mb-5">
              <SizeChartTrigger pageHref={sizeGuideHref} />
            </div>
          ) : null}

          {/* Variation attribute selectors */}
          {isVariable && variationAttributes.length > 0 && (
            <div className="mb-5 flex flex-col gap-4">
              {variationAttributes.map((attr) => (
                <div key={attr.id} className="flex flex-col">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <p className="font-semibold text-primary">
                        {decodeHtmlEntities(attr.name)}
                      </p>
                      {selectedAttributes[attr.slug] && (
                        <span className="capitalize text-gray-700">
                          {decodeHtmlEntities(
                            attr.fullOptions.find(
                              (o) => o.slug === selectedAttributes[attr.slug],
                            )?.name ?? "",
                          )}
                        </span>
                      )}
                    </div>
                    {isSizeAttrSlug(attr.slug) && showSizeChartModal ? (
                      <SizeChartTrigger html={sizeChartHtml} />
                    ) : null}
                    {sizeGuideHref &&
                    ((sizeGuidePlacement === "swatch" &&
                      attr.slug === swatchAttribute?.slug) ||
                      (sizeGuidePlacement === "size" &&
                        isSizeAttrSlug(attr.slug))) ? (
                      <SizeChartTrigger pageHref={sizeGuideHref} />
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {attr.fullOptions.map((option) => {
                      const hasAnyVariation = product.variations.some(
                        (v: ProductVariation) =>
                          v.attributes.some(
                            (a) =>
                              a.key === attr.slug && a.value === option.slug,
                          ),
                      );

                      const matchingWithOthers = product.variations.filter(
                        (v: ProductVariation) => {
                          const matchesThis = v.attributes.some(
                            (a) =>
                              a.key === attr.slug && a.value === option.slug,
                          );
                          if (!matchesThis) return false;
                          return variationAttributes
                            .filter((other) => other.slug !== attr.slug)
                            .every((other) => {
                              const sel = selectedAttributes[other.slug];
                              return (
                                !sel ||
                                v.attributes.some(
                                  (a) =>
                                    a.key === other.slug && a.value === sel,
                                )
                              );
                            });
                        },
                      );

                      const isIncompatible =
                        hasAnyVariation && matchingWithOthers.length === 0;
                      const isUnavailable =
                        !hasAnyVariation ||
                        (matchingWithOthers.length > 0 &&
                          matchingWithOthers.every(isVariationOutOfStock));

                      const streamAttributeId = findSwatchAttribute([attr])
                        ? String(attr.id)
                        : "";
                      return (
                        <VariantSwatch
                          key={option.slug}
                          label={decodeHtmlEntities(option.name)}
                          value={option.slug}
                          color1={option.swatchColor}
                          color2={option.swatchColor2}
                          imageSrc={option.swatchImage ?? ""}
                          {...(streamAttributeId
                            ? { attributeId: streamAttributeId }
                            : {})}
                          {...(swatchCommerceSrc
                            ? { commerceSrc: swatchCommerceSrc }
                            : {})}
                          selectedOptionValue={
                            selectedAttributes[attr.slug] ?? ""
                          }
                          onClick={() => {
                            const next = {
                              ...selectedAttributes,
                              [attr.slug]: option.slug,
                            };
                            const isValid = product.variations.some(
                              (v: ProductVariation) =>
                                v.attributes.every(
                                  (a) => next[a.key] === a.value,
                                ),
                            );
                            if (!isValid) {
                              const fallback = product.variations.find(
                                (v: ProductVariation) =>
                                  v.attributes.some(
                                    (a) =>
                                      a.key === attr.slug &&
                                      a.value === option.slug,
                                  ),
                              );
                              if (fallback) {
                                const cascaded: Record<string, string> = {};
                                for (const a of fallback.attributes) {
                                  cascaded[a.key] = a.value;
                                }
                                updateAttributes(cascaded);
                                return;
                              }
                            }
                            updateAttributes(next);
                          }}
                          isUnavailable={isUnavailable}
                          isIncompatible={isIncompatible}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add-on groups. Guarded at the CALL SITE on list length, not just
              by the component returning null, so a product without add-ons
              contributes no element and no margin to the DOM (PAO-04). No
              Suspense boundary and no loading.tsx: the definitions arrive as
              props from the already-cached server page, and a boundary here
              risks re-introducing the recorded empty-static-shell defect. */}
          {addons.length > 0 && (
            <ProductAddons
              addons={addons}
              selection={addonSelection}
              onChange={handleAddonChange}
              errors={addonErrors}
              quantity={quantity}
              basePrice={getFloatVal(displayPrice)}
            />
          )}

          {/* Gift card recipient form */}
          {isGiftCard && (
            <Suspense fallback={null}>
              <GiftCardForm
                emitClickEvent={(values) => setGiftCardValues(values)}
                onFormValid={(valid) => setIsGiftCardFormValid(valid)}
              />
            </Suspense>
          )}

          {/* Availability status — hidden for HeadKit Quote checkout */}
          {!isQuoteMode && (
            <div className="mb-4">
              {useServerStock ? (
                stockSlot
              ) : (
                <AvailabilityStatus
                  stockStatus={stockStatus}
                  stockQuantity={
                    (selectedVariation ?? product).stockQuantity ?? null
                  }
                />
              )}
            </div>
          )}

          {/* Price */}
          <div className="mb-6">
            <ProductPrice
              price={displayPrice}
              regularPrice={displayRegularPrice}
              onSale={isOnSale}
              quoteMessage="Add to Quote for pricing"
            />
          </div>

          {/* A disabled button with no visible reason is the failure this
              avoids: the notice sits directly above the CTA row as well as in
              the group's own position, and the CTA points at it. */}
          {hasUploadAddon && (
            <div
              id={ADDON_UPLOAD_NOTICE_ID}
              className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
            >
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
              <p className="flex-1 text-sm text-amber-800">
                This product needs a file upload, which this store can&rsquo;t
                accept online yet. Please contact us to order it.
              </p>
            </div>
          )}

          {/* A rejection that belongs to no single group lands here rather than
              beside an arbitrary one. */}
          {addonFormError && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
            >
              <svg
                className="mt-0.5 h-4 w-4 shrink-0 text-red-600"
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
              <p className="flex-1 text-sm text-red-700">{addonFormError}</p>
            </div>
          )}

          {/* Quantity selector + Add to Cart + Wishlist */}
          {showMultiAdd && (
            <ProductMultiAdd
              hero={{
                id: product.id,
                name: stripTitleMarkers(decodeHtmlEntities(product.name)),
                unitPrice: heroUnitPrice,
                image: multiAddHeroImage,
                minQuantity: 1,
                maxQuantity: maxStock,
                unavailable: isOutOfStock || (isVariable && !selectedVariation),
              }}
              heroQuantity={quantity}
              onHeroQuantityChange={setQuantity}
              companions={multiAddCompanions}
              pinSlug={multiAddPinSlug}
              pinValue={multiAddPinValue}
              quantities={companionQty}
              onQuantityChange={(productId, next) =>
                setCompanionQty((prev) => ({ ...prev, [productId]: next }))
              }
              setTotal={setTotal}
              pieceCount={setPieceCount}
              showTotal={setPieceCount > 0}
              {...(sizeGuidePlacement === "multi-add" && sizeGuideHref
                ? { sizeGuideHref }
                : {})}
            />
          )}

          <div ref={atcSectionRef} className="mb-6 flex items-center gap-3">
            {/* Qty lives in Complete the Set when multi-add is active. */}
            {!showMultiAdd && (
              <div className="flex items-center rounded-md border border-gray-300">
                <button
                  type="button"
                  onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                  disabled={quantity <= 1}
                  className="cursor-pointer px-3 py-2.5 text-gray-600 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Decrease quantity"
                >
                  <MinusIcon className="h-4 w-4" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={maxStock ?? 99}
                  value={quantity}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val) && val >= 1) setQuantity(val);
                  }}
                  className="w-12 border-x border-gray-300 py-2 text-center text-sm font-medium [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  aria-label="Quantity"
                />
                <button
                  type="button"
                  onClick={() =>
                    setQuantity((q) =>
                      maxStock ? Math.min(maxStock, q + 1) : q + 1,
                    )
                  }
                  disabled={maxStock !== null && quantity >= maxStock}
                  className="cursor-pointer px-3 py-2.5 text-gray-600 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Increase quantity"
                >
                  <PlusIcon className="h-4 w-4" />
                </button>
              </div>
            )}

            <Button
              className={cn(
                "flex-1",
                cartFeedback === "success" && "bg-green-600 hover:bg-green-700",
                cartFeedback === "error" && "bg-red-600 hover:bg-red-700",
              )}
              disabled={!canAddToCart}
              aria-describedby={
                hasUploadAddon ? ADDON_UPLOAD_NOTICE_ID : undefined
              }
              loading={addingToCart}
              loadingText="Adding…"
              rightIcon={isQuoteMode ? "plus" : "shoppingBag"}
              onClick={handleAddToCart}
            >
              {addToCartLabel}
            </Button>

            <button
              type="button"
              onClick={handleWishlistToggle}
              aria-label={
                wishlisted ? "Remove from wishlist" : "Add to wishlist"
              }
              aria-pressed={wishlisted}
              className={cn(
                "flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-button)] border border-primary transition-colors",
                wishlisted
                  ? "bg-primary text-on-primary"
                  : "bg-transparent text-primary hover:opacity-80",
              )}
            >
              <HeartIcon className="h-5 w-5" />
            </button>
          </div>

          {/* BNPL messaging — Stripe decides whether anything renders. Tracks the
              SELECTED VARIANT price, which is why it is a client-side value.
              No wrapper: the component owns its own spacing, so an ineligible
              store or amount collapses to nothing instead of leaving a gap. */}
          {stripeConfig ? (
            <PaymentMethodMessaging
              price={getFloatVal(displayPrice)}
              currency={getStoreCurrency()}
              publishableKey={stripeConfig.publishableKey}
              stripeAccountId={stripeConfig.accountId}
              enabled={stripeConfig.bnplMessagingEnabled}
              disabled={isOutOfStock}
            />
          ) : null}

          {!isGiftCard && (
            <div className="mb-6">
              <ProductEnquiry
                formId={ENQUIRY_FORM_ID}
                productName={stripTitleMarkers(
                  decodeHtmlEntities(product.name),
                )}
                initialValues={enquiryInitialValues}
                shopifyContact={shopifyContact}
              />
            </div>
          )}

          {/* SKU */}
          {product.sku && (
            <p className="mb-4 text-xs text-gray-800">SKU: {product.sku}</p>
          )}

          {/* Tags */}
          {visibleTags.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-2">
              {visibleTags.map((tag) => (
                <span
                  key={tag.id}
                  className="text-xs font-medium text-primary/80"
                >
                  {decodeHtmlEntities(tag.name)}
                </span>
              ))}
            </div>
          )}

          {/* Accordion: Description / Specifications / Additional Info / Reviews */}
          {visibleTabs.length > 0 && visibleTabs[0] && (
            <div className="border-t pt-2">
              <Accordion
                type="single"
                collapsible
                defaultValue={visibleTabs[0].key}
                className="w-full"
              >
                {visibleTabs.map((tab) => (
                  <AccordionItem key={tab.key} value={tab.key}>
                    {/* Radix Header is already an h3 — keep H3 size/family; bump weight to match */}
                    <AccordionTrigger className="py-4 text-left font-semibold hover:no-underline">
                      {tab.label}
                    </AccordionTrigger>
                    <AccordionContent className="text-base">
                      {tab.key === "description" && product.description && (
                        <div
                          className="prose max-w-none text-base text-primary prose-p:my-3 prose-p:first:mt-0 prose-p:last:mb-0 prose-ul:my-3 prose-ol:my-3"
                          dangerouslySetInnerHTML={{
                            __html: formatWooRichText(product.description),
                          }}
                        />
                      )}

                      {tab.key === "specifications" && specifications && (
                        <div
                          className="prose max-w-none text-base text-primary prose-p:my-3 prose-p:first:mt-0 prose-p:last:mb-0 prose-ul:my-3 prose-ol:my-3"
                          dangerouslySetInnerHTML={{
                            __html: formatWooRichText(specifications),
                          }}
                        />
                      )}

                      {tab.key === "additional" && (
                        <div className="space-y-3">
                          {product.attributes
                            .filter((a) => a.visible && !a.variation)
                            .map((attr) => (
                              <div
                                key={attr.id}
                                className="flex gap-4 text-base"
                              >
                                <span className="w-32 shrink-0 font-medium text-gray-700">
                                  {decodeHtmlEntities(attr.name)}
                                </span>
                                <span className="text-gray-600">
                                  {attr.options
                                    .map((o) => decodeHtmlEntities(o))
                                    .join(", ")}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}

                      {tab.key === "reviews" && (
                        <p className="text-base text-gray-500">
                          Reviews coming soon.
                        </p>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          )}

          <ProductIdentifiers gtin={gtin} mpn={mpn} />
        </div>
      </div>

      <PdpBuyBoxExtras
        selectedColor={selectedColor}
        options={(
          variationAttributes.find(
            (attr) => attr.slug === swatchAttribute?.slug,
          )?.fullOptions ?? []
        ).map((option) => ({
          name: option.name,
          slug: option.slug,
          ...(option.swatchColor ? { swatchColor: option.swatchColor } : {}),
        }))}
      />

      {/* Sticky ATC — desktop + mobile, after main ATC scrolls out of view.

          The SHOWN state translates up by whatever the consent banner is
          occupying: both are `fixed` and pinned to the bottom edge, so without
          it they overlap and one hides the other.
          `lib/consent-banner-offset.ts` owns the property and the reasoning —
          including why this is a transform and not `bottom` (a fixed element
          that moves IS a layout-shift source). The variable is ABSENT once a
          choice is made, so the fallback makes that case `translateY(0)`,
          exactly the `translate-y-0` this had. The underscores are Tailwind's
          arbitrary-value syntax for the spaces `calc()` requires around `*` —
          without them the declaration is invalid CSS and no rule is emitted at
          all. */}
      <div
        className={cn(
          "headkit-product-sticky-bar fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-brand-bg/95 px-4 py-3 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-sm transition-transform duration-300 md:px-10",
          showStickyAtc
            ? "translate-y-[calc(var(--headkit-consent-banner-height,0px)_*_-1)]"
            : "pointer-events-none translate-y-full",
        )}
        aria-hidden={!showStickyAtc}
      >
        <div className="mx-auto flex max-w-7xl items-center gap-3 md:gap-6">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-primary md:text-base">
              <TitleEmphasis text={product.name} />
            </p>
            <div className="mt-0.5">
              <ProductPrice
                price={displayPrice}
                regularPrice={displayRegularPrice}
                onSale={isOnSale}
                size="default"
                quoteMessage="Add to Quote for pricing"
              />
            </div>
          </div>
          {!showMultiAdd && (
            <div className="hidden items-center rounded-md border border-gray-300 sm:flex">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="cursor-pointer px-3 py-2 text-gray-600 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Decrease quantity"
              >
                <MinusIcon className="h-4 w-4" />
              </button>
              <span className="w-10 border-x border-gray-300 py-2 text-center text-sm font-medium">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() =>
                  setQuantity((q) =>
                    maxStock ? Math.min(maxStock, q + 1) : q + 1,
                  )
                }
                disabled={maxStock !== null && quantity >= maxStock}
                className="cursor-pointer px-3 py-2 text-gray-600 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Increase quantity"
              >
                <PlusIcon className="h-4 w-4" />
              </button>
            </div>
          )}
          <Button
            className={cn(
              "min-w-[140px] shrink-0 md:min-w-[180px]",
              cartFeedback === "success" && "bg-green-600 hover:bg-green-700",
              cartFeedback === "error" && "bg-red-600 hover:bg-red-700",
            )}
            disabled={!canAddToCart}
            aria-describedby={
              hasUploadAddon ? ADDON_UPLOAD_NOTICE_ID : undefined
            }
            loading={addingToCart}
            loadingText="Adding…"
            rightIcon={isQuoteMode ? "plus" : "shoppingBag"}
            onClick={handleAddToCart}
          >
            {addToCartLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
