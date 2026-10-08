import Image from "next/image";
import { CATALOG_GRID_IMAGE_SIZES } from "@/components/headkit-ui/catalog-grid";
import { cn } from "@/lib/utils";

interface Props {
  src?: string | null;
  /**
   * Optional second image for collection-card image rollover. Rendered as a
   * lazy dual layer so the browser can fetch it near the viewport — never a
   * first-hover `src` swap (which stalls LCP-adjacent cards).
   */
  hoverSrc?: string | null;
  /** When true and `hoverSrc` differs, cross-fade to the hover layer. */
  showHover?: boolean;
  /**
   * Cross-fade on the parent `group` hover. CSS only, so a server-rendered
   * card does not need a client hover state.
   */
  revealOnGroupHover?: boolean;
  alt?: string;
  className?: string;
  /**
   * Mark this image as the likely LCP element (first-row grid / carousel cards).
   * Emits a preload + eager fetchPriority=high instead of the default lazy
   * loading. Never applied to the hover layer.
   */
  priority?: boolean;
  /** `contain` keeps full product shots visible (PLP cards); `cover` crops to fill. */
  fit?: "cover" | "contain";
  /**
   * Optimizer quality (must be listed in `next.config` images.qualities).
   * PLP/carousel default 65 balances visual quality vs bytes; heroes can pass 75.
   */
  quality?: 50 | 65 | 75 | 100;
  /**
   * Slot width for `next/image`. Defaults to the catalog grid. A carousel
   * card is narrower than that grid on a phone and must pass its own hint.
   */
  sizes?: string;
}

/**
 * Local fallback when a product/category has no thumbnail. It goes through
 * `next/image` at quality 50 with the catalog `sizes`, so the browser requests
 * the slot width rather than the largest device size.
 */
const FALLBACK_IMAGE_SRC = "/assets/HeadKit-Fallback.png";

const FeaturedImage = ({
  src,
  hoverSrc,
  showHover = false,
  revealOnGroupHover = false,
  alt = "",
  className,
  priority = false,
  fit = "cover",
  quality = 65,
  sizes = CATALOG_GRID_IMAGE_SIZES,
}: Props) => {
  // Empty/whitespace means "no image" — use the storefront fallback asset only.
  const trimmed = src?.trim();
  const imageSrc = trimmed ? trimmed : FALLBACK_IMAGE_SRC;
  const trimmedHover = hoverSrc?.trim() || "";
  const hasHoverLayer = Boolean(
    trimmedHover &&
    trimmedHover !== imageSrc &&
    imageSrc !== FALLBACK_IMAGE_SRC,
  );
  const revealHover = hasHoverLayer && showHover;

  const objectClass = cn(
    "object-center transition-opacity duration-200 motion-reduce:transition-none",
    fit === "contain" ? "object-contain" : "object-cover",
  );

  return (
    <div
      className={cn(
        "relative aspect-square w-full overflow-hidden rounded-brand",
        fit === "contain" ? "bg-white" : "bg-gray-100",
        className,
      )}
    >
      <Image
        src={imageSrc}
        alt={alt}
        fill
        priority={priority}
        fetchPriority={priority ? "high" : "auto"}
        quality={imageSrc === FALLBACK_IMAGE_SRC ? 50 : quality}
        className={cn(
          objectClass,
          revealOnGroupHover && hasHoverLayer
            ? "opacity-100 group-hover:opacity-0"
            : revealHover
              ? "opacity-0"
              : "opacity-100",
        )}
        sizes={sizes}
      />
      {hasHoverLayer ? (
        <Image
          src={trimmedHover}
          alt=""
          fill
          // Never compete with LCP — lazy near-viewport fetch only.
          priority={false}
          loading="lazy"
          fetchPriority="low"
          quality={quality}
          aria-hidden
          className={cn(
            objectClass,
            revealOnGroupHover
              ? "opacity-0 group-hover:opacity-100"
              : revealHover
                ? "opacity-100"
                : "opacity-0",
          )}
          sizes={sizes}
        />
      ) : null}
    </div>
  );
};

export { FeaturedImage };
