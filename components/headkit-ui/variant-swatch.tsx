"use client";

import { cn } from "@/lib/utils";
import { addAlphaToHex } from "@/lib/utils";
import { SwatchPhotoLayer } from "@/components/headkit-ui/swatch-image-fill";
import { useSwatchImageContext } from "@/components/headkit-ui/swatch-image-provider";

interface Props {
  label: string;
  value: string;
  color1?: string;
  color2?: string;
  /** WordPress term image or Shopify option image. Shown instead of the hex. */
  imageSrc?: string;
  /**
   * Visual attribute id. When the experimental lookup is on and the photo is
   * not on the product yet, the chip keeps a circle and the image streams in.
   */
  attributeId?: string;
  /** Product image URL used to find the WordPress host for a late photo. */
  commerceSrc?: string;
  selectedOptionValue: string;
  onClick: () => void;
  isUnavailable?: boolean;
  /** Exists in some variation but not compatible with current other selections.
   *  The button remains clickable and triggers an auto-cascade. */
  isIncompatible?: boolean;
  size?: "small" | "default";
}

const VariantSwatch = ({
  label,
  value,
  color1,
  color2,
  imageSrc,
  attributeId,
  commerceSrc,
  selectedOptionValue,
  onClick,
  isUnavailable = false,
  isIncompatible = false,
  size = "default",
}: Props) => {
  const { enabled } = useSwatchImageContext();
  const isSelected = selectedOptionValue === value;
  const hasImage = Boolean(imageSrc);
  const hasColor = !!color1;
  const awaitingImage = enabled && Boolean(attributeId) && !hasImage;
  const chipClass = cn(
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-brand-button border p-0 leading-none outline transition-all hover:outline-primary",
    size === "default"
      ? "h-6 w-6 outline-2 outline-offset-1"
      : "h-4 w-4 outline-1 outline-offset-1",
    isUnavailable ? "border-gray-500" : "border-gray-700",
    isSelected ? "outline-primary" : "outline-transparent",
    isIncompatible && !isSelected && "opacity-50",
  );

  if (hasImage || hasColor || awaitingImage) {
    const color1Formatted = hasColor
      ? isUnavailable
        ? addAlphaToHex(color1 ?? "", 0.5)
        : (color1 ?? "")
      : "";
    const color2Formatted = color2
      ? isUnavailable
        ? addAlphaToHex(color2, 0.5)
        : color2
      : null;
    const colorStyle = !hasColor
      ? undefined
      : color2Formatted
        ? {
            background: `linear-gradient(90deg, ${color1Formatted}, ${color1Formatted} 50%, ${color2Formatted} 51%)`,
          }
        : { backgroundColor: color1Formatted };

    return (
      <button
        type="button"
        title={label}
        onClick={onClick}
        className={cn(chipClass, !hasColor && "bg-gray-200")}
        {...(colorStyle ? { style: colorStyle } : {})}
      >
        {/* Clip the photo inside the chip. Overflow on the button itself
            would crop the selection outline. */}
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
          <SwatchPhotoLayer
            imageSrc={imageSrc ?? ""}
            optionSlug={value}
            size={size}
            {...(attributeId ? { attributeId } : {})}
            {...(commerceSrc ? { commerceSrc } : {})}
          />
        </span>
        <span className="sr-only">{label}</span>
        {isUnavailable && (
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 rotate-45 transform bg-gray-500" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative inline-flex max-w-full cursor-pointer items-center justify-center truncate rounded-md border leading-none outline-2 outline-solid -outline-offset-1 transition-all hover:outline-primary",
        size === "default" ? "h-8 px-[10px]" : "h-6 px-2 text-xs",
        isUnavailable ? "border-gray-500 text-gray-500" : "border-gray-700",
        isSelected ? "font-semibold outline-primary" : "outline-transparent",
        isIncompatible && !isSelected && "opacity-50",
      )}
    >
      {label}
      {isUnavailable && (
        <svg className="absolute left-1/2 top-1/2 h-[95%] w-[95%] -translate-x-1/2 -translate-y-1/2 transform">
          <line
            x1="0"
            y1="100%"
            x2="100%"
            y2="0"
            className="stroke-gray-500 stroke-1"
          />
        </svg>
      )}
    </button>
  );
};

export { VariantSwatch };
